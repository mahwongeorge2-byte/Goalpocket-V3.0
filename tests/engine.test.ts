import { describe, it, expect } from 'vitest';
import { convertCents, formatMoney } from '../src/lib/money';
import { weekStart, addDays, daysBetween } from '../src/lib/dates';
import { pocketBalances, totals, goalStatus, affordability, usualWeeklySpend, periodSummary, budgetStatus, type Ledger } from '../src/lib/engine';

// The fictional user from the Stage 4 mockups. Every expected value below was
// worked out by hand in the Stage 4 design notes.
function stage4Ledger(): Ledger {
  const usdExp = (id: string, d: string) => ({ id, type: 'expense' as const, pocketId: 'usd', amountCents: 4800, currency: 'USD' as const, category: 'food', description: 'food', occurredOn: d });
  const contrib = (id: string, d: string, c: number) => ({ id, goalId: 'g', pocketId: 'om', amountFromPocketCents: c, amountToGoalCents: c, occurredOn: d });
  return {
    today: '2026-11-14', homeCurrency: 'USD', lrdPerUsd: 172,
    pockets: [
      { id: 'usd', name: 'USD cash', kind: 'cash', currency: 'USD', openingBalanceCents: 22800, spendable: true },
      { id: 'lrd', name: 'LRD cash', kind: 'cash', currency: 'LRD', openingBalanceCents: 245000, spendable: true },
      { id: 'om', name: 'Orange Money', kind: 'orange_money', currency: 'USD', openingBalanceCents: 19600, spendable: true },
      { id: 'momo', name: 'MoMo', kind: 'momo', currency: 'LRD', openingBalanceCents: 480000, spendable: true },
      { id: 'susu', name: 'Susu', kind: 'susu', currency: 'LRD', openingBalanceCents: 500000, spendable: false },
    ],
    transactions: [
      usdExp('e1', '2026-10-20'), usdExp('e2', '2026-10-27'), usdExp('e3', '2026-11-03'), usdExp('e4', '2026-11-10'),
      { id: 'keke', type: 'expense', pocketId: 'lrd', amountCents: 30000, currency: 'LRD', category: 'transport', description: 'keke', occurredOn: '2026-11-14' },
      { id: 'cook', type: 'expense', pocketId: 'usd', amountCents: 200, currency: 'USD', category: 'food', description: 'cookshop', occurredOn: '2026-11-14' },
    ],
    transfers: [],
    contributions: [contrib('c0', '2026-10-01', 6000), contrib('c1', '2026-10-18', 2000), contrib('c2', '2026-10-25', 2000), contrib('c3', '2026-11-01', 2000), contrib('c4', '2026-11-08', 2000)],
    goal: { id: 'g', name: 'Laptop', targetCents: 50000, currency: 'USD', targetDate: '2027-03-31' },
    budget: null,
  };
}

describe('money', () => {
  it('converts once and rounds half up', () => {
    expect(convertCents(695000, 'LRD', 'USD', 172)).toBe(4041); // 4040.70
    expect(convertCents(100, 'USD', 'LRD', 171.55)).toBe(17155);
    expect(convertCents(500, 'USD', 'USD', 172)).toBe(500);
  });
  it('rejects a zero rate', () => {
    expect(() => convertCents(100, 'USD', 'LRD', 0)).toThrow();
  });
  it('formats both currencies', () => {
    expect(formatMoney(13041, 'USD')).toBe('$130.41');
    expect(formatMoney(215000, 'LRD')).toBe('L$2,150');
    expect(formatMoney(215050, 'LRD')).toBe('L$2,150.50');
    expect(formatMoney(-500, 'USD')).toBe('-$5.00');
  });
});

describe('dates', () => {
  it('finds Monday and counts days', () => {
    expect(weekStart('2026-11-14')).toBe('2026-11-09');
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
    expect(addDays('2026-11-14', 126)).toBe('2027-03-20');
    expect(daysBetween('2026-11-14', '2027-03-31')).toBe(137);
  });
});

