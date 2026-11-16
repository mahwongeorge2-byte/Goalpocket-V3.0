import 'server-only';
import { offlineCreate, DEMO_MODE_HELP } from './offline';
import type Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaMessageParam, BetaToolResultBlockParam, BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { geminiCreate } from './gemini';
import { asUser } from '../db';
import { loadLedger, categoryRules, chatHistory, addChat, createPending, hitRateLimit, recentTransactions } from '../repo';
import { affordability, budgetStatus, goalStatus, periodSummary, pocketBalances, totals, type Affordability, type Ledger } from '../engine';
import { formatMoney, formatRate, toCents, type Currency } from '../money';
import { prettyDate } from '../dates';
import { TOOLS, V, isToolName } from './tools';
import { SYSTEM_PROMPT, contextBlock } from './prompt';
import { unbackedNumbers } from './numbercheck';
import { validateTxnItem, buildTransfer, buildGoal, buildContribution, buildBudget, describePending, type Pending } from '../actions';

export const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MAX_STEPS = 6;
const MAX_INPUT = 500;

export type Card = { pendingId: string; pending: Pending };
export type ChatResult = {
  reply: string;
  cards: Card[];
  ask: { question: string; options: string[] } | null;
  affordability: Affordability | null;
  numberCheck: 'passed' | 'retried' | 'fallback';
  demoMode?: boolean;
  error?: 'no_api_key' | 'rate_limited' | 'too_long' | 'ai_unavailable' | 'refused';
};

type CreateFn = (params: Parameters<Anthropic['beta']['messages']['create']>[0]) => Promise<BetaMessage>;

function defaultCreate(): CreateFn | null {
  if (!process.env.GEMINI_API_KEY) return null;
  return geminiCreate as CreateFn;
}
const LABELS: Record<string, string> = {
  food: 'Food', transport: 'Transport', housing: 'Housing', utilities: 'Utilities', education: 'Education', health: 'Health',
  phone_data: 'Phone & Data', entertainment: 'Entertainment', shopping: 'Shopping', business: 'Business', family: 'Family & Support',
  fees: 'Fees', savings: 'Savings', income: 'Income', other: 'Other',
};

