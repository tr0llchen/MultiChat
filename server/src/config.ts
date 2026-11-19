import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  /** Secret used to encrypt provider API keys at rest. */
  secret: string;
  cookieSecure: boolean;
  /** Directory with the built frontend, or null when it is not built. */
  webDir: string | null;
  maxOutputTokens: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.DATA_DIR ?? './data');
  mkdirSync(dataDir, { recursive: true });

  // Prefer a secret from the environment. Otherwise generate one next to the
  // database so the app works out of the box.
  let secret = env.APP_SECRET?.trim() ?? '';
  if (!secret) {
    const file = join(dataDir, 'secret.key');
    if (existsSync(file)) {
      secret = readFileSync(file, 'utf8').trim();
    } else {
      secret = randomBytes(32).toString('base64');
      writeFileSync(file, secret + '\n', { mode: 0o600 });
    }
  }

  const webDir = resolve(env.WEB_DIR ?? join(import.meta.dirname, '../../web/dist'));
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    secret,
    cookieSecure: env.COOKIE_SECURE === 'true',
    webDir: existsSync(webDir) ? webDir : null,
    maxOutputTokens: Number(env.MAX_OUTPUT_TOKENS ?? 4096),
  };
}
