// Goalpocket calculation engine.
// Every authoritative number in the app comes from here: plain, tested code.
// The AI never calculates; it only receives these results and explains them.
import { convertCents, formatMoney, type Currency } from './money';
import { addDays, daysBetween, prettyDate, weekStart, monthStart } from './dates';

export type Pocket = {
  id: string; name: string; kind: string; currency: Currency;
  openingBalanceCents: number; spendable: boolean; archived?: boolean;
};
export type Txn = {
  id: string; type: 'income' | 'expense'; pocketId: string; amountCents: number;
  currency: Currency; category: string; description: string; occurredOn: string; deleted?: boolean;
};
export type Transfer = {
  id: string; fromPocketId: string; toPocketId: string; amountOutCents: number;
  amountInCents: number; occurredOn: string; deleted?: boolean;
};
export type Contribution = {
  id: string; goalId: string; pocketId: string; amountFromPocketCents: number;
  amountToGoalCents: number; occurredOn: string; deleted?: boolean;
};
export type Goal = { id: string; name: string; targetCents: number; currency: Currency; targetDate: string };
export type Budget = { id: string; category: string | null; limitCents: number; currency: Currency };

export type Ledger = {
  today: string;
  homeCurrency: Currency;
  lrdPerUsd: number;
  pockets: Pocket[];
  transactions: Txn[];
  transfers: Transfer[];
  contributions: Contribution[];
  goal: Goal | null;
  budget: Budget | null;
};

const live = <T extends { deleted?: boolean }>(xs: T[]) => xs.filter((x) => !x.deleted);

// ---------- Balances ----------

export type PocketBalance = { pocket: Pocket; balanceCents: number };

export function pocketBalances(l: Ledger): PocketBalance[] {
  const bal = new Map<string, number>();
  for (const p of l.pockets) bal.set(p.id, p.openingBalanceCents);
  const add = (id: string, c: number) => bal.set(id, (bal.get(id) ?? 0) + c);
  for (const t of live(l.transactions)) add(t.pocketId, t.type === 'income' ? t.amountCents : -t.amountCents);
  for (const t of live(l.transfers)) { add(t.fromPocketId, -t.amountOutCents); add(t.toPocketId, t.amountInCents); }
  for (const c of live(l.contributions)) add(c.pocketId, -c.amountFromPocketCents);
  return l.pockets.filter((p) => !p.archived).map((pocket) => ({ pocket, balanceCents: bal.get(pocket.id) ?? 0 }));
}

/** Sum per currency first, then convert once (keeps rounding small and explainable). */
function sumToHome(byCur: Record<Currency, number>, l: Ledger): number {
  return (Object.keys(byCur) as Currency[]).reduce(
    (acc, cur) => acc + convertCents(byCur[cur], cur, l.homeCurrency, l.lrdPerUsd), 0);
}

export type Totals = {
  availableHomeCents: number; totalHomeCents: number;
  availableByCurrency: Record<Currency, number>; lockedByCurrency: Record<Currency, number>;
};

export function totals(l: Ledger): Totals {
  const avail: Record<Currency, number> = { USD: 0, LRD: 0 };
  const locked: Record<Currency, number> = { USD: 0, LRD: 0 };
  for (const { pocket, balanceCents } of pocketBalances(l)) {
    (pocket.spendable ? avail : locked)[pocket.currency] += balanceCents;
  }
  const availableHomeCents = sumToHome(avail, l);
  const all = { USD: avail.USD + locked.USD, LRD: avail.LRD + locked.LRD };
  return { availableHomeCents, totalHomeCents: sumToHome(all, l), availableByCurrency: avail, lockedByCurrency: locked };
}

// ---------- Spending summaries ----------

export type PeriodSummary = {
  start: string; end: string; incomeHomeCents: number; expenseHomeCents: number;
  byCategory: { category: string; homeCents: number; count: number }[]; entryCount: number;
};

