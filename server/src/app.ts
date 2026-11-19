import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import { HttpError } from './context.ts';
import type { AppContext } from './context.ts';
import { createVault } from './crypto.ts';
import type { Db } from './db.ts';
import { Engine } from './engine/engine.ts';
import { createAdapter as defaultCreateAdapter } from './providers/index.ts';
import type { AdapterFactory } from './providers/index.ts';
import { authRoutes, sessionUser } from './routes/auth.ts';
import { discussionRoutes } from './routes/discussions.ts';
import { providerRoutes } from './routes/providers.ts';

export interface AppOptions {
  config: Config;
  db: Db;
  createAdapter?: AdapterFactory;
  logger?: boolean;
}

export async function buildApp(opts: AppOptions): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const { config, db } = opts;
  const createAdapter = opts.createAdapter ?? defaultCreateAdapter;
  const vault = createVault(config.secret);
  const engine = new Engine({ db, vault, createAdapter, maxOutputTokens: config.maxOutputTokens });
  const ctx: AppContext = { config, db, vault, engine, createAdapter };

  // forceCloseConnections ends open event streams on shutdown.
  const app = Fastify({ logger: opts.logger ?? false, forceCloseConnections: true });
  await app.register(cookie);

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req, reply) => {
    req.user = sessionUser(ctx, req);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'same-origin');
  });

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if ('validation' in err && err.validation) {
      const first = err.validation[0];
      const field = first?.instancePath.replace(/^\//, '').replaceAll('/', '.') ?? '';
      return reply.status(400).send({ error: `Invalid request: ${field} ${first?.message ?? err.message}`.trim() });
    }
    const status = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error(err);
      if (!opts.logger) console.error(err);
      return reply.status(500).send({ error: 'Something went wrong on the server.' });
    }
    return reply.status(status).send({ error: err.message });
  });

  app.get('/api/health', () => ({ ok: true }));
  authRoutes(app, ctx);
  providerRoutes(app, ctx);
  discussionRoutes(app, ctx);

  if (config.webDir) {
    await app.register(fastifyStatic, { root: config.webDir, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    // Page URLs are handled by the frontend's router, so they all get index.html.
    if (config.webDir && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.status(404).send({ error: 'Not found.' });
  });

  return { app, ctx };
}
