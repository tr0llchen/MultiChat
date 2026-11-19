import type { FastifyRequest } from 'fastify';
// Loads the request.cookies and reply.setCookie types.
import type {} from '@fastify/cookie';
import type { Config } from './config.ts';
import type { Vault } from './crypto.ts';
import type { Db } from './db.ts';
import type { Engine } from './engine/engine.ts';
import type { AdapterFactory } from './providers/index.ts';

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

export interface AppContext {
  config: Config;
  db: Db;
  vault: Vault;
  engine: Engine;
  createAdapter: AdapterFactory;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function needUser(req: FastifyRequest): User {
  if (!req.user) throw new HttpError(401, 'Please sign in.');
  return req.user;
}

export function needAdmin(req: FastifyRequest): User {
  const user = needUser(req);
  if (user.role !== 'admin') throw new HttpError(403, 'Only admins can do this.');
  return user;
}

export function idParam(req: FastifyRequest, name = 'id'): number {
  const id = Number((req.params as Record<string, string>)[name]);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, 'Not found.');
  return id;
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message);
}
