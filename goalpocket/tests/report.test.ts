import { describe, it, expect } from 'vitest';
import { monthReport, weeklyInsight, type Ledger, type Txn } from '../src/lib/engine';

const exp = (id: string, d: string, cents: number, category = 'transport', currency: 'USD' | 'LRD' = 'USD'): Txn =>
  ({ id, type: 'expense', pocketId: currency === 'USD' ? 'usd' : 'lrd', amountCents: cents, currency, category, description: category, occurredOn: d });

function ledger(transactions: Txn[]): Ledger {
  return {
    today: '2026-11-14', homeCurrency: 'USD', lrdPerUsd: 172,
    pockets: [
      { id: 'usd', name: 'USD cash', kind: 'cash', currency: 'USD', openingBalanceCents: 50000, spendable: true },
      { id: 'lrd', name: 'LRD cash', kind: 'cash', currency: 'LRD', openingBalanceCents: 500000, spendable: true },
    ],
    transactions, transfers: [],
    contributions: [
      { id: 'c1', goalId: 'g', pocketId: 'usd', amountFromPocketCents: 2000, amountToGoalCents: 2000, occurredOn: '2026-10-30' },
      { id: 'c2', goalId: 'g', pocketId: 'usd', amountFromPocketCents: 2000, amountToGoalCents: 2000, occurredOn: '2026-11-08' },
      { id: 'c3', goalId: 'g', pocketId: 'usd', amountFromPocketCents: 1500, amountToGoalCents: 1500, occurredOn: '2026-11-12' },
    ],
    goal: { id: 'g', name: 'Laptop', targetCents: 50000, currency: 'USD', targetDate: '2027-03-31' },
    budget: null,
  };
}
const labels = { transport: 'Transport', food: 'Food' };

describe('monthly report', () => {
  it('adds up this month only, converting LRD once', () => {
    const l = ledger([
      exp('a', '2026-10-31', 9999),                       // last month: left out
      exp('b', '2026-11-02', 1000),
      exp('c', '2026-11-10', 30000, 'food', 'LRD'),       // L$300 = $1.74
      { id: 'i', type: 'income', pocketId: 'usd', amountCents: 8000, currency: 'USD', category: 'income', description: 'sales', occurredOn: '2026-11-05' },
    ]);
    const r = monthReport(l);
    expect(r.start).toBe('2026-11-01');
    expect(r.incomeHomeCents).toBe(8000);
    expect(r.expenseHomeCents).toBe(1174);
    expect(r.differenceHomeCents).toBe(6826);
    expect(r.toGoalHomeCents).toBe(3500); // 20 + 15, not the October one
    expect(r.topCategory?.category).toBe('transport'); // $10.00 beats $1.74
  });
});

describe('insight of the week', () => {
  it('waits for at least 3 expenses', () => {
    const i = weeklyInsight(ledger([exp('a', '2026-11-13', 500), exp('b', '2026-11-14', 500)]), labels);
    expect(i.kind).toBe('not_enough');
  });
  it('says when the top category went up', () => {
    const i = weeklyInsight(ledger([exp('a', '2026-11-08', 200), exp('b', '2026-11-10', 200), exp('c', '2026-11-14', 200), exp('p', '2026-11-03', 300)]), labels);
    expect(i.kind).toBe('up');
    expect(i.text).toBe('Transport was your biggest spend in the last 7 days: $6.00. That is $3.00 more than the 7 days before.');
    expect(i.math.map((m) => m.value)).toEqual(['$6.00', '$3.00']);
  });
  it('says when it went down', () => {
    const i = weeklyInsight(ledger([exp('a', '2026-11-09', 200, 'food'), exp('b', '2026-11-11', 200, 'food'), exp('c', '2026-11-13', 200, 'food'), exp('p', '2026-11-01', 1000, 'food')]), labels);
    expect(i.kind).toBe('down');
    expect(i.text).toContain('$4.00 less');
  });
  it('treats a change under 20% as about the same', () => {
    const i = weeklyInsight(ledger([exp('a', '2026-11-08', 200), exp('b', '2026-11-10', 200), exp('c', '2026-11-14', 200), exp('p', '2026-11-07', 550)]), labels);
    expect(i.kind).toBe('same');
  });
  it('handles nothing spent the week before', () => {
    const i = weeklyInsight(ledger([exp('a', '2026-11-08', 200), exp('b', '2026-11-10', 200), exp('c', '2026-11-14', 200)]), labels);
    expect(i.kind).toBe('new');
    expect(i.text).toContain('You spent nothing on it the 7 days before.');
  });
});