export function periodSummary(l: Ledger, start: string, end: string, category?: string): PeriodSummary {
  const inRange = live(l.transactions).filter(
    (t) => t.occurredOn >= start && t.occurredOn <= end && (!category || t.category === category));
  const income: Record<Currency, number> = { USD: 0, LRD: 0 };
  const expense: Record<Currency, number> = { USD: 0, LRD: 0 };
  const cats = new Map<string, { cur: Record<Currency, number>; count: number }>();
  for (const t of inRange) {
    if (t.type === 'income') { income[t.currency] += t.amountCents; continue; }
    expense[t.currency] += t.amountCents;
    const c = cats.get(t.category) ?? { cur: { USD: 0, LRD: 0 }, count: 0 };
    c.cur[t.currency] += t.amountCents; c.count += 1; cats.set(t.category, c);
  }
  const byCategory = [...cats.entries()]
    .map(([category, v]) => ({ category, homeCents: sumToHome(v.cur, l), count: v.count }))
    .sort((a, b) => b.homeCents - a.homeCents);
  return {
    start, end, incomeHomeCents: sumToHome(income, l), expenseHomeCents: sumToHome(expense, l),
    byCategory, entryCount: inRange.length,
  };
}

export function thisWeek(l: Ledger) { return periodSummary(l, weekStart(l.today), l.today); }
export function thisMonth(l: Ledger) { return periodSummary(l, monthStart(l.today), l.today); }

/** Usual weekly spending: expenses in the 28 days before today, divided by 4. */
export function usualWeeklySpend(l: Ledger) {
  const end = addDays(l.today, -1);
  const start = addDays(l.today, -28);
  const s = periodSummary(l, start, end);
  const firstEntry = live(l.transactions).map((t) => t.occurredOn).sort()[0] ?? null;
  const daysOfData = firstEntry ? daysBetween(firstEntry, l.today) : 0;
  return {
    weeklyHomeCents: Math.round(s.expenseHomeCents / 4), start, end,
    entryCount: s.byCategory.reduce((a, c) => a + c.count, 0), daysOfData,
  };
}

// ---------- Goal ----------

export type GoalStatus = {
  goal: Goal; savedCents: number; remainingCents: number; daysLeft: number; weeksLeft: number;
  paceNeededCents: number; yourPaceCents: number; projectedFinish: string | null; onTrack: boolean | null;
};

export function goalStatus(l: Ledger): GoalStatus | null {
  const g = l.goal;
  if (!g) return null;
  const contribs = live(l.contributions).filter((c) => c.goalId === g.id);
  const savedCents = contribs.reduce((a, c) => a + c.amountToGoalCents, 0);
  const remainingCents = Math.max(0, g.targetCents - savedCents);
  const daysLeft = Math.max(0, daysBetween(l.today, g.targetDate));
  const weeksLeft = daysLeft / 7;
  const paceNeededCents = remainingCents === 0 ? 0 : Math.ceil(remainingCents / Math.max(weeksLeft, 1));
  const recentStart = addDays(l.today, -28);
  const recent = contribs.filter((c) => c.occurredOn >= recentStart && c.occurredOn <= l.today)
    .reduce((a, c) => a + c.amountToGoalCents, 0);
  const yourPaceCents = Math.max(0, Math.round(recent / 4));
  let projectedFinish: string | null = null;
  if (remainingCents === 0) projectedFinish = l.today;
  else if (yourPaceCents > 0) projectedFinish = addDays(l.today, Math.ceil((remainingCents / yourPaceCents) * 7));
  const onTrack = projectedFinish ? projectedFinish <= g.targetDate : null;
  return { goal: g, savedCents, remainingCents, daysLeft, weeksLeft, paceNeededCents, yourPaceCents, projectedFinish, onTrack };
}

// ---------- Can I afford it? ----------

export type Verdict = 'yes' | 'yes_but' | 'not_yet';
export type MathLine = { label: string; value: string; source: string };
export type Affordability = {
  verdict: Verdict; reason: string; priceHomeCents: number; availableHomeCents: number;
  leftAfterHomeCents: number; weeklySpendHomeCents: number; safetyLineHomeCents: number;
  daysOfSpendingLeft: number | null; roughEstimate: boolean;
  goal: null | { name: string; delayDays: number | null; finishBefore: string | null; finishAfter: string | null; targetDate: string; pushesPastTarget: boolean };
  math: MathLine[];
};

/**
 * Rules (approved in Stage 3):
 *  Not yet  - price > available, or less than half a week of usual spending left after buying.
 *  Yes, but - less than one week of usual spending left, or the goal is pushed past its target date.
 *  Yes      - otherwise.
 */
