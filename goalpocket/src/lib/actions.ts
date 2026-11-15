import 'server-only';
// Turning proposals into pending actions, and pending actions into saved records.
// Every rule from Stage 3, section 6 lives here, so the AI path and the manual
// path share exactly the same checks.
import type { Tx } from './db';
import type { Ledger } from './engine';
import { convertCents, formatMoney, toCents, type Currency } from './money';
import { addDays, daysBetween, isISODate } from './dates';
import { insertTransaction, rememberCategory } from './repo';

const SANITY: Record<Currency, number> = { USD: 100_000 * 100, LRD: 20_000_000 * 100 };

export type TxnItem = {
  type: 'income' | 'expense'; amountCents: number; currency: Currency; pocketId: string; pocketName: string;
  category: string; description: string; date: string; warnings: string[];
};

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

function checkAmount(amount: number, currency: Currency, warnings: string[]): Check<number> {
  const c = toCents(amount);
  if (c === null) return { ok: false, error: 'Amount must be greater than zero.' };
  if (c > SANITY[currency] * 100) return { ok: false, error: `${formatMoney(c, currency)} is far too large to record.` };
  if (c > SANITY[currency]) warnings.push(`That is a very large amount (${formatMoney(c, currency)}). Is it right?`);
  return { ok: true, value: c };
}

function checkDate(date: string, today: string, warnings: string[]): Check<string> {
  if (!isISODate(date)) return { ok: false, error: 'Date must be a real date (YYYY-MM-DD).' };
  if (date > today) return { ok: false, error: 'Date cannot be in the future.' };
  if (daysBetween(date, today) > 60) warnings.push('This date is more than 60 days ago.');
  return { ok: true, value: date };
}

export function validateTxnItem(l: Ledger, raw: { type: 'income' | 'expense'; amount: number; currency: Currency; pocket_id: string; category: string; description: string; date: string }): Check<TxnItem> {
  const warnings: string[] = [];
  const pocket = l.pockets.find((p) => p.id === raw.pocket_id);
  if (!pocket) return { ok: false, error: `Unknown pocket ${raw.pocket_id}. Use an id from the pocket list, or ask the user which pocket.` };
  if (pocket.currency !== raw.currency) return { ok: false, error: `${pocket.name} holds ${pocket.currency}, but the amount is in ${raw.currency}. Ask the user which pocket or currency.` };
  const a = checkAmount(raw.amount, raw.currency, warnings); if (!a.ok) return a;
  const d = checkDate(raw.date, l.today, warnings); if (!d.ok) return d;
  return { ok: true, value: { type: raw.type, amountCents: a.value, currency: raw.currency, pocketId: pocket.id, pocketName: pocket.name, category: raw.category, description: raw.description.trim() || (raw.type === 'income' ? 'Income' : 'Expense'), date: d.value, warnings } };
}

// ---------- Pending payloads ----------
export type Pending =
  | { kind: 'transactions'; items: TxnItem[] }
  | { kind: 'transfer'; fromPocketId: string; fromName: string; toPocketId: string; toName: string; outCents: number; outCurrency: Currency; inCents: number; inCurrency: Currency; feeCents: number; date: string; warnings: string[] }
  | { kind: 'goal'; name: string; targetCents: number; currency: Currency; targetDate: string }
  | { kind: 'goal_contribution'; goalId: string; goalName: string; pocketId: string; pocketName: string; fromCents: number; fromCurrency: Currency; toGoalCents: number; goalCurrency: Currency; date: string }
  | { kind: 'edit'; transactionId: string; before: Record<string, unknown>; changes: { amountCents?: number; category?: string; description?: string; date?: string; pocketId?: string } }
  | { kind: 'delete'; transactionId: string; summary: string }
  | { kind: 'budget'; limitCents: number; currency: Currency; category: string | null };

export function buildTransfer(l: Ledger, i: { from_pocket_id: string; to_pocket_id: string; amount_out: number; amount_in: number | null; fee: number | null; date: string }): Check<Pending> {
  const from = l.pockets.find((p) => p.id === i.from_pocket_id);
  const to = l.pockets.find((p) => p.id === i.to_pocket_id);
  if (!from || !to) return { ok: false, error: 'Unknown pocket. Use ids from the pocket list.' };
  if (from.id === to.id) return { ok: false, error: 'From and to pockets must be different.' };
  const warnings: string[] = [];
  const out = checkAmount(i.amount_out, from.currency, warnings); if (!out.ok) return out;
  let inCents: number;
  if (i.amount_in != null) { const r = checkAmount(i.amount_in, to.currency, warnings); if (!r.ok) return r; inCents = r.value; }
  else if (from.currency === to.currency) inCents = out.value;
  else return { ok: false, error: `Money moves from ${from.currency} to ${to.currency}. Ask the user how much arrived in ${to.name}.` };
  const feeCents = i.fee ? toCents(i.fee) ?? 0 : 0;
  const d = checkDate(i.date, l.today, warnings); if (!d.ok) return d;
  return { ok: true, value: { kind: 'transfer', fromPocketId: from.id, fromName: from.name, toPocketId: to.id, toName: to.name, outCents: out.value, outCurrency: from.currency, inCents, inCurrency: to.currency, feeCents, date: d.value, warnings } };
}

export function buildGoal(l: Ledger, i: { name: string; target_amount: number; currency: Currency; target_date: string }): Check<Pending> {
  const t = toCents(i.target_amount); if (!t) return { ok: false, error: 'Target must be greater than zero.' };
  if (!isISODate(i.target_date) || i.target_date <= l.today) return { ok: false, error: 'Target date must be a real date after today.' };
  return { ok: true, value: { kind: 'goal', name: i.name.trim(), targetCents: t, currency: i.currency, targetDate: i.target_date } };
}

