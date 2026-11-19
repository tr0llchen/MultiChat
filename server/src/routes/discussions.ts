import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, idParam, needUser } from '../context.ts';
import type { AppContext } from '../context.ts';
import { tx } from '../db.ts';
import type { EngineEvent } from '../engine/engine.ts';
import { getDiscussion, listDiscussions, listMessages, listParticipants } from '../repo.ts';
import type { Discussion, Mode } from '../repo.ts';

const MAX_PARTICIPANTS = 8;

const title = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' };
const mode = { type: 'string', enum: ['free', 'round_robin'] };
const maxRounds = { type: 'integer', minimum: 1, maximum: 10 };
const content = { type: 'string', minLength: 1, maxLength: 100_000, pattern: '\\S' };

interface ParticipantInput {
  modelId: number;
  name?: string;
  rolePrompt?: string;
}

interface CreateBody {
  title: string;
  mode?: Mode;
  maxRounds?: number;
  participants: ParticipantInput[];
  message?: string;
}

/** Makes names unique within a discussion, so replies and @mentions are unambiguous. */
function uniqueName(wanted: string, taken: Set<string>): string {
  let name = wanted;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${wanted} (${n})`;
  taken.add(name.toLowerCase());
  return name;
}

export function discussionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, engine } = ctx;

  /** Loads a discussion of the signed-in user. Other users' discussions look like they do not exist. */
  function own(req: FastifyRequest): { discussion: Discussion; username: string } {
    const user = needUser(req);
    const discussion = getDiscussion(db, idParam(req));
    if (!discussion || discussion.userId !== user.id) throw new HttpError(404, 'Discussion not found.');
    return { discussion, username: user.username };
  }

  function detail(discussion: Discussion) {
    return {
      ...discussion,
      participants: listParticipants(db, discussion.id),
      messages: listMessages(db, discussion.id),
      running: engine.isRunning(discussion.id),
    };
  }

  app.get('/api/discussions', (req) => listDiscussions(db, needUser(req).id));

  app.post<{ Body: CreateBody }>(
    '/api/discussions',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title', 'participants'],
          additionalProperties: false,
          properties: {
            title,
            mode,
            maxRounds,
            message: { type: 'string', maxLength: 100_000 },
            participants: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_PARTICIPANTS,
              items: {
                type: 'object',
                required: ['modelId'],
                additionalProperties: false,
                properties: {
                  modelId: { type: 'integer' },
                  name: { type: 'string', maxLength: 60 },
                  rolePrompt: { type: 'string', maxLength: 2000 },
                },
              },
            },
          },
        },
      },
    },
    async (req) => {
      const user = needUser(req);
      const body = req.body;
      const findModel = db.prepare(
        `SELECT m.display_name AS displayName, p.name AS providerName
         FROM models m JOIN providers p ON p.id = m.provider_id WHERE m.id = ? AND m.enabled = 1`,
      );

      const id = tx(db, () => {
        const { lastInsertRowid } = db
          .prepare('INSERT INTO discussions (user_id, title, mode, max_rounds) VALUES (?, ?, ?, ?)')
          .run(user.id, body.title.trim(), body.mode ?? 'round_robin', body.maxRounds ?? 3);
        const insert = db.prepare(
          `INSERT INTO participants (discussion_id, model_ref, name, model_label, role_prompt, position)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        const taken = new Set<string>();
        body.participants.forEach((p, position) => {
          const model = findModel.get(p.modelId) as { displayName: string; providerName: string } | undefined;
          if (!model) throw new HttpError(400, 'One of the selected models is no longer available. Reload and try again.');
          const wanted = p.name?.replace(/\s+/g, ' ').trim() || model.displayName;
          insert.run(
            lastInsertRowid,
            p.modelId,
            uniqueName(wanted, taken),
            `${model.displayName} · ${model.providerName}`,
            p.rolePrompt?.trim() ?? '',
            position,
          );
        });
        return Number(lastInsertRowid);
      });

      const discussion = getDiscussion(db, id)!;
      // Without opening thoughts, the models start on the topic alone.
      await engine.begin(discussion, user.username, body.message?.trim() || null);
      return detail(discussion);
    },
  );

  app.get('/api/discussions/:id', (req) => detail(own(req).discussion));

  app.patch<{ Body: { title?: string; mode?: Mode; maxRounds?: number } }>(
    '/api/discussions/:id',
    { schema: { body: { type: 'object', additionalProperties: false, properties: { title, mode, maxRounds } } } },
    (req) => {
      const { discussion } = own(req);
      db.prepare('UPDATE discussions SET title = ?, mode = ?, max_rounds = ? WHERE id = ?').run(
        req.body.title?.trim() ?? discussion.title,
        req.body.mode ?? discussion.mode,
        req.body.maxRounds ?? discussion.maxRounds,
        discussion.id,
      );
      return getDiscussion(db, discussion.id);
    },
  );

  app.delete('/api/discussions/:id', async (req) => {
    const { discussion } = own(req);
    await engine.stop(discussion.id);
    db.prepare('DELETE FROM discussions WHERE id = ?').run(discussion.id);
    return { ok: true };
  });

  /** The user speaks. This interrupts the models if they are still talking. */
  app.post<{ Body: { content: string } }>(
    '/api/discussions/:id/messages',
    { schema: { body: { type: 'object', required: ['content'], additionalProperties: false, properties: { content } } } },
    async (req) => {
      const { discussion, username } = own(req);
      await engine.begin(discussion, username, req.body.content.trim());
      return { ok: true };
    },
  );

  /** Lets the models keep discussing without a new message from the user. */
  app.post('/api/discussions/:id/continue', async (req) => {
    const { discussion, username } = own(req);
    await engine.begin(discussion, username, null);
    return { ok: true };
  });

  app.post('/api/discussions/:id/stop', async (req) => {
    await engine.stop(own(req).discussion.id);
    return { ok: true };
  });

  /** Server-sent events: the transcript so far, then live updates. */
  app.get('/api/discussions/:id/events', (req, reply) => {
    const { discussion } = own(req);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    });
    const send = (event: EngineEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = engine.subscribe(discussion.id, send);
    // Comment lines keep proxies from closing an idle connection.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
