import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { fakeAdapters, memoryDb } from './helpers.ts';
import type { Reply } from './helpers.ts';

async function setup(reply: Reply = (req) => `reply from ${req.model}`) {
  const config = loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'multichat-')), WEB_DIR: '/nonexistent' });
  const db = memoryDb();
  const fake = fakeAdapters(reply);
  const { app, ctx } = await buildApp({ config, db, createAdapter: fake.createAdapter });

  /** Makes requests as one browser would: it keeps the session cookie. */
  function client() {
    let cookie = '';
    return async (method: string, url: string, body?: unknown) => {
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: cookie ? { cookie } : {},
        ...(body === undefined ? {} : { payload: body as object }),
      });
      const set = res.cookies.find((c) => c.name === 'sid');
      if (set) cookie = set.value ? `sid=${set.value}` : '';
      return { status: res.statusCode, body: res.json() as any, raw: res };
    };
  }

  const settle = async (id: number) => {
    while (ctx.engine.isRunning(id)) await new Promise((r) => setTimeout(r, 5));
  };
  return { app, ctx, db, client, settle, requests: fake.requests };
}

async function adminWithModels(t: Awaited<ReturnType<typeof setup>>) {
  const admin = t.client();
  await admin('POST', '/api/auth/setup', { username: 'admin', password: 'password123' });
  const provider = await admin('POST', '/api/providers', { name: 'Fake', type: 'openai', baseUrl: 'http://fake/v1', apiKey: 'sk-secret' });
  const added = await admin('POST', `/api/providers/${provider.body.id}/models`, {
    models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }],
  });
  return { admin, provider: added.body, models: added.body.models as { id: number; modelId: string }[] };
}

test('setup creates the admin once, and sessions work', async () => {
  const t = await setup();
  const c = t.client();
  assert.equal((await c('GET', '/api/auth/state')).body.needsSetup, true);
  assert.equal((await c('GET', '/api/discussions')).status, 401);

  assert.equal((await c('POST', '/api/auth/setup', { username: 'admin', password: 'short' })).status, 400);
  const created = await c('POST', '/api/auth/setup', { username: 'admin', password: 'password123' });
  assert.equal(created.body.user.role, 'admin');
  assert.match(String(created.raw.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
  assert.deepEqual((await c('GET', '/api/auth/state')).body, { needsSetup: false, user: { id: 1, username: 'admin', role: 'admin' } });

  // A second setup attempt must not create another admin.
  assert.equal((await t.client()('POST', '/api/auth/setup', { username: 'evil', password: 'password123' })).status, 409);

  await c('POST', '/api/auth/logout');
  assert.equal((await c('GET', '/api/auth/state')).body.user, null);
  assert.equal((await c('POST', '/api/auth/login', { username: 'admin', password: 'wrong-password' })).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { username: 'ADMIN', password: 'password123' })).status, 200);
});

test('repeated failed logins are locked out', async () => {
  const t = await setup();
  const c = t.client();
  await c('POST', '/api/auth/setup', { username: 'admin', password: 'password123' });
  await c('POST', '/api/auth/logout');
  for (let i = 0; i < 10; i++) {
    assert.equal((await c('POST', '/api/auth/login', { username: 'admin', password: 'nope' })).status, 401);
  }
  assert.equal((await c('POST', '/api/auth/login', { username: 'admin', password: 'password123' })).status, 429);
});

test('user management is limited to admins', async () => {
  const t = await setup();
  const { admin } = await adminWithModels(t);
  const bob = await admin('POST', '/api/users', { username: 'bob', password: 'password123' });
  assert.equal(bob.body.role, 'user');
  assert.equal((await admin('POST', '/api/users', { username: 'Bob', password: 'password123' })).status, 409);

  const user = t.client();
  await user('POST', '/api/auth/login', { username: 'bob', password: 'password123' });
  assert.equal((await user('GET', '/api/users')).status, 403);
  assert.equal((await user('GET', '/api/providers')).status, 403);
  assert.equal((await user('POST', '/api/providers', { name: 'X', type: 'openai' })).status, 403);
  assert.equal((await user('GET', '/api/models')).body.length, 2);

  assert.equal((await admin('DELETE', '/api/users/1')).status, 400);
  assert.equal((await admin('PATCH', '/api/users/1', { role: 'user' })).status, 400);

  // Changing the password signs the user out elsewhere.
  await admin('PATCH', `/api/users/${bob.body.id}`, { password: 'new-password-1' });
  assert.equal((await user('GET', '/api/models')).status, 401);
  assert.equal((await user('POST', '/api/auth/login', { username: 'bob', password: 'new-password-1' })).status, 200);

  await user('POST', '/api/auth/password', { currentPassword: 'new-password-1', newPassword: 'another-pass-2' });
  assert.equal((await user('GET', '/api/models')).status, 200);
  assert.equal((await admin('DELETE', `/api/users/${bob.body.id}`)).status, 200);
  assert.equal((await user('GET', '/api/models')).status, 401);
});