export async function runChat(uid: string, text: string, opts: { today?: string; create?: CreateFn | null; conversationId?: string } = {}): Promise<ChatResult> {
  const empty = { cards: [], ask: null, affordability: null, numberCheck: 'passed' as const };
  const message = text.trim();
  if (!message) return { ...empty, reply: 'Type what you spent or earned, or ask about your money.' };
  if (message.length > MAX_INPUT) return { ...empty, reply: `That message is a bit long. Please keep it under ${MAX_INPUT} characters.`, error: 'too_long' };

  // No key: use free demo mode (pattern matching, not AI) unless it is switched off.
  const create = opts.create === undefined
    ? (defaultCreate() ?? (process.env.GOALPOCKET_DEMO_MODE === 'off' ? null : (offlineCreate as unknown as CreateFn)))
    : opts.create;
  const demoMode = create === (offlineCreate as unknown);

  const ctx = await asUser(uid, async (tx) => {
    if (await hitRateLimit(tx, uid)) return null;
    const { ledger, profile } = await loadLedger(tx, opts.today);
    const rules = await categoryRules(tx);
    const history = await chatHistory(tx, 6, opts.conversationId);
    const conversationId = await addChat(tx, uid, 'user', { text: message }, opts.conversationId);
    return { ledger, profile, rules, history, conversationId };
  });
  if (!ctx) return { ...empty, reply: 'You are sending messages very fast. Please wait a minute and try again.', error: 'rate_limited' };

  if (!create) {
    const reply = 'The AI is not connected yet, so I cannot read messages. You can still add entries with the + button on the Money tab.';
    await asUser(uid, (tx) => addChat(tx, uid, 'assistant', { text: reply }, ctx.conversationId));
    return { ...empty, reply, error: 'no_api_key' };
  }

  const { ledger } = ctx;
  const context = contextBlock(ledger, ctx.profile.displayName, ctx.rules);
  // Earlier turns go in as plain text, so we never edit or re-send old model output.
  const historyText = ctx.history
    .map((h) => `${h.role === 'user' ? 'User' : 'Goalpocket'}: ${(h.content as { text?: string })?.text ?? ''}`)
    .join('\n');
  const userTurn = `${context}\n${historyText ? `<recent_conversation>\n${historyText}\n</recent_conversation>\n` : ''}<user_message>\n${message}\n</user_message>`;

  const sources: string[] = [context, historyText, message, ...(demoMode ? [DEMO_MODE_HELP] : [])];
  const cards: Card[] = [];
  let ask: ChatResult['ask'] = null;
  let afford: Affordability | null = null;
  const messages: BetaMessageParam[] = [{ role: 'user', content: userTurn }];
  let reply = '';
  let numberCheck: ChatResult['numberCheck'] = 'passed';
  let retried = false;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await create({
        model: MODEL,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages,
      });

      if (res.stop_reason === 'refusal') {
        reply = 'I can not help with that one. I can help you record money, answer questions about it, or check if you can afford something.';
        return await finish('refused');
      }
      messages.push({ role: 'assistant', content: res.content });
      const toolUses = res.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
      const textNow = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim();

      if (toolUses.length === 0) {
        reply = textNow;
        const bad = unbackedNumbers(reply, sources);
        if (bad.length === 0) break;
        if (!retried) {
          retried = true; numberCheck = 'retried';
          messages.push({ role: 'user', content: `[Goalpocket server check] Your reply used numbers that are not in any tool result or the context: ${bad.join(', ')}. Rewrite the reply using only numbers exactly as they appear in tool results, the context or the user message. Do not calculate.` });
          continue;
        }
        numberCheck = 'fallback';
        reply = fallbackReply(cards, afford);
        break;
      }

      const results: BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const out = await executeTool(uid, ledger, tu);
        if (out.card) cards.push(out.card);
        if (out.ask) ask = out.ask;
        if (out.affordability) afford = out.affordability;
        sources.push(out.content);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
      if (ask) { reply = ask.question; break; }
      if (step === MAX_STEPS - 1) reply = fallbackReply(cards, afford);
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('AI call failed', detail);
    const safeDetail = detail
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted key]')
      .replace(/AQ\.[A-Za-z0-9_-]{20,}/g, '[redacted key]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/\s+/g, ' ')
      .slice(0, 220);
    reply = cards.length || afford
      ? fallbackReply(cards, afford)
      : `I could not reach the AI just now. Please try again in a moment, or add the entry with the + button.\n\nDiagnostic: ${safeDetail}`;
    return await finish('ai_unavailable');
  }
  if (!reply) reply = fallbackReply(cards, afford);
  return await finish();

  async function finish(error?: ChatResult['error']): Promise<ChatResult> {
    await asUser(uid, (tx) => addChat(tx, uid, 'assistant', { text: reply, cards: cards.map((c) => c.pendingId), ask, affordability: afford }, ctx.conversationId));
    return { reply, cards, ask, affordability: afford, numberCheck, ...(demoMode ? { demoMode } : {}), ...(error ? { error } : {}) };
  }
}

/** Code-written reply used when the AI's wording can't be verified. */
function fallbackReply(cards: Card[], a: Affordability | null): string {
  if (a) return `${a.verdict === 'yes' ? 'Yes.' : a.verdict === 'yes_but' ? 'Yes, but…' : 'Not yet.'} ${a.reason} Tap Show the math to see every number.`;
  if (cards.length) return `Please check: ${cards.map((c) => describePending(c.pending)).join('; ')}. Tap Save if it is right.`;
  return 'Here is what I found. Please check the Money tab for the exact numbers.';
}

type ToolOut = { content: string; isError?: boolean; card?: Card; ask?: ChatResult['ask']; affordability?: Affordability };

