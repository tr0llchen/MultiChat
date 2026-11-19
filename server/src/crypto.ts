import {
  argon2, createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);
const ARGON = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2Async('argon2id', { message: Buffer.from(password), nonce: salt, ...ARGON });
  const params = `m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}`;
  return `$argon2id$${params}$${salt.toString('base64')}$${Buffer.from(hash).toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, algo, params, saltB64, hashB64] = stored.split('$');
  if (algo !== 'argon2id' || !params || !saltB64 || !hashB64) return false;
  const p = Object.fromEntries(params.split(',').map((kv) => kv.split('='))) as Record<string, string>;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await argon2Async('argon2id', {
    message: Buffer.from(password),
    nonce: Buffer.from(saltB64, 'base64'),
    memory: Number(p.m),
    passes: Number(p.t),
    parallelism: Number(p.p),
    tagLength: expected.length,
  });
  return timingSafeEqual(Buffer.from(actual), expected);
}

/** Session tokens are stored hashed, so a database leak does not expose live sessions. */
export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface Vault {
  encrypt(plain: string): string;
  decrypt(stored: string): string;
}

/** AES-256-GCM encryption for provider API keys. */
export function createVault(secret: string): Vault {
  const key = Buffer.from(hkdfSync('sha256', secret, 'multichat', 'provider-api-keys', 32));
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv, cipher.getAuthTag(), data]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
        .join(':');
    },
    decrypt(stored) {
      const [version, iv, tag, data] = stored.split(':');
      if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unknown secret format');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}
