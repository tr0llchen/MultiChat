import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError, idParam, isUniqueViolation, needAdmin, needUser } from '../context.ts';
import type { AppContext, User } from '../context.ts';
import { hashPassword, hashToken, newSessionToken, verifyPassword } from '../crypto.ts';
import { tx } from '../db.ts';

const COOKIE = 'sid';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

const username = { type: 'string', pattern: '^[A-Za-z0-9._-]{2,32}$' };
const password = { type: 'string', minLength: 8, maxLength: 200 };
const role = { type: 'string', enum: ['admin', 'user'] };
const credentials = {
  type: 'object',
  required: ['username', 'password'],
  additionalProperties: false,
  properties: { username, password },
};

interface Credentials {
  username: string;
  password: string;
}

export function sessionUser(ctx: AppContext, req: FastifyRequest): User | null {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const row = ctx.db
    .prepare(
      `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), Date.now()) as User | undefined;
  return row ?? null;
}

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, engine } = ctx;
  const failures = new Map<string, { count: number; resetAt: number }>();
  // Verified for unknown usernames, so response time does not reveal which usernames exist.
  const dummyHash = hashPassword('not-a-real-password');

  function startSession(reply: FastifyReply, userId: number): void {
    const { token, hash } = newSessionToken();
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      hash, userId, Date.now() + SESSION_MS,
    );
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: ctx.config.cookieSecure,
      maxAge: SESSION_MS / 1000,
    });
  }

  function userCount(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  app.get('/api/auth/state', (req) => ({ needsSetup: userCount() === 0, user: req.user }));

  // The first account is created without signing in and becomes the admin.
  app.post<{ Body: Credentials }>('/api/auth/setup', { schema: { body: credentials } }, async (req, reply) => {
    const hash = await hashPassword(req.body.password);
    const id = tx(db, () => {
      if (userCount() > 0) throw new HttpError(409, 'Setup is already complete. Please sign in.');
      return db
        .prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`)
        .run(req.body.username, hash).lastInsertRowid;
    });
    startSession(reply, Number(id));
    return { user: { id: Number(id), username: req.body.username, role: 'admin' } };
  });

  app.post<{ Body: Credentials }>(
    '/api/auth/login',
    { schema: { body: { ...credentials, properties: { username: { type: 'string' }, password: { type: 'string' } } } } },
    async (req, reply) => {
      const now = Date.now();
      const key = `${req.ip}|${req.body.username.toLowerCase()}`;
      const entry = failures.get(key);
      if (entry && entry.resetAt > now && entry.count >= MAX_FAILURES) {
        throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
      }

      const row = db
        .prepare('SELECT id, username, role, password_hash AS hash FROM users WHERE username = ?')
        .get(req.body.username) as (User & { hash: string }) | undefined;
      const ok = await verifyPassword(req.body.password.slice(0, 200), row?.hash ?? (await dummyHash));
      if (!row || !ok) {
        if (failures.size > 10_000) failures.clear();
        failures.set(key, entry && entry.resetAt > now
          ? { count: entry.count + 1, resetAt: entry.resetAt }
          : { count: 1, resetAt: now + FAILURE_WINDOW_MS });
        throw new HttpError(401, 'Wrong username or password.');
      }
      failures.delete(key);
      startSession(reply, row.id);
      return { user: { id: row.id, username: row.username, role: row.role } };
    },
  );

  app.post('/api/auth/logout', (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    '/api/auth/password',
    {
      schema: {
        body: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          additionalProperties: false,
          properties: { currentPassword: { type: 'string', maxLength: 200 }, newPassword: password },
        },
      },
    },
    async (req, reply) => {
      const user = needUser(req);
      const row = db.prepare('SELECT password_hash AS hash FROM users WHERE id = ?').get(user.id) as { hash: string };
      if (!(await verifyPassword(req.body.currentPassword, row.hash))) {
        throw new HttpError(400, 'The current password is wrong.');
      }
      const hash = await hashPassword(req.body.newPassword);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
      // Sign out everywhere else, then keep this browser signed in.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      startSession(reply, user.id);
      return { ok: true };
    },
  );

  app.get('/api/users', (req) => {
    needAdmin(req);
    return db.prepare('SELECT id, username, role, created_at AS createdAt FROM users ORDER BY username').all();
  });

  app.post<{ Body: Credentials & { role?: User['role'] } }>(
    '/api/users',
    { schema: { body: { ...credentials, properties: { username, password, role } } } },
    async (req) => {
      needAdmin(req);
      const hash = await hashPassword(req.body.password);
      const userRole = req.body.role ?? 'user';
      try {
        const { lastInsertRowid } = db
          .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
          .run(req.body.username, hash, userRole);
        return { id: Number(lastInsertRowid), username: req.body.username, role: userRole };
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, 'This username is already taken.');
        throw err;
      }
    },
  );

  app.patch<{ Body: { password?: string; role?: User['role'] } }>(
    '/api/users/:id',
    { schema: { body: { type: 'object', additionalProperties: false, properties: { password, role } } } },
    async (req) => {
      const admin = needAdmin(req);
      const id = idParam(req);
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw new HttpError(404, 'User not found.');
      // Admins cannot demote themselves, so there is always at least one admin.
      if (req.body.role && id === admin.id) throw new HttpError(400, 'You cannot change your own role.');

      if (req.body.role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, id);
      if (req.body.password) {
        const hash = await hashPassword(req.body.password);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
        if (id !== admin.id) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
      return { ok: true };
    },
  );

  app.delete('/api/users/:id', async (req) => {
    const admin = needAdmin(req);
    const id = idParam(req);
    if (id === admin.id) throw new HttpError(400, 'You cannot delete your own account.');
    const discussions = db.prepare('SELECT id FROM discussions WHERE user_id = ?').all(id) as { id: number }[];
    await Promise.all(discussions.map((d) => engine.stop(d.id)));
    const { changes } = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (changes === 0) throw new HttpError(404, 'User not found.');
    return { ok: true };
  });
}