async function executeTool(uid: string, l: Ledger, tu: BetaToolUseBlock): Promise<ToolOut> {
  const err = (m: string): ToolOut => ({ content: JSON.stringify({ error: m }), isError: true });
  if (!isToolName(tu.name)) return err(`Unknown tool ${tu.name}`);
  const parsed = V[tu.name].safeParse(tu.input);
  if (!parsed.success) return err(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const input = parsed.data as Record<string, unknown>;
  const H = l.homeCurrency;
  const fm = (c: number, cur: Currency = H) => formatMoney(c, cur);

  const propose = async (p: Pending): Promise<ToolOut> => {
    const pendingId = await asUser(uid, (tx) => createPending(tx, uid, p.kind, p));
    const warnings = p.kind === 'transactions' ? p.items.flatMap((i) => i.warnings) : p.kind === 'transfer' ? p.warnings : [];
    return { card: { pendingId, pending: p }, content: JSON.stringify({ status: 'Shown to the user as a confirm card. Not saved until they tap Save.', summary: describePending(p), warnings }) };
  };

  switch (tu.name) {
    case 'get_balances': {
      const t = totals(l);
      return { content: JSON.stringify({
        pockets: pocketBalances(l).map((b) => ({ name: b.pocket.name, balance: fm(b.balanceCents, b.pocket.currency), spendable_now: b.pocket.spendable })),
        available_to_spend: fm(t.availableHomeCents), total_including_not_spendable: fm(t.totalHomeCents), rate: formatRate(l.lrdPerUsd),
      }) };
    }
    case 'get_spending_summary': {
      const i = V.get_spending_summary.parse(tu.input);
      const s = periodSummary(l, i.start_date, i.end_date, i.category ?? undefined);
      return { content: JSON.stringify({
        from: prettyDate(s.start, true), to: prettyDate(s.end, true), money_in: fm(s.incomeHomeCents), money_out: fm(s.expenseHomeCents),
        spending_by_category: s.byCategory.map((c) => ({ category: LABELS[c.category] ?? c.category, amount: fm(c.homeCents), entries: c.count })),
        entries: s.entryCount, note: `Amounts in ${H} at your rate ${formatRate(l.lrdPerUsd)}.`,
      }) };
    }
    case 'list_transactions': {
      const i = V.list_transactions.parse(tu.input);
      const rows = await asUser(uid, (tx) => recentTransactions(tx, 200));
      const out = rows.filter((r) => (!i.start_date || r.occurredOn >= i.start_date) && (!i.end_date || r.occurredOn <= i.end_date) && (!i.category || r.category === i.category)).slice(0, i.limit);
      return { content: JSON.stringify(out.map((r) => ({ id: r.id, date: r.occurredOn, type: r.type, amount: fm(r.amountCents, r.currency), category: r.categoryLabel, description: r.description, pocket: r.pocketName }))) };
    }
    case 'get_goal_status': {
      const g = goalStatus(l);
      if (!g) return { content: JSON.stringify({ goal: null, note: 'No savings goal yet.' }) };
      const c = g.goal.currency;
      return { content: JSON.stringify({
        name: g.goal.name, target: fm(g.goal.targetCents, c), saved: fm(g.savedCents, c), still_needed: fm(g.remainingCents, c),
        target_date: prettyDate(g.goal.targetDate, true), weekly_pace_needed: fm(g.paceNeededCents, c), your_weekly_pace_last_4_weeks: fm(g.yourPaceCents, c),
        projected_finish: g.projectedFinish ? prettyDate(g.projectedFinish, true) : 'cannot estimate yet (no recent saving)', on_track: g.onTrack,
      }) };
    }
    case 'check_affordability': {
      const i = V.check_affordability.parse(tu.input);
      const cents = toCents(i.price)!;
      const a = affordability(l, cents, i.currency, i.item);
      return { affordability: a, content: JSON.stringify({
        verdict: a.verdict === 'yes' ? 'Yes' : a.verdict === 'yes_but' ? 'Yes, but' : 'Not yet', reason: a.reason,
        price: fm(a.priceHomeCents), available_to_spend: fm(a.availableHomeCents), left_after_buying: fm(a.leftAfterHomeCents),
        usual_weekly_spending: fm(a.weeklySpendHomeCents), days_of_usual_spending_left: a.daysOfSpendingLeft,
        goal: a.goal && { name: a.goal.name, delay_days: a.goal.delayDays, finish_before: a.goal.finishBefore && prettyDate(a.goal.finishBefore, true), finish_after: a.goal.finishAfter && prettyDate(a.goal.finishAfter, true), target: prettyDate(a.goal.targetDate, true), pushes_past_target: a.goal.pushesPastTarget },
        rough_estimate: a.roughEstimate, note: 'The app already shows the verdict card and Show the math. Explain kindly in one or two sentences.',
      }) };
    }
    case 'get_budget_status': {
      const b = budgetStatus(l);
      if (!b) return { content: JSON.stringify({ budget: null, note: 'No weekly limit set.' }) };
      return { content: JSON.stringify({ weekly_limit: fm(b.budget.limitCents, b.budget.currency), used_this_week: fm(b.usedCents, b.budget.currency), percent_used: b.pct, days_left_in_week: b.daysLeft, category: b.budget.category ? LABELS[b.budget.category] : 'all spending' }) };
    }
    case 'propose_transactions': {
      const i = V.propose_transactions.parse(tu.input);
      const items = [];
      for (const raw of i.items) {
        const r = validateTxnItem(l, raw);
        if (!r.ok) return err(r.error);
        items.push(r.value);
      }
      return propose({ kind: 'transactions', items });
    }
    case 'propose_transfer': { const r = buildTransfer(l, V.propose_transfer.parse(tu.input)); return r.ok ? propose(r.value) : err(r.error); }
    case 'propose_goal': { const r = buildGoal(l, V.propose_goal.parse(tu.input)); return r.ok ? propose(r.value) : err(r.error); }
    case 'propose_goal_contribution': { const r = buildContribution(l, V.propose_goal_contribution.parse(tu.input)); return r.ok ? propose(r.value) : err(r.error); }
    case 'propose_budget': { const r = buildBudget(V.propose_budget.parse(tu.input)); return r.ok ? propose(r.value) : err(r.error); }
    case 'propose_edit': {
      const i = V.propose_edit.parse(tu.input);
      const t = l.transactions.find((x) => x.id === i.transaction_id);
      if (!t) return err('Entry not found. Use list_transactions to find the id.');
      const newPocket = i.pocket_id ? l.pockets.find((p) => p.id === i.pocket_id) : null;
      if (i.pocket_id && !newPocket) return err('Unknown pocket.');
      if (newPocket && newPocket.currency !== t.currency && i.amount == null) return err(`${newPocket.name} holds ${newPocket.currency}. Ask the user for the amount in ${newPocket.currency}.`);
      if (i.date && i.date > l.today) return err('Date cannot be in the future.');
      const changes = {
        ...(i.amount != null ? { amountCents: toCents(i.amount)! } : {}), ...(i.category ? { category: i.category } : {}),
        ...(i.description ? { description: i.description } : {}), ...(i.date ? { date: i.date } : {}), ...(i.pocket_id ? { pocketId: i.pocket_id } : {}),
      };
      return propose({ kind: 'edit', transactionId: t.id, before: { amount: fm(t.amountCents, t.currency), description: t.description, category: t.category, date: t.occurredOn }, changes });
    }
    case 'propose_delete': {
      const i = V.propose_delete.parse(tu.input);
      const t = l.transactions.find((x) => x.id === i.transaction_id);
      if (!t) return err('Entry not found. Use list_transactions to find the id.');
      return propose({ kind: 'delete', transactionId: t.id, summary: `${fm(t.amountCents, t.currency)} ${t.description} on ${prettyDate(t.occurredOn)}` });
    }
    case 'ask_user': {
      const i = V.ask_user.parse(tu.input);
      return { ask: { question: i.question, options: i.options }, content: JSON.stringify({ status: 'Question shown to the user. Stop and wait for their answer.' }) };
    }
  }
}
