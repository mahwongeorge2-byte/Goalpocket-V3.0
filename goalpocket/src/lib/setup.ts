import 'server-only';
import type { Tx } from './db';
import type { Currency } from './money';
import { addDays } from './dates';

export type SetupInput = {
  displayName: string;
  homeCurrency: Currency;
  lrdPerUsd: number;
  pockets: { name: string; kind: string; currency: Currency; balanceCents: number; spendable: boolean }[];
  goal?: { name: string; targetCents: number; currency: Currency; targetDate: string } | null;
};

export async function setupUser(tx: Tx, uid: string, s: SetupInput) {
  await tx`insert into profiles (user_id, display_name, home_currency, setup_done) values (${uid}, ${s.displayName}, ${s.homeCurrency}, true)
    on conflict (user_id) do update set display_name = excluded.display_name, home_currency = excluded.home_currency, setup_done = true`;
  await tx`insert into exchange_rates (user_id, lrd_per_usd, note) values (${uid}, ${s.lrdPerUsd}, 'Set during setup')`;
  let sort = 0;
  const ids: string[] = [];
  for (const p of s.pockets) {
    const [row] = await tx`insert into pockets (user_id, name, kind, currency, opening_balance_cents, spendable, sort)
      values (${uid}, ${p.name}, ${p.kind}, ${p.currency}, ${p.balanceCents}, ${p.spendable}, ${sort++}) returning id`;
    ids.push(row.id);
  }
  if (s.goal) {
    await tx`insert into goals (user_id, name, target_cents, currency, target_date) values (${uid}, ${s.goal.name}, ${s.goal.targetCents}, ${s.goal.currency}, ${s.goal.targetDate})`;
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Demo account: "Musu", a FICTIONAL 19-year-old student who sells phone
// accessories. All entries are made-up sample data, dated relative to today
// so the demo always looks current. Closing balances (before the live demo
// messages) match the Stage 4 mockups: USD cash $36, LRD cash L$2,450,
// Orange Money $56, MoMo L$4,800, Susu L$5,000 (not spendable).
// ---------------------------------------------------------------------------
type Seed = { ago: number; pocket: string; type: 'income' | 'expense'; amount: number; category: string; desc: string };

const DEMO_POCKETS = [
  { key: 'usd', name: 'USD cash', kind: 'cash', currency: 'USD' as Currency, closing: 3600, spendable: true },
  { key: 'lrd', name: 'LRD cash', kind: 'cash', currency: 'LRD' as Currency, closing: 245000, spendable: true },
  { key: 'om', name: 'Orange Money', kind: 'orange_money', currency: 'USD' as Currency, closing: 5600, spendable: true },
  { key: 'momo', name: 'MoMo', kind: 'momo', currency: 'LRD' as Currency, closing: 480000, spendable: true },
  { key: 'susu', name: 'Susu', kind: 'susu', currency: 'LRD' as Currency, closing: 500000, spendable: false },
];

// Amounts in whole currency units of the pocket (USD or LRD).
const DEMO_ENTRIES: Seed[] = [
  { ago: 26, pocket: 'usd', type: 'income', amount: 40, category: 'business', desc: 'Sold phone chargers' },
  { ago: 19, pocket: 'om', type: 'income', amount: 60, category: 'business', desc: 'Sold earphones' },
  { ago: 12, pocket: 'momo', type: 'income', amount: 8600, category: 'business', desc: 'Sold phone cases' },
  { ago: 5, pocket: 'usd', type: 'income', amount: 25, category: 'business', desc: 'Sold power bank' },
  { ago: 2, pocket: 'om', type: 'income', amount: 60, category: 'income', desc: 'Aunty sent school support' },
  ...[27, 22, 18, 13, 8, 3].map((ago): Seed => ({ ago, pocket: 'usd', type: 'expense', amount: 2, category: 'food', desc: 'Cookshop' })),
  { ago: 24, pocket: 'lrd', type: 'expense', amount: 1800, category: 'food', desc: 'Rice' },
  { ago: 10, pocket: 'lrd', type: 'expense', amount: 1200, category: 'food', desc: 'Fish and greens' },
  ...[25, 21, 17, 14, 11, 7, 4, 1].map((ago): Seed => ({ ago, pocket: 'lrd', type: 'expense', amount: 300, category: 'transport', desc: 'Keke' })),
  ...[23, 16, 9].map((ago): Seed => ({ ago, pocket: 'lrd', type: 'expense', amount: 500, category: 'transport', desc: 'Taxi' })),
  ...[26, 15, 5].map((ago): Seed => ({ ago, pocket: 'lrd', type: 'expense', amount: 500, category: 'phone_data', desc: 'Scratch card' })),
  { ago: 20, pocket: 'om', type: 'expense', amount: 5, category: 'phone_data', desc: 'Data bundle' },
  { ago: 6, pocket: 'om', type: 'expense', amount: 5, category: 'phone_data', desc: 'Data bundle' },
  { ago: 20, pocket: 'usd', type: 'expense', amount: 45, category: 'business', desc: 'Phone case stock' },
  { ago: 15, pocket: 'momo', type: 'expense', amount: 3000, category: 'family', desc: 'Sent to Ma' },
  { ago: 15, pocket: 'momo', type: 'expense', amount: 170, category: 'fees', desc: 'Cash-out fee' },
  { ago: 16, pocket: 'om', type: 'expense', amount: 20, category: 'education', desc: 'School dues' },
  { ago: 9, pocket: 'lrd', type: 'expense', amount: 750, category: 'education', desc: 'Printing and photocopies' },
  { ago: 6, pocket: 'lrd', type: 'expense', amount: 900, category: 'health', desc: 'Medicine' },
  { ago: 4, pocket: 'lrd', type: 'expense', amount: 200, category: 'entertainment', desc: 'Video club' },
  { ago: 11, pocket: 'usd', type: 'expense', amount: 6, category: 'shopping', desc: 'Slippers' },
  { ago: 17, pocket: 'lrd', type: 'expense', amount: 2500, category: 'other', desc: 'Hair braiding' },
];

const DEMO_CONTRIBUTIONS = [{ ago: 44, amount: 60 }, { ago: 27, amount: 20 }, { ago: 20, amount: 20 }, { ago: 13, amount: 20 }, { ago: 6, amount: 20 }];

export async function seedDemo(tx: Tx, uid: string, today: string) {
  // Opening balance = closing - money in + money out, per pocket.
  const net = new Map<string, number>();
  for (const e of DEMO_ENTRIES) net.set(e.pocket, (net.get(e.pocket) ?? 0) + (e.type === 'income' ? 1 : -1) * e.amount * 100);
  for (const c of DEMO_CONTRIBUTIONS) net.set('om', (net.get('om') ?? 0) - c.amount * 100);

  const ids = await setupUser(tx, uid, {
    displayName: 'Musu', homeCurrency: 'USD', lrdPerUsd: 172,
    pockets: DEMO_POCKETS.map((p) => ({ name: p.name, kind: p.kind, currency: p.currency, balanceCents: p.closing - (net.get(p.key) ?? 0), spendable: p.spendable })),
    goal: { name: 'Laptop', targetCents: 50000, currency: 'USD', targetDate: addDays(today, 137) },
  });
  const pid = Object.fromEntries(DEMO_POCKETS.map((p, i) => [p.key, ids[i]]));
  const cur = Object.fromEntries(DEMO_POCKETS.map((p) => [p.key, p.currency]));
  for (const e of DEMO_ENTRIES) {
    await tx`insert into transactions (user_id, type, pocket_id, amount_cents, currency, category, description, occurred_on, source)
      values (${uid}, ${e.type}, ${pid[e.pocket]}, ${e.amount * 100}, ${cur[e.pocket]}, ${e.category}, ${e.desc}, ${addDays(today, -e.ago)}, 'seed')`;
  }
  const [goal] = await tx`select id from goals limit 1`;
  for (const c of DEMO_CONTRIBUTIONS) {
    await tx`insert into goal_contributions (user_id, goal_id, pocket_id, amount_from_pocket_cents, amount_to_goal_cents, occurred_on)
      values (${uid}, ${goal.id}, ${pid.om}, ${c.amount * 100}, ${c.amount * 100}, ${addDays(today, -c.ago)})`;
  }
  await tx`insert into budgets (user_id, category, limit_cents, currency) values (${uid}, ${null}, ${6000}, 'USD')`;
}