export function buildContribution(l: Ledger, i: { pocket_id: string; amount: number; date: string }): Check<Pending> {
  if (!l.goal) return { ok: false, error: 'There is no savings goal yet. Offer to create one.' };
  const p = l.pockets.find((x) => x.id === i.pocket_id); if (!p) return { ok: false, error: 'Unknown pocket.' };
  const w: string[] = [];
  const a = checkAmount(i.amount, p.currency, w); if (!a.ok) return a;
  const d = checkDate(i.date, l.today, w); if (!d.ok) return d;
  return { ok: true, value: { kind: 'goal_contribution', goalId: l.goal.id, goalName: l.goal.name, pocketId: p.id, pocketName: p.name, fromCents: a.value, fromCurrency: p.currency, toGoalCents: convertCents(a.value, p.currency, l.goal.currency, l.lrdPerUsd), goalCurrency: l.goal.currency, date: d.value } };
}

export function buildBudget(i: { weekly_limit: number; currency: Currency; category: string | null }): Check<Pending> {
  const c = toCents(i.weekly_limit); if (!c) return { ok: false, error: 'Limit must be greater than zero.' };
  return { ok: true, value: { kind: 'budget', limitCents: c, currency: i.currency, category: i.category } };
}

/** Short, code-written description of a pending action (used on cards and as fallback text). */
export function describePending(p: Pending): string {
  switch (p.kind) {
    case 'transactions': return p.items.map((i) => `${i.type === 'income' ? 'Income' : 'Expense'}: ${formatMoney(i.amountCents, i.currency)} ${i.description} (${i.pocketName})`).join('; ');
    case 'transfer': return `Move ${formatMoney(p.outCents, p.outCurrency)} from ${p.fromName} to ${p.toName}${p.feeCents ? `, fee ${formatMoney(p.feeCents, p.outCurrency)}` : ''}`;
    case 'goal': return `Goal: ${p.name}, ${formatMoney(p.targetCents, p.currency)} by ${p.targetDate}`;
    case 'goal_contribution': return `Add ${formatMoney(p.fromCents, p.fromCurrency)} from ${p.pocketName} to ${p.goalName}`;
    case 'edit': return 'Change an entry';
    case 'delete': return `Remove: ${p.summary}`;
    case 'budget': return `Weekly limit: ${formatMoney(p.limitCents, p.currency)}`;
  }
}

/** Apply a confirmed pending action. Runs inside asUser (RLS on). */
export async function applyPending(tx: Tx, uid: string, l: Ledger, p: Pending): Promise<string> {
  switch (p.kind) {
    case 'transactions': {
      for (const i of p.items) {
        await insertTransaction(tx, uid, { type: i.type, pocketId: i.pocketId, amountCents: i.amountCents, currency: i.currency, category: i.category, description: i.description, occurredOn: i.date });
      }
      return `Saved ${p.items.length} ${p.items.length === 1 ? 'entry' : 'entries'}.`;
    }
    case 'transfer': {
      const [t] = await tx`insert into transfers (user_id, from_pocket_id, to_pocket_id, amount_out_cents, amount_in_cents, occurred_on)
        values (${uid}, ${p.fromPocketId}, ${p.toPocketId}, ${p.outCents}, ${p.inCents}, ${p.date}) returning id`;
      if (p.feeCents > 0) {
        await tx`insert into transactions (user_id, type, pocket_id, amount_cents, currency, category, description, occurred_on, transfer_id)
          values (${uid}, 'expense', ${p.fromPocketId}, ${p.feeCents}, ${p.outCurrency}, 'fees', ${'Fee: ' + p.fromName + ' to ' + p.toName}, ${p.date}, ${t.id})`;
      }
      return 'Transfer saved.';
    }
    case 'goal': {
      await tx`update goals set status = 'archived' where status = 'active'`;
      await tx`insert into goals (user_id, name, target_cents, currency, target_date) values (${uid}, ${p.name}, ${p.targetCents}, ${p.currency}, ${p.targetDate})`;
      return 'Goal saved.';
    }
    case 'goal_contribution': {
      await tx`insert into goal_contributions (user_id, goal_id, pocket_id, amount_from_pocket_cents, amount_to_goal_cents, occurred_on)
        values (${uid}, ${p.goalId}, ${p.pocketId}, ${p.fromCents}, ${p.toGoalCents}, ${p.date})`;
      return 'Added to your goal.';
    }
    case 'edit': {
      const [cur] = await tx`select * from transactions where id = ${p.transactionId} and not deleted`;
      if (!cur) throw new Error('Entry not found');
      const c = p.changes;
      const pocketId = c.pocketId ?? cur.pocket_id;
      const pocket = l.pockets.find((x) => x.id === pocketId);
      if (!pocket) throw new Error('Unknown pocket');
      await tx`update transactions set amount_cents = ${c.amountCents ?? cur.amount_cents}, category = ${c.category ?? cur.category},
        description = ${c.description ?? cur.description}, occurred_on = ${c.date ?? cur.occurred_on}, pocket_id = ${pocketId},
        currency = ${pocket.currency}, updated_at = now() where id = ${p.transactionId}`;
      if (c.category && c.category !== cur.category) await rememberCategory(tx, uid, c.description ?? cur.description, c.category);
      return 'Entry updated.';
    }
    case 'delete': {
      await tx`update transactions set deleted = true, updated_at = now() where id = ${p.transactionId}`;
      return 'Entry removed.';
    }
    case 'budget': {
      await tx`update budgets set active = false where active`;
      await tx`insert into budgets (user_id, category, limit_cents, currency) values (${uid}, ${p.category}, ${p.limitCents}, ${p.currency})`;
      return 'Weekly limit saved.';
    }
  }
}

export const _test = { checkDate, checkAmount, addDays };