export function affordability(l: Ledger, priceCents: number, priceCurrency: Currency, itemName = 'it'): Affordability {
  const H = l.homeCurrency;
  const fm = (c: number) => formatMoney(c, H);
  const P = convertCents(priceCents, priceCurrency, H, l.lrdPerUsd);
  const t = totals(l);
  const A = t.availableHomeCents;
  const left = A - P;
  const usual = usualWeeklySpend(l);
  const S = usual.weeklyHomeCents;
  const half = Math.round(S / 2);
  const roughEstimate = usual.daysOfData < 14;
  const math: MathLine[] = [];

  math.push({ label: `Price of ${itemName}`, value: fm(P),
    source: priceCurrency === H ? 'From your message' : `${formatMoney(priceCents, priceCurrency)} at your rate L$${l.lrdPerUsd} = $1` });
  const parts = pocketBalances(l).filter((b) => b.pocket.spendable)
    .map((b) => `${formatMoney(b.balanceCents, b.pocket.currency)} ${b.pocket.name}`);
  const lockedNames = pocketBalances(l).filter((b) => !b.pocket.spendable).map((b) => b.pocket.name);
  math.push({ label: 'Available to spend', value: fm(A),
    source: `${parts.join(' + ') || 'No spendable pockets'}${parts.length ? `, at your rate L$${l.lrdPerUsd} = $1` : ''}.${lockedNames.length ? ` Not included: ${lockedNames.join(', ')}.` : ''}` });
  math.push({ label: 'Left after buying', value: fm(left), source: `${fm(A)} - ${fm(P)}` });
  math.push({ label: 'Usual weekly spending', value: fm(S),
    source: `Your expenses from ${prettyDate(usual.start)} to ${prettyDate(usual.end)} (${usual.entryCount} entries), divided by 4` });
  math.push({ label: 'Safety line', value: fm(half), source: 'Half a week of usual spending' });

  // Goal effect
  let goal: Affordability['goal'] = null;
  let pushesPast = false;
  const gs = goalStatus(l);
  if (gs) {
    const pg = convertCents(priceCents, priceCurrency, gs.goal.currency, l.lrdPerUsd);
    if (gs.yourPaceCents > 0 && gs.projectedFinish) {
      const delayDays = Math.ceil((pg / gs.yourPaceCents) * 7);
      const after = addDays(gs.projectedFinish, delayDays);
      pushesPast = after > gs.goal.targetDate;
      goal = { name: gs.goal.name, delayDays, finishBefore: gs.projectedFinish, finishAfter: after, targetDate: gs.goal.targetDate, pushesPastTarget: pushesPast };
      math.push({ label: 'Goal delay', value: `about ${delayDays} days`,
        source: `${formatMoney(pg, gs.goal.currency)} / your ${formatMoney(gs.yourPaceCents, gs.goal.currency)} a week of ${gs.goal.name} saving. Finish moves from ${prettyDate(gs.projectedFinish, true)} to ${prettyDate(after, true)} (target ${prettyDate(gs.goal.targetDate, true)}).` });
    } else {
      goal = { name: gs.goal.name, delayDays: null, finishBefore: null, finishAfter: null, targetDate: gs.goal.targetDate, pushesPastTarget: false };
      math.push({ label: 'Goal delay', value: 'cannot estimate', source: `You have not added to your ${gs.goal.name} goal in the last 4 weeks, so there is no saving pace to measure.` });
    }
  }

  let verdict: Verdict; let reason: string;
  if (P > A) { verdict = 'not_yet'; reason = 'The price is more than you have available to spend.'; }
  else if (S > 0 && left < half) { verdict = 'not_yet'; reason = 'You would have less than half a week of usual spending left.'; }
  else if (S > 0 && left < S) { verdict = 'yes_but'; reason = 'You would have less than one week of usual spending left.'; }
  else if (pushesPast) { verdict = 'yes_but'; reason = `It would push your ${goal!.name} goal past its target date.`; }
  else { verdict = 'yes'; reason = 'You would still have at least a week of usual spending left.'; }
  if (verdict === 'not_yet' && pushesPast) reason += ` It would also push your ${goal!.name} goal past its target date.`;

  const daysOfSpendingLeft = S > 0 ? Math.round((Math.max(left, 0) / S) * 7 * 10) / 10 : null;
  return { verdict, reason, priceHomeCents: P, availableHomeCents: A, leftAfterHomeCents: left,
    weeklySpendHomeCents: S, safetyLineHomeCents: half, daysOfSpendingLeft, roughEstimate, goal, math };
}

