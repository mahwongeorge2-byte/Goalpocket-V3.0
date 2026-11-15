import 'server-only';
import { asUser } from './db';
import { loadLedger, recentTransactions, categories } from './repo';
import { pocketBalances, totals, thisWeek, thisMonth, goalStatus, budgetStatus, monthReport, weeklyInsight } from './engine';

/** Everything the Money and Goal screens show. All numbers come from the engine. */
export async function appState(uid: string) {
  return asUser(uid, async (tx) => {
    const { ledger, profile } = await loadLedger(tx);
    const cats = await categories(tx);
    const label = Object.fromEntries(cats.map((c) => [c.key, c]));
    const week = thisWeek(ledger);
    const month = thisMonth(ledger);
    const names = Object.fromEntries(cats.map((c) => [c.key, c.label]));
    const report = monthReport(ledger);
    return {
      profile,
      today: ledger.today,
      rate: ledger.lrdPerUsd,
      home: ledger.homeCurrency,
      pockets: pocketBalances(ledger).map((b) => ({ id: b.pocket.id, name: b.pocket.name, kind: b.pocket.kind, currency: b.pocket.currency, spendable: b.pocket.spendable, balanceCents: b.balanceCents })),
      totals: totals(ledger),
      week: { ...week, byCategory: week.byCategory.map((c) => ({ ...c, label: label[c.category]?.label ?? c.category })) },
      month: { ...month, byCategory: month.byCategory.map((c) => ({ ...c, label: label[c.category]?.label ?? c.category })) },
      report: { ...report, topLabel: report.topCategory ? names[report.topCategory.category] ?? report.topCategory.category : null },
      insight: weeklyInsight(ledger, names),
      recent: await recentTransactions(tx, 15),
      goal: goalStatus(ledger),
      budget: budgetStatus(ledger),
      categories: cats,
    };
  });
}
export type AppState = Awaited<ReturnType<typeof appState>>;
