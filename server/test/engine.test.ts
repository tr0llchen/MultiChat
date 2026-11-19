import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine } from '../src/engine/engine.ts';
import type { EngineEvent } from '../src/engine/engine.ts';
import { buildMessages, findMentions } from '../src/engine/prompt.ts';
import { listMessages, listParticipants } from '../src/repo.ts';
import { fakeAdapters, memoryDb, seedDiscussion, vault } from './helpers.ts';
import type { Reply } from './helpers.ts';

function setup(names: string[], reply: Reply, mode: 'free' | 'round_robin' = 'free', maxRounds = 3) {
  const db = memoryDb();
  const discussion = seedDiscussion(db, names, mode, maxRounds);
  const fake = fakeAdapters(reply);
  const engine = new Engine({ db, vault, createAdapter: fake.createAdapter, maxOutputTokens: 100 });
  const finish = async () => {
    while (engine.isRunning(discussion.id)) await new Promise((r) => setTimeout(r, 5));
  };
  const summary = () =>
    listMessages(db, discussion.id).map((m) => {
      const who = listParticipants(db, discussion.id).find((p) => p.id === m.participantId)?.name ?? 'user';
      return `${who}:${m.status}:${m.content}`;
    });
  return { db, discussion, engine, finish, summary, requests: fake.requests };
}

test('free mode: every model replies once and sees the earlier replies', async () => {
  const t = setup(['A', 'B'], (req) => `reply from ${req.model}`);
  await t.engine.begin(t.discussion, 'alice', 'Hello');
  await t.finish();

  assert.deepEqual(t.summary(), ['user:complete:Hello', 'A:complete:reply from A', 'B:complete:reply from B']);
  assert.deepEqual(t.requests[1]!.messages, [{ role: 'user', content: '[alice]: Hello\n\n[A]: reply from A' }]);
  assert.match(t.requests[1]!.system, /You are "B"/);
});

test('free mode: an @mention limits who replies', async () => {
  const t = setup(['A', 'B'], () => 'ok');
  await t.engine.begin(t.discussion, 'alice', 'What do you think, @b?');
  await t.finish();
  assert.deepEqual(t.summary(), ['user:complete:What do you think, @b?', 'B:complete:ok']);
});

test('round robin: runs until everyone passes', async () => {
  let calls = 0;
  const t = setup(['A', 'B'], () => (++calls <= 3 ? `point ${calls}` : '[PASS]'), 'round_robin', 5);
  await t.engine.begin(t.discussion, 'alice', 'Go');
  await t.finish();
  assert.deepEqual(t.summary(), [
    'user:complete:Go',
    'A:complete:point 1', 'B:complete:point 2',
    'A:complete:point 3', 'B:passed:',
    'A:passed:', 'B:passed:',
  ]);
});

test('round robin: an @mention asks only that model, once', async () => {
  const t = setup(['A', 'B'], () => 'ok', 'round_robin', 3);
  await t.engine.begin(t.discussion, 'alice', '@B only you please');
  await t.finish();
  assert.deepEqual(t.summary(), ['user:complete:@B only you please', 'B:complete:ok']);
});

test('round robin: stops at the round limit', async () => {
  const t = setup(['A', 'B'], () => 'more', 'round_robin', 2);
  await t.engine.begin(t.discussion, 'alice', 'Go');
  await t.finish();
  assert.equal(t.summary().length, 1 + 2 * 2);
});

test('a pass is never streamed to subscribers', async () => {
  const t = setup(['A'], async function* () {
    yield { type: 'text', text: '[PA' };
    yield { type: 'text', text: 'SS]' };
  });
  const events: EngineEvent[] = [];
  t.engine.subscribe(t.discussion.id, (e) => events.push(e));
  await t.engine.begin(t.discussion, 'alice', 'Hi');
  await t.finish();
  assert.equal(events.filter((e) => e.type === 'delta').length, 0);
  assert.deepEqual(t.summary(), ['user:complete:Hi', 'A:passed:']);
});