// ---------- Weekly limit ----------

export function budgetStatus(l: Ledger) {
  const b = l.budget;
  if (!b) return null;
  const start = weekStart(l.today);
  const end = addDays(start, 6);
  const used: Record<Currency, number> = { USD: 0, LRD: 0 };
  for (const t of live(l.transactions)) {
    if (t.type !== 'expense' || t.occurredOn < start || t.occurredOn > l.today) continue;
    if (b.category && t.category !== b.category) continue;
    used[t.currency] += t.amountCents;
  }
  const usedCents = (Object.keys(used) as Currency[]).reduce(
    (a, c) => a + convertCents(used[c], c, b.currency, l.lrdPerUsd), 0);
  const pct = Math.round((usedCents / b.limitCents) * 100);
  return { budget: b, usedCents, pct, daysLeft: daysBetween(l.today, end) + 1, level: pct >= 100 ? 'over' : pct >= 80 ? 'near' : 'ok' };
}

// ---------- Monthly report ----------

/** This month so far: earned, spent, put toward the goal, and earned minus spent. */
export function monthReport(l: Ledger) {
  const start = monthStart(l.today);
  const s = periodSummary(l, start, l.today);
  const g = l.goal;
  const toGoalGoalCur = g
    ? live(l.contributions).filter((c) => c.goalId === g.id && c.occurredOn >= start && c.occurredOn <= l.today)
        .reduce((a, c) => a + c.amountToGoalCents, 0)
    : 0;
  const toGoalHomeCents = g ? convertCents(toGoalGoalCur, g.currency, l.homeCurrency, l.lrdPerUsd) : 0;
  return {
    start, end: l.today,
    incomeHomeCents: s.incomeHomeCents, expenseHomeCents: s.expenseHomeCents,
    differenceHomeCents: s.incomeHomeCents - s.expenseHomeCents,
    toGoalHomeCents, topCategory: s.byCategory[0] ?? null, entryCount: s.entryCount,
  };
}

// ---------- Insight of the week ----------

export type Insight = { kind: 'not_enough' | 'up' | 'down' | 'same' | 'new'; text: string; math: MathLine[] };

/**
 * One plain sentence, written by code (no AI): the biggest spending category in the
 * last 7 days, compared with the 7 days before. Needs at least 3 expenses in the last 7 days.
 */
export function weeklyInsight(l: Ledger, labels: Record<string, string> = {}): Insight {
  const h = l.homeCurrency;
  const nowStart = addDays(l.today, -6);
  const prevEnd = addDays(l.today, -7);
  const prevStart = addDays(l.today, -13);
  const now = periodSummary(l, nowStart, l.today);
  const expenses = now.byCategory.reduce((a, c) => a + c.count, 0);
  if (expenses < 3 || !now.byCategory[0]) {
    return { kind: 'not_enough', text: 'Record a few more expenses this week and I will show you where your money goes.', math: [] };
  }
  const top = now.byCategory[0];
  const name = labels[top.category] ?? top.category;
  const before = periodSummary(l, prevStart, prevEnd, top.category).expenseHomeCents;
  const nowAmt = formatMoney(top.homeCents, h);
  const math: MathLine[] = [
    { label: `${name}, last 7 days`, value: nowAmt, source: `${prettyDate(nowStart)} to ${prettyDate(l.today)}` },
    { label: `${name}, 7 days before`, value: formatMoney(before, h), source: `${prettyDate(prevStart)} to ${prettyDate(prevEnd)}` },
  ];
  const lead = `${name} was your biggest spend in the last 7 days: ${nowAmt}.`;
  if (before === 0) return { kind: 'new', text: `${lead} You spent nothing on it the 7 days before.`, math };
  const diff = top.homeCents - before;
  // Changes under 20% count as "about the same", so small wobbles don't sound like news.
  if (Math.abs(diff) * 5 < before) return { kind: 'same', text: `${lead} That is about the same as the 7 days before.`, math };
  return diff > 0
    ? { kind: 'up', text: `${lead} That is ${formatMoney(diff, h)} more than the 7 days before.`, math }
    : { kind: 'down', text: `${lead} That is ${formatMoney(-diff, h)} less than the 7 days before. Nice work.`, math };
}