describe('engine with the Stage 4 sample user', () => {
  const l = stage4Ledger();

  it('pocket balances match the mockups', () => {
    const b = Object.fromEntries(pocketBalances(l).map((x) => [x.pocket.id, x.balanceCents]));
    expect(b).toEqual({ usd: 3400, lrd: 215000, om: 5600, momo: 480000, susu: 500000 });
  });

  it('available $130.41, total with susu $159.48', () => {
    const t = totals(l);
    expect(t.availableHomeCents).toBe(13041);
    expect(t.totalHomeCents).toBe(15948);
  });

  it('usual weekly spending is $48.00 and ignores today', () => {
    const u = usualWeeklySpend(l);
    expect(u.weeklyHomeCents).toBe(4800);
    expect(u.start).toBe('2026-10-17');
    expect(u.end).toBe('2026-11-13');
    expect(u.entryCount).toBe(4);
  });

  it('goal: $140 saved, $18.40 a week needed, $20 a week pace, finish 20 Mar 2027', () => {
    const g = goalStatus(l)!;
    expect(g.savedCents).toBe(14000);
    expect(g.remainingCents).toBe(36000);
    expect(g.paceNeededCents).toBe(1840);
    expect(g.yourPaceCents).toBe(2000);
    expect(g.projectedFinish).toBe('2027-03-20');
    expect(g.onTrack).toBe(true);
  });

  it('a $120 phone is "Not yet", leaves $10.41, delays the goal 42 days to 1 May 2027', () => {
    const a = affordability(l, 12000, 'USD', 'phone');
    expect(a.verdict).toBe('not_yet');
    expect(a.leftAfterHomeCents).toBe(1041);
    expect(a.safetyLineHomeCents).toBe(2400);
    expect(a.daysOfSpendingLeft).toBe(1.5);
    expect(a.goal?.delayDays).toBe(42);
    expect(a.goal?.finishAfter).toBe('2027-05-01');
    expect(a.goal?.pushesPastTarget).toBe(true);
    expect(a.roughEstimate).toBe(false);
    expect(a.math.map((m) => m.value)).toContain('$130.41');
  });

  it('a $5 snack is "Yes"', () => {
    expect(affordability(l, 500, 'USD', 'snack').verdict).toBe('yes');
  });

  it('a $90 item is "Yes, but" (less than a week of spending left)', () => {
    const a = affordability(l, 9000, 'USD');
    expect(a.leftAfterHomeCents).toBe(4041);
    expect(a.verdict).toBe('yes_but');
  });

  it('a price above what is available is "Not yet"', () => {
    expect(affordability(l, 20000, 'USD').verdict).toBe('not_yet');
  });

  it('prices in Liberian dollars are converted at the user rate', () => {
    const a = affordability(l, 172000, 'LRD', 'shoes'); // L$1,720 = $10.00
    expect(a.priceHomeCents).toBe(1000);
  });

  it('deleted entries are ignored', () => {
    const l2 = stage4Ledger();
    l2.transactions = l2.transactions.map((t) => (t.id === 'keke' ? { ...t, deleted: true } : t));
    expect(pocketBalances(l2).find((b) => b.pocket.id === 'lrd')!.balanceCents).toBe(245000);
  });

  it('transfers move money between pockets without counting as spending', () => {
    const l2 = stage4Ledger();
    l2.transfers = [{ id: 't', fromPocketId: 'om', toPocketId: 'usd', amountOutCents: 1000, amountInCents: 1000, occurredOn: '2026-11-14' }];
    expect(totals(l2).availableHomeCents).toBe(13041);
    expect(periodSummary(l2, '2026-11-14', '2026-11-14').expenseHomeCents).toBe(convertCents(30000, 'LRD', 'USD', 172) + 200);
  });

  it('weekly limit warns at 80% and above', () => {
    const l2 = stage4Ledger();
    l2.budget = { id: 'b', category: null, limitCents: 6000, currency: 'USD' };
    const b = budgetStatus(l2)!; // this week: $48 (10 Nov) + $2 + L$300 ($1.74) = $51.74
    expect(b.usedCents).toBe(5174);
    expect(b.level).toBe('near');
    expect(b.daysLeft).toBe(2);
  });

  it('flags a rough estimate with under 14 days of data', () => {
    const l2 = stage4Ledger();
    l2.transactions = l2.transactions.filter((t) => t.occurredOn >= '2026-11-10');
    expect(affordability(l2, 500, 'USD').roughEstimate).toBe(true);
  });
});
