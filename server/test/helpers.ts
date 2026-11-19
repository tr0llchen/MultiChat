import { createVault } from '../src/crypto.ts';
import { openDb } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import type { ChatEvent, ChatRequest, ProviderAdapter } from '../src/providers/types.ts';
import { getDiscussion } from '../src/repo.ts';
import type { Discussion, Mode } from '../src/repo.ts';

export const vault = createVault('test-secret');

export type Reply = (req: ChatRequest) => AsyncGenerator<ChatEvent> | string;

/** Adapter factory whose models answer through the given function. Records every request. */
export function fakeAdapters(reply: Reply) {
  const requests: ChatRequest[] = [];
  const createAdapter = (): ProviderAdapter => ({
    async listModels() {
      return [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }];
    },
    async *chat(req) {
      requests.push(req);
      const out = reply(req);
      if (typeof out === 'string') yield { type: 'text', text: out };
      else yield* out;
    },
  });
  return { createAdapter, requests };
}

/** Creates a user, a provider and a discussion with one participant per given name. */
export function seedDiscussion(db: Db, names: string[], mode: Mode = 'free', maxRounds = 3): Discussion {
  db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'alice', 'x', 'admin')`).run();
  db.prepare(
    `INSERT OR IGNORE INTO providers (id, name, type, base_url, api_key_enc) VALUES (1, 'Fake', 'openai', 'http://fake', ?)`,
  ).run(vault.encrypt('sk-test'));
  const { lastInsertRowid: discussionId } = db
    .prepare('INSERT INTO discussions (user_id, title, mode, max_rounds) VALUES (1, ?, ?, ?)')
    .run('Test', mode, maxRounds);
  names.forEach((name, position) => {
    db.prepare('INSERT OR IGNORE INTO models (provider_id, model_id, display_name) VALUES (1, ?, ?)').run(name, name);
    const model = db.prepare('SELECT id FROM models WHERE model_id = ?').get(name) as { id: number };
    db.prepare(
      'INSERT INTO participants (discussion_id, model_ref, name, model_label, position) VALUES (?, ?, ?, ?, ?)',
    ).run(discussionId, model.id, name, name, position);
  });
  return getDiscussion(db, Number(discussionId))!;
}

export function memoryDb(): Db {
  return openDb(':memory:');
}
