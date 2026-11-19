import { join } from 'node:path';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';

const config = loadConfig();
const db = openDb(join(config.dataDir, 'multichat.db'));
const { app, ctx } = await buildApp({ config, db, logger: true });

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} received, shutting down`);
  // Stop running discussions first, so partial replies are saved.
  await ctx.engine.stopAll();
  await app.close();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
if (!config.webDir) app.log.warn('Frontend build not found: only the API is served. Run "npm run build".');
