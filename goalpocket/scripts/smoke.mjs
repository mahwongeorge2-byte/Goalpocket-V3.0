// End-to-end smoke test against a running server (default http://localhost:3000).
// Runs without an AI key: checks demo, setup, manual entries, affordability,
// settings, the no-key chat message, and that one user cannot touch another's data.
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

function client() {
  let cookie = '';
  return async (path, opts = {}) => {
    const r = await fetch(BASE + path, {
      ...opts, redirect: 'manual',
      headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
}

const a = client();
ok((await a('/api/state')).status === 401, 'state needs sign-in');
ok((await a('/chat')).status === 307, '/chat redirects when signed out');
ok((await a('/api/demo', { method: 'POST' })).status === 200, 'demo starts');
let s = (await a('/api/state')).data;
ok(s.pockets?.length === 5, 'demo has 5 pockets');
ok(s.goal?.goal?.name === 'Laptop', 'demo goal is Laptop');
ok(typeof s.insight?.text === 'string' && s.insight.text.length > 10, `insight: "${s.insight?.text}"`);
ok(typeof s.report?.expenseHomeCents === 'number', `month report spent ${s.report?.expenseHomeCents} cents`);
ok((await a('/chat')).status === 200, '/chat opens when signed in');

const before = s.totals.availableHomeCents;
const usd = s.pockets.find((p) => p.name === 'USD cash');
let r = await a('/api/entries', { method: 'POST', body: { type: 'expense', amount: 5, pocket_id: usd.id, category: 'food', description: 'smoke test lunch', date: s.today } });
ok(r.status === 200, 'manual entry saves');
s = (await a('/api/state')).data;
ok(s.totals.availableHomeCents === before - 500, 'available drops by exactly $5.00');
const entry = s.recent.find((x) => x.description === 'smoke test lunch');
ok(!!entry, 'entry shows in recent');

r = await a('/api/entries', { method: 'POST', body: { type: 'expense', amount: 5, pocket_id: usd.id, category: 'food', description: 'future', date: '2099-01-01' } });
ok(r.status === 400, 'future date refused');

r = await a('/api/afford', { method: 'POST', body: { item: 'phone', price: 120, currency: 'USD' } });
ok(['yes', 'yes_but', 'not_yet'].includes(r.data.verdict) && r.data.math.length > 0, `afford $120 phone: ${r.data.verdict}`);

r = await a('/api/chat', { method: 'POST', body: { message: 'spent L$200 on keke' } });
ok(r.status === 200 && r.data.demoMode === true && r.data.cards?.length === 1, 'chat without a key runs in demo mode and shows a card');
const card = r.data.cards?.[0];
const n0 = (await a('/api/state')).data.recent.length;
r = await a('/api/actions/confirm', { method: 'POST', body: { id: card.pendingId } });
ok(r.status === 200 && /LRD cash: L\$/.test(r.data.message), `tap Save records it: "${r.data.message}"`);
r = await a('/api/actions/confirm', { method: 'POST', body: { id: card.pendingId } });
ok(r.status === 409, 'a second tap cannot save it twice');

r = await a('/api/actions/confirm', { method: 'POST', body: { id: '00000000-0000-0000-0000-000000000000' } });
ok(r.status === 409, 'unknown card cannot be confirmed');

r = await a('/api/settings', { method: 'POST', body: { action: 'rate', lrdPerUsd: 180 } });
s = (await a('/api/state')).data;
ok(s.rate === 180, 'rate change saved');

r = await a('/api/state', { headers: { origin: 'https://evil.example' }, method: 'GET' });
ok(r.status === 200, 'GET is fine from anywhere (read-only, still needs cookie)');
r = await a('/api/entries', { method: 'POST', headers: { origin: 'https://evil.example' }, body: {} });
ok(r.status === 403, 'POST from another site refused');

// Second user, set up through the form.
const b = client();
r = await b('/api/setup', { method: 'POST', body: { displayName: 'Test', homeCurrency: 'LRD', lrdPerUsd: 172, pockets: [{ name: 'LRD cash', kind: 'cash', currency: 'LRD', balance: 1000, spendable: true }], goal: null } });
ok(r.status === 200, 'guest setup works');
const sb = (await b('/api/state')).data;
ok(sb.pockets.length === 1 && sb.home === 'LRD', 'guest sees only their own pocket');
ok(sb.recent.length === 0, 'guest sees none of the demo entries');
r = await b(`/api/entries?id=${entry.id}`, { method: 'DELETE' });
s = (await a('/api/state')).data;
ok(s.recent.some((x) => x.id === entry.id), "guest cannot delete the demo user's entry (row-level security)");

r = await a(`/api/entries?id=${entry.id}`, { method: 'DELETE' });
s = (await a('/api/state')).data;
ok(!s.recent.some((x) => x.id === entry.id) && s.totals.availableHomeCents > 0, 'owner can remove their entry');

r = await b('/api/settings', { method: 'POST', body: { action: 'delete_my_data' } });
ok((await b('/api/state')).status === 401, 'delete my data signs the guest out');

console.log(failures ? `\n${failures} FAILED` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