test('provider API keys are encrypted and never returned', async () => {
  const t = await setup();
  const { admin, provider } = await adminWithModels(t);
  assert.equal(provider.hasApiKey, true);
  assert.ok(!JSON.stringify((await admin('GET', '/api/providers')).body).includes('sk-secret'));
  const stored = t.db.prepare('SELECT api_key_enc AS enc FROM providers').get() as { enc: string };
  assert.ok(!stored.enc.includes('sk-secret'));
  assert.equal(t.ctx.vault.decrypt(stored.enc), 'sk-secret');

  // Editing other fields keeps the key; null removes it.
  assert.equal((await admin('PATCH', `/api/providers/${provider.id}`, { name: 'Renamed' })).body.hasApiKey, true);
  assert.equal((await admin('PATCH', `/api/providers/${provider.id}`, { apiKey: null })).body.hasApiKey, false);

  const available = await admin('GET', `/api/providers/${provider.id}/available-models`);
  assert.deepEqual(available.body.map((m: any) => [m.id, m.added]), [['model-a', true], ['model-b', true]]);
  assert.equal((await admin('POST', '/api/providers', { name: 'Bad', type: 'openai', baseUrl: 'ftp://x' })).status, 400);
  assert.equal((await admin('POST', '/api/providers', { name: 'Renamed', type: 'openai' })).status, 409);
});

test('a discussion runs, and belongs to its owner only', async () => {
  const t = await setup();
  const { admin, models } = await adminWithModels(t);
  const created = await admin('POST', '/api/discussions', {
    title: 'Tabs or spaces',
    mode: 'free',
    message: 'My view: spaces.',
    participants: [
      { modelId: models[0]!.id },
      { modelId: models[0]!.id, rolePrompt: "Devil's advocate" },
      { modelId: models[1]!.id, name: 'Critic' },
    ],
  });
  assert.equal(created.status, 200);
  assert.deepEqual(created.body.participants.map((p: any) => p.name), ['Model A', 'Model A (2)', 'Critic']);
  await t.settle(created.body.id);

  const detail = (await admin('GET', `/api/discussions/${created.body.id}`)).body;
  assert.equal(detail.running, false);
  assert.deepEqual(detail.messages.map((m: any) => m.content), [
    'My view: spaces.', 'reply from model-a', 'reply from model-a', 'reply from model-b',
  ]);
  assert.match(t.requests[1]!.system, /Tabs or spaces/);
  assert.match(t.requests[1]!.system, /Devil's advocate/);

  await admin('POST', `/api/discussions/${detail.id}/messages`, { content: '@critic your turn' });
  await t.settle(detail.id);
  assert.equal((await admin('GET', `/api/discussions/${detail.id}`)).body.messages.length, 6);

  await admin('POST', '/api/users', { username: 'bob', password: 'password123' });
  const bob = t.client();
  await bob('POST', '/api/auth/login', { username: 'bob', password: 'password123' });
  assert.deepEqual((await bob('GET', '/api/discussions')).body, []);
  for (const [method, path, body] of [
    ['GET', '', undefined], ['GET', '/events', undefined], ['DELETE', '', undefined],
    ['POST', '/messages', { content: 'hi' }], ['POST', '/continue', undefined], ['POST', '/stop', undefined],
    ['PATCH', '', { title: 'x' }],
  ] as const) {
    assert.equal((await bob(method, `/api/discussions/${detail.id}${path}`, body)).status, 404, `${method} ${path}`);
  }

  // A disabled model cannot join new discussions, and fails clearly in existing ones.
  await admin('PATCH', `/api/models/${models[1]!.id}`, { enabled: false });
  assert.equal((await admin('POST', '/api/discussions', { title: 'x', participants: [{ modelId: models[1]!.id }] })).status, 400);
  await admin('POST', `/api/discussions/${detail.id}/messages`, { content: '@critic again' });
  await t.settle(detail.id);
  const last = (await admin('GET', `/api/discussions/${detail.id}`)).body.messages.at(-1);
  assert.equal(last.status, 'error');
  assert.match(last.error, /disabled/);

  assert.equal((await admin('DELETE', `/api/discussions/${detail.id}`)).status, 200);
  assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n, 0);
});

test('the event stream sends the transcript and live updates', async () => {
  const t = await setup();
  const { admin, models } = await adminWithModels(t);
  const created = await admin('POST', '/api/discussions', { title: 'T', mode: 'free', participants: [{ modelId: models[0]!.id }] });
  await t.settle(created.body.id);

  const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
  // Close the server even when an assertion fails, or the test process never exits.
  try {
    const login = await fetch(`${address}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' }),
    });
    const cookie = login.headers.getSetCookie()[0]!.split(';')[0]!;
    const res = await fetch(`${address}/api/discussions/${created.body.id}/events`, { headers: { cookie } });
    assert.equal(res.headers.get('content-type'), 'text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (marker: string) => {
      while (!text.includes(marker)) text += decoder.decode((await reader.read()).value, { stream: true });
    };
    await readUntil('"type":"init"');
    await fetch(`${address}/api/discussions/${created.body.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ content: 'more please' }),
    });
    await readUntil('{"type":"run","running":false}');
    const types = text.split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)).type);
    assert.deepEqual(types, ['init', 'message', 'run', 'message', 'delta', 'message', 'run']);
    await reader.cancel();
  } finally {
    await t.app.close();
  }
});
