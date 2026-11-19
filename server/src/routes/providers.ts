import type { FastifyInstance } from 'fastify';
import { HttpError, idParam, isUniqueViolation, needAdmin, needUser } from '../context.ts';
import type { AppContext } from '../context.ts';
import { tx } from '../db.ts';
import { DEFAULT_BASE_URL, ProviderError } from '../providers/index.ts';
import type { ProviderType } from '../providers/index.ts';

interface ProviderRow {
  id: number;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKeyEnc: string | null;
}

interface ModelRow {
  id: number;
  providerId: number;
  modelId: string;
  displayName: string;
  enabled: number;
}

const PROVIDER_COLS = 'id, name, type, base_url AS baseUrl, api_key_enc AS apiKeyEnc';
const MODEL_COLS = 'id, provider_id AS providerId, model_id AS modelId, display_name AS displayName, enabled';

const name = { type: 'string', minLength: 1, maxLength: 60, pattern: '\\S' };
const baseUrl = { type: 'string', maxLength: 500 };
const apiKey = { type: ['string', 'null'], maxLength: 2000 };

function checkBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, 'The base URL is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'The base URL must start with http:// or https://.');
  }
  return value.trim().replace(/\/+$/, '');
}

export function providerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, vault } = ctx;

  function getProvider(id: number): ProviderRow {
    const row = db.prepare(`SELECT ${PROVIDER_COLS} FROM providers WHERE id = ?`).get(id) as ProviderRow | undefined;
    if (!row) throw new HttpError(404, 'Provider not found.');
    return row;
  }

  function modelsOf(providerId: number): (Omit<ModelRow, 'enabled'> & { enabled: boolean })[] {
    const rows = db
      .prepare(`SELECT ${MODEL_COLS} FROM models WHERE provider_id = ? ORDER BY display_name COLLATE NOCASE`)
      .all(providerId) as unknown as ModelRow[];
    return rows.map((m) => ({ ...m, enabled: m.enabled === 1 }));
  }

  // API keys never leave the server: clients only learn whether one is set.
  function present(p: ProviderRow) {
    return { id: p.id, name: p.name, type: p.type, baseUrl: p.baseUrl, hasApiKey: p.apiKeyEnc !== null, models: modelsOf(p.id) };
  }

  /** Models every signed-in user can pick for a discussion. */
  app.get('/api/models', (req) => {
    needUser(req);
    return db
      .prepare(
        `SELECT m.id, m.model_id AS modelId, m.display_name AS displayName, p.name AS providerName
         FROM models m JOIN providers p ON p.id = m.provider_id
         WHERE m.enabled = 1 ORDER BY p.name COLLATE NOCASE, m.display_name COLLATE NOCASE`,
      )
      .all();
  });

  app.get('/api/providers', (req) => {
    needAdmin(req);
    const rows = db.prepare(`SELECT ${PROVIDER_COLS} FROM providers ORDER BY name COLLATE NOCASE`).all();
    return (rows as unknown as ProviderRow[]).map(present);
  });

  app.post<{ Body: { name: string; type: ProviderType; baseUrl?: string; apiKey?: string | null } }>(
    '/api/providers',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'type'],
          additionalProperties: false,
          properties: { name, type: { type: 'string', enum: ['openai', 'anthropic'] }, baseUrl, apiKey },
        },
      },
    },
    (req) => {
      needAdmin(req);
      const { type } = req.body;
      const url = checkBaseUrl(req.body.baseUrl?.trim() || DEFAULT_BASE_URL[type]);
      const key = req.body.apiKey?.trim() || null;
      try {
        const { lastInsertRowid } = db
          .prepare('INSERT INTO providers (name, type, base_url, api_key_enc) VALUES (?, ?, ?, ?)')
          .run(req.body.name.trim(), type, url, key ? vault.encrypt(key) : null);
        return present(getProvider(Number(lastInsertRowid)));
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, 'A provider with this name already exists.');
        throw err;
      }
    },
  );

  app.patch<{ Body: { name?: string; baseUrl?: string; apiKey?: string | null } }>(
    '/api/providers/:id',
    { schema: { body: { type: 'object', additionalProperties: false, properties: { name, baseUrl, apiKey } } } },
    (req) => {
      needAdmin(req);
      const current = getProvider(idParam(req));
      const body = req.body;
      // apiKey: a string replaces the key, null removes it, and leaving it out keeps it.
      const newKey = body.apiKey === undefined ? current.apiKeyEnc : body.apiKey?.trim() ? vault.encrypt(body.apiKey.trim()) : null;
      try {
        db.prepare('UPDATE providers SET name = ?, base_url = ?, api_key_enc = ? WHERE id = ?').run(
          body.name?.trim() ?? current.name,
          body.baseUrl === undefined ? current.baseUrl : checkBaseUrl(body.baseUrl),
          newKey,
          current.id,
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, 'A provider with this name already exists.');
        throw err;
      }
      return present(getProvider(current.id));
    },
  );

  app.delete('/api/providers/:id', (req) => {
    needAdmin(req);
    const { changes } = db.prepare('DELETE FROM providers WHERE id = ?').run(idParam(req));
    if (changes === 0) throw new HttpError(404, 'Provider not found.');
    return { ok: true };
  });

  /** Asks the provider which models it offers, so the admin can pick from a list. */
  app.get('/api/providers/:id/available-models', async (req) => {
    needAdmin(req);
    const provider = getProvider(idParam(req));
    const adapter = ctx.createAdapter({
      type: provider.type,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKeyEnc ? vault.decrypt(provider.apiKeyEnc) : null,
    });
    try {
      const available = await adapter.listModels(AbortSignal.timeout(20_000));
      const added = new Set(modelsOf(provider.id).map((m) => m.modelId));
      return available.map((m) => ({ ...m, added: added.has(m.id) }));
    } catch (err) {
      const reason = err instanceof ProviderError ? err.message : 'The provider did not answer in time.';
      throw new HttpError(502, `Could not load the model list: ${reason}`);
    }
  });

  app.post<{ Body: { models: { id: string; name?: string }[] } }>(
    '/api/providers/:id/models',
    {
      schema: {
        body: {
          type: 'object',
          required: ['models'],
          additionalProperties: false,
          properties: {
            models: {
              type: 'array',
              minItems: 1,
              maxItems: 500,
              items: {
                type: 'object',
                required: ['id'],
                additionalProperties: false,
                properties: {
                  id: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
                  name: { type: 'string', maxLength: 200 },
                },
              },
            },
          },
        },
      },
    },
    (req) => {
      needAdmin(req);
      const provider = getProvider(idParam(req));
      const insert = db.prepare(
        'INSERT INTO models (provider_id, model_id, display_name) VALUES (?, ?, ?) ON CONFLICT (provider_id, model_id) DO NOTHING',
      );
      tx(db, () => {
        for (const m of req.body.models) insert.run(provider.id, m.id.trim(), m.name?.trim() || m.id.trim());
      });
      return present(provider);
    },
  );

  app.patch<{ Body: { enabled?: boolean; displayName?: string } }>(
    '/api/models/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { enabled: { type: 'boolean' }, displayName: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' } },
        },
      },
    },
    (req) => {
      needAdmin(req);
      const id = idParam(req);
      const row = db.prepare(`SELECT ${MODEL_COLS} FROM models WHERE id = ?`).get(id) as ModelRow | undefined;
      if (!row) throw new HttpError(404, 'Model not found.');
      db.prepare('UPDATE models SET enabled = ?, display_name = ? WHERE id = ?').run(
        req.body.enabled === undefined ? row.enabled : Number(req.body.enabled),
        req.body.displayName?.trim() ?? row.displayName,
        id,
      );
      return { ok: true };
    },
  );

  app.delete('/api/models/:id', (req) => {
    needAdmin(req);
    const { changes } = db.prepare('DELETE FROM models WHERE id = ?').run(idParam(req));
    if (changes === 0) throw new HttpError(404, 'Model not found.');
    return { ok: true };
  });
}
