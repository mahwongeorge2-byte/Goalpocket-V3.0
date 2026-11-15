// Chat loop tests against the local database, with a fake model.
// No API key and no cost: `create` is replaced by scripted responses.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
const msg = (content: Block[], stop_reason = 'end_turn') => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'test', content, stop_reason, stop_sequence: null,
  usage: { input_tokens: 0, output_tokens: 0 },
});
/** A fake `create` that plays back responses in order and records what it was sent. */
function script(...responses: ReturnType<typeof msg>[]) {
  const calls: unknown[] = [];
  const fn = async (p: unknown) => { calls.push(p); const r = responses.shift(); if (!r) throw new Error('script ran out'); return r; };
  return { fn: fn as never, calls };
}

const TODAY = '2026-11-14';
let uid = '';
let lrdPocket = '';
let mod: typeof import('../src/lib/ai/chat');
let db: typeof import('../src/lib/db');

beforeAll(async () => {
  db = await import('../src/lib/db');
  const repo = await import('../src/lib/repo');
  const setup = await import('../src/lib/setup');
  mod = await import('../src/lib/ai/chat');
  uid = await repo.createUser('demo');
  await db.asUser(uid, (tx) => setup.seedDemo(tx, uid, TODAY));
  const [p] = await db.asUser(uid, (tx) => tx`select id from pockets where name = 'LRD cash'`);
  lrdPocket = p.id;
});
afterAll(async () => {
  await db.sql`delete from app_users where id = ${uid}`;
  await db.sql.end();
});

const countTxns = () => db.asUser(uid, async (tx) => Number((await tx`select count(*) from transactions where not deleted`)[0].count));

describe('chat with a fake model', () => {
  it('turns a message into a confirm card and saves nothing yet', async () => {
    const before = await countTxns();
    const s = script(
      msg([{ type: 'tool_use', id: 't1', name: 'propose_transactions', input: { items: [{ type: 'expense', amount: 200, currency: 'LRD', pocket_id: lrdPocket, category: 'transport', description: 'keke', date: TODAY }] } }], 'tool_use'),
      msg([{ type: 'text', text: 'Here is your keke entry. Tap Save if it looks right.' }]),
    );
    const r = await mod.runChat(uid, 'spent 200 LD on keke', { today: TODAY, create: s.fn });
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].pending.kind).toBe('transactions');
    expect(r.numberCheck).toBe('passed');
    expect(await countTxns()).toBe(before); // the AI cannot save on its own
    const [row] = await db.asUser(uid, (tx) => tx`select status from pending_actions where id = ${r.cards[0].pendingId}`);
    expect(row.status).toBe('pending');
  });

  it('refuses a proposal with the wrong currency for the pocket', async () => {
    const s = script(
      msg([{ type: 'tool_use', id: 't1', name: 'propose_transactions', input: { items: [{ type: 'expense', amount: 5, currency: 'USD', pocket_id: lrdPocket, category: 'food', description: 'lunch', date: TODAY }] } }], 'tool_use'),
      msg([{ type: 'text', text: 'Which pocket did you pay from?' }]),
    );
    const r = await mod.runChat(uid, 'lunch 5 dollars', { today: TODAY, create: s.fn });
    expect(r.cards).toHaveLength(0);
    const second = JSON.stringify(s.calls[1]);
    expect(second).toContain('is_error');
  });

  it('asks the model to rewrite a reply with an unbacked number, once', async () => {
    const s = script(
      msg([{ type: 'text', text: 'You spent $999.99 this week.' }]),
      msg([{ type: 'text', text: 'Open the Money tab to see this week.' }]),
    );
    const r = await mod.runChat(uid, 'how much this week?', { today: TODAY, create: s.fn });
    expect(r.numberCheck).toBe('retried');
    expect(r.reply).toBe('Open the Money tab to see this week.');
  });

  it('falls back to a code-written reply if the number is still unbacked', async () => {
    const s = script(
      msg([{ type: 'text', text: 'You spent $999.99 this week.' }]),
      msg([{ type: 'text', text: 'Sorry, it was $888.88.' }]),
    );
    const r = await mod.runChat(uid, 'how much this week?', { today: TODAY, create: s.fn });
    expect(r.numberCheck).toBe('fallback');
    expect(r.reply).not.toContain('888');
  });

  it('gets "Can I afford it?" from the engine, not the model', async () => {
    const s = script(
      msg([{ type: 'tool_use', id: 't1', name: 'check_affordability', input: { item: 'phone', price: 120, currency: 'USD' } }], 'tool_use'),
      msg([{ type: 'text', text: 'Here is what I found.' }]),
    );
    const r = await mod.runChat(uid, 'can I afford a $120 phone?', { today: TODAY, create: s.fn });
    expect(r.affordability?.verdict).toBeDefined();
    expect(r.affordability?.math.length).toBeGreaterThan(0);
  });

  it('handles a refusal', async () => {
    const s = script(msg([], 'refusal'));
    const r = await mod.runChat(uid, 'something odd', { today: TODAY, create: s.fn });
    expect(r.error).toBe('refused');
  });

  it('says the AI is not connected when there is no key', async () => {
    const r = await mod.runChat(uid, 'spent L$100 on data', { today: TODAY, create: null });
    expect(r.error).toBe('no_api_key');
  });

  it('refuses very long messages before calling the model', async () => {
    const s = script();
    const r = await mod.runChat(uid, 'a'.repeat(501), { today: TODAY, create: s.fn });
    expect(r.error).toBe('too_long');
    expect(s.calls).toHaveLength(0);
  });
});

describe('demo mode (no AI, no key)', () => {
  let off: typeof import('../src/lib/ai/offline');
  beforeAll(async () => { off = await import('../src/lib/ai/offline'); });
  // The test sends many messages quickly; reset the 12-a-minute limit between tests.
  beforeEach(async () => { await db.asUser(uid, (tx) => tx`delete from rate_limits`); });
  const run = (text: string) => mod.runChat(uid, text, { today: TODAY, create: off.offlineCreate as never });

  it('reads two expenses from one message', async () => {
    const r = await run('Spent L$500 on keke and L$300 on data from MoMo');
    expect(r.cards).toHaveLength(1);
    const p = r.cards[0].pending;
    if (p.kind !== 'transactions') throw new Error('expected transactions');
    expect(p.items.map((i) => [i.amountCents, i.currency, i.category, i.pocketName])).toEqual([
      [50000, 'LRD', 'transport', 'MoMo'], [30000, 'LRD', 'phone_data', 'MoMo'],
    ]);
    expect(r.numberCheck).toBe('passed');
  });
  it('reads income in US dollars into a USD pocket', async () => {
    const r = await run('Earned $25 from sales');
    const p = r.cards[0].pending;
    if (p.kind !== 'transactions') throw new Error('expected transactions');
    expect(p.items[0]).toMatchObject({ type: 'income', amountCents: 2500, currency: 'USD', category: 'income' });
  });
  it('answers Can I afford it from the engine', async () => {
    const r = await run('Can I afford a $120 phone?');
    expect(r.affordability?.verdict).toBe('not_yet');
    expect(r.numberCheck).toBe('passed');
  });
  it('answers balance, spending and goal questions with checked numbers', async () => {
    for (const q of ['What is my balance?', 'How much did I spend this week?', 'How is my goal?']) {
      const r = await run(q);
      expect(r.numberCheck, q).toBe('passed');
      expect(r.reply, q).toMatch(/\$/);
    }
  });
  it('shows help for messages it cannot read', async () => {
    const r = await run('hello there');
    expect(r.reply).toContain('Demo mode');
    expect(r.numberCheck).toBe('passed');
  });
});