test('a provider failure is recorded and the next model still replies', async () => {
  const t = setup(['A', 'B'], (req) => {
    if (req.model === 'A') throw new Error('401 Invalid API key');
    return 'fine';
  });
  await t.engine.begin(t.discussion, 'alice', 'Hi');
  await t.finish();
  const messages = listMessages(t.db, t.discussion.id);
  assert.equal(messages[1]!.status, 'error');
  assert.equal(messages[1]!.error, '401 Invalid API key');
  assert.equal(messages[2]!.content, 'fine');
  // The failed reply is not shown to the other model.
  assert.deepEqual(t.requests[1]!.messages, [{ role: 'user', content: '[alice]: Hi' }]);
});

test('round robin: a failing model is not asked again in later rounds', async () => {
  const t = setup(['A', 'B'], (req) => {
    if (req.model === 'B') throw new Error('500 overloaded');
    return 'point';
  }, 'round_robin', 3);
  await t.engine.begin(t.discussion, 'alice', 'Go');
  await t.finish();
  assert.deepEqual(t.summary(), ['user:complete:Go', 'A:complete:point', 'B:error:', 'A:complete:point', 'A:complete:point']);
});

test('a new user message interrupts the run and keeps the partial reply', async () => {
  let first = true;
  const t = setup(['A', 'B'], async function* (req) {
    if (!first) return yield { type: 'text', text: 'second answer' };
    first = false;
    yield { type: 'text', text: 'partial' };
    await new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason)));
  });
  const events: EngineEvent[] = [];
  t.engine.subscribe(t.discussion.id, (e) => events.push(e));
  await t.engine.begin(t.discussion, 'alice', 'First');
  while (!events.some((e) => e.type === 'delta')) await new Promise((r) => setTimeout(r, 5));

  // A subscriber joining mid-reply gets the text streamed so far.
  let init: EngineEvent | undefined;
  t.engine.subscribe(t.discussion.id, (e) => (init ??= e));
  assert.ok(init?.type === 'init' && init.running);
  assert.equal(init.messages.at(-1)!.content, 'partial');

  await t.engine.begin(t.discussion, 'alice', 'Wait');
  await t.finish();
  assert.deepEqual(t.summary(), [
    'user:complete:First', 'A:stopped:partial',
    'user:complete:Wait', 'A:complete:second answer', 'B:complete:second answer',
  ]);
});

test('buildMessages gives each model its own point of view', () => {
  const t = setup(['A', 'B'], () => '');
  const [a, b] = listParticipants(t.db, t.discussion.id) as [any, any];
  const msg = (participantId: number | null, content: string, status = 'complete') =>
    ({ id: 0, discussionId: 1, participantId, content, status, error: null, inputTokens: null, outputTokens: null, createdAt: '' }) as any;
  const transcript = [msg(null, 'Q'), msg(a.id, 'from A'), msg(b.id, '', 'passed'), msg(b.id, 'from B')];

  assert.deepEqual(buildMessages(a, [a, b], transcript, 'alice'), [
    { role: 'user', content: '[alice]: Q' },
    { role: 'assistant', content: 'from A' },
    { role: 'user', content: '[B]: from B' },
  ]);
  const forB = buildMessages(b, [a, b], transcript, 'alice');
  assert.equal(forB.at(-1)!.role, 'user');
  assert.match(forB.at(-1)!.content, /your turn again/);
});

test('findMentions prefers the longest matching name', () => {
  const ps = ['GPT-4', 'GPT-4o'].map((name, id) => ({ id, name })) as any;
  assert.deepEqual(findMentions('hey @gpt-4o', ps), [1]);
  assert.deepEqual(findMentions('hey @GPT-4 and @GPT-4o', ps), [0, 1]);
  assert.deepEqual(findMentions('nobody', ps), []);
});
