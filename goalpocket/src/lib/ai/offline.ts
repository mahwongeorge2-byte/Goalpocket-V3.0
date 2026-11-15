import 'server-only';
// Demo mode: a free stand-in for the AI, used when there is no API key.
// It is plain pattern matching, not AI. It turns simple messages into the same
// tool calls the real model would make, so every check, card and number still
// comes from the same code. It understands far less than the real model.
import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { addDays, weekStart, monthStart } from '../dates';

type Pocket = { name: string; id: string; currency: 'USD' | 'LRD'; kind: string; spendable: boolean };
type Ctx = { today: string; pockets: Pocket[]; rules: [string, string][] };

export const DEMO_MODE_HELP =
  'Demo mode (no AI): I understand simple messages like "Spent L$500 on keke from MoMo", "Earned $20 from sales", "Can I afford a $120 phone?", "How much did I spend this week?", "What is my balance?" or "How is my goal?".';

const CATEGORY_WORDS: [RegExp, string][] = [
  [/\b(keke|taxi|bus|fare|transport|motorbike|pen ?pen|car)\b/, 'transport'],
  [/\b(scratch ?card|data|airtime|recharge|top ?up|bundle|phone credit)\b/, 'phone_data'],
  [/\b(rice|food|cookshop|lunch|breakfast|dinner|fish|greens|market|bread|eat|water bag|snack)\b/, 'food'],
  [/\b(rent|room)\b/, 'housing'],
  [/\b(current|electricity|light bill|water bill|generator|fuel)\b/, 'utilities'],
  [/\b(school|tuition|book|books|printing|photocop\w*|exam|dues|lesson)\b/, 'education'],
  [/\b(medicine|clinic|hospital|pharmacy|drug|doctor)\b/, 'health'],
  [/\b(video club|movie|football|party|game|music)\b/, 'entertainment'],
  [/\b(slippers|clothes|shoes|shirt|hair|braid\w*|lappa|bag)\b/, 'shopping'],
  [/\b(stock|goods|supplies|business)\b/, 'business'],
  [/\b(ma|pa|mother|father|mom|dad|family|sister|brother|aunty|uncle|support|church|offering)\b/, 'family'],
  [/\b(fee|fees|charge|cash ?out)\b/, 'fees'],
];
const INCOME = /\b(earn\w*|got paid|paid me|sold|sell|sales|salary|received|receive|income|profit|gave me|sent me)\b/;

function parseContext(text: string): Ctx {
  const today = text.match(/Today: (\d{4}-\d{2}-\d{2})/)?.[1] ?? new Date().toISOString().slice(0, 10);
  const pockets: Pocket[] = [];
  for (const m of text.matchAll(/^- (.+?) \| id ([0-9a-f-]{36}) \| (USD|LRD) \| kind (\w+)(.*)$/gm)) {
    pockets.push({ name: m[1], id: m[2], currency: m[3] as 'USD' | 'LRD', kind: m[4], spendable: !m[5].includes('not spendable') });
  }
  const learned = text.match(/Category corrections the user made before: (.*)/)?.[1] ?? '';
  const rules = [...learned.matchAll(/"([^"]+)" -> (\w+)/g)].map((m) => [m[1].toLowerCase(), m[2]] as [string, string]);
  return { today, pockets, rules };
}

type Amount = { value: number; currency: 'USD' | 'LRD' | null; raw: string };
function findAmount(s: string): Amount | null {
  const m = s.match(/(l\$|lrd|ld|usd|us\$|\$)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k\b)?\s?(l\$|lrd|ld|liberian dollars?|liberian|usd|us dollars?|dollars?)?/i);
  if (!m) return null;
  let value = Number(m[2].replace(/,/g, ''));
  if (m[3]) value *= 1000;
  if (!(value > 0)) return null;
  const tag = `${m[1] ?? ''} ${m[4] ?? ''}`.toLowerCase();
  const currency = /l\$|lrd|\bld\b|liberian/.test(tag) ? 'LRD' : /\$|usd|dollar/.test(tag) ? 'USD' : null;
  return { value, currency, raw: m[0] };
}

function pickPocket(part: string, whole: string, cur: 'USD' | 'LRD' | null, c: Ctx): Pocket | undefined {
  const t = ` ${part} ${whole} `;
  const byKind = (k: string) => c.pockets.find((p) => p.kind === k);
  const named = c.pockets.find((p) => t.includes(p.name.toLowerCase()));
  if (named) return named;
  if (/\b(momo|mtn|lonestar)\b/.test(t) && byKind('momo')) return byKind('momo');
  if (/\b(orange|om)\b/.test(t) && byKind('orange_money')) return byKind('orange_money');
  if (/\bsusu\b/.test(t) && byKind('susu')) return byKind('susu');
  if (/\bbank\b/.test(t) && byKind('bank')) return byKind('bank');
  const spend = c.pockets.filter((p) => p.spendable);
  return spend.find((p) => p.kind === 'cash' && (!cur || p.currency === cur))
    ?? spend.find((p) => !cur || p.currency === cur) ?? spend[0] ?? c.pockets[0];
}

function category(part: string, income: boolean, c: Ctx): string {
  if (income) return 'income';
  for (const [kw, cat] of c.rules) if (part.includes(kw)) return cat;
  for (const [re, cat] of CATEGORY_WORDS) if (re.test(part)) return cat;
  return 'other';
}

function description(part: string, amountRaw: string): string {
  const s = part.replace(amountRaw, ' ')
    .replace(/\b(i |just |today|yesterday|spent|spend|paid|pay|bought|buy|earned|earn|got|received|from|with|using|via|in|on|for|my|the|a|an)\b/g, ' ')
    .replace(/\b(momo|mtn|orange money|orange|cash|usd|lrd|ld|dollars?|liberian)\b/g, ' ')
    .replace(/[^a-z0-9 &'-]/g, ' ').replace(/\s+/g, ' ').trim();
  return (s || 'entry').slice(0, 40).replace(/^\w/, (x) => x.toUpperCase());
}

type Call = { name: string; input: Record<string, unknown> };

function planFor(msg: string, c: Ctx): Call | { text: string } {
  const m = msg.toLowerCase();
  if (/\bafford\b/.test(m)) {
    const a = findAmount(m);
    if (!a) return { text: 'How much does it cost? For example: Can I afford a $120 phone?' };
    const item = m.replace(a.raw, ' ').replace(/can i|could i|afford|\?|\b(a|an|the|to buy|buy|for|is it ok)\b/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'it';
    return { name: 'check_affordability', input: { item, price: a.value, currency: a.currency ?? 'USD' } };
  }
  if (/\b(balance|how much (money )?(do i have|is left|i have)|what do i have|my pockets)\b/.test(m)) return { name: 'get_balances', input: {} };
  if (/\b(goal|on track|saving for)\b/.test(m) && !findAmount(m)) return { name: 'get_goal_status', input: {} };
  if (/\b(how much|what did i|summary|spending)\b/.test(m) && !/^\s*(spent|paid|bought)/.test(m)) {
    const month = /\bmonth\b/.test(m);
    return { name: 'get_spending_summary', input: { start_date: month ? monthStart(c.today) : weekStart(c.today), end_date: c.today, category: null } };
  }
  const date = /\byesterday\b/.test(m) ? addDays(c.today, -1) : c.today;
  const parts = m.split(/\s*(?:,|;|\band\b|\balso\b)\s*/).filter((p) => findAmount(p));
  if (!parts.length) return { text: DEMO_MODE_HELP };
  let lastIncome = INCOME.test(parts[0]);
  const items = parts.slice(0, 10).map((part) => {
    const a = findAmount(part)!;
    const income = INCOME.test(part) || (lastIncome && !/\b(spent|paid|bought)\b/.test(part));
    lastIncome = income;
    const pocket = pickPocket(part, m, a.currency, c)!;
    return {
      type: income ? 'income' : 'expense', amount: a.value, currency: pocket.currency, pocket_id: pocket.id,
      category: category(part, income, c), description: description(part, a.raw), date,
    };
  });
  return { name: 'propose_transactions', input: { items } };
}

function reply(content: (BetaMessage['content'][number])[], stop: 'end_turn' | 'tool_use'): BetaMessage {
  return { id: `demo_${Date.now()}`, type: 'message', role: 'assistant', model: 'demo-mode', content, stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 } } as unknown as BetaMessage;
}
const textOf = (m: BetaMessageParam) => (typeof m.content === 'string' ? m.content : '');

/** Final sentence after a tool ran. Numbers are copied from the tool result, never computed. */
function wrapUp(tool: string, result: string): string {
  let r: Record<string, unknown> = {};
  try { r = JSON.parse(result); } catch { /* keep empty */ }
  if (r.error) return `Sorry, I could not do that: ${String(r.error)} You can fix it with the + button on the Money tab.`;
  switch (tool) {
    case 'propose_transactions': return 'Here is what I understood. Check the card, tap Edit if anything is wrong, then Save.';
    case 'check_affordability': return 'Here is my answer. Tap Show the math to see every number.';
    case 'get_balances': return `You have ${r.available_to_spend} available to spend, and ${r.total_including_not_spendable} in total with locked pockets. Your rate: ${r.rate}.`;
    case 'get_spending_summary': {
      const top = (r.spending_by_category as { category: string; amount: string }[] | undefined)?.[0];
      return `From ${r.from} to ${r.to} you spent ${r.money_out} and earned ${r.money_in}.${top ? ` Biggest: ${top.category}, ${top.amount}.` : ''}`;
    }
    case 'get_goal_status':
      return r.goal === null ? 'You have no goal yet. Add one in the full version, or with the AI connected.'
        : `${r.name}: ${r.saved} saved of ${r.target}. You need ${r.weekly_pace_needed} a week. Your pace is ${r.your_weekly_pace_last_4_weeks} a week. Expected finish: ${r.projected_finish}.`;
    default: return 'Done. Check the Money tab for the details.';
  }
}

/** Same shape as the real model call, so runChat uses it without any changes. */
export async function offlineCreate(params: { messages: BetaMessageParam[] }): Promise<BetaMessage> {
  const msgs = params.messages;
  const last = msgs[msgs.length - 1];
  if (Array.isArray(last.content)) {
    // A tool just ran: find which one and write a short reply from its result.
    const prev = msgs[msgs.length - 2];
    const tu = Array.isArray(prev?.content) ? prev.content.find((b) => b.type === 'tool_use') as { name: string } | undefined : undefined;
    const tr = last.content.find((b) => b.type === 'tool_result') as { content?: unknown } | undefined;
    const result = typeof tr?.content === 'string' ? tr.content : '';
    return reply([{ type: 'text', text: wrapUp(tu?.name ?? '', result), citations: null }] as never, 'end_turn');
  }
  if (msgs.length > 1) {
    // The server asked for a rewrite (number check). Fall back to the help text, which has no numbers.
    return reply([{ type: 'text', text: 'Please check the Money tab for the exact numbers.', citations: null }] as never, 'end_turn');
  }
  const turn = textOf(msgs[0]);
  const user = turn.match(/<user_message>\n([\s\S]*?)\n<\/user_message>/)?.[1] ?? '';
  const plan = planFor(user, parseContext(turn));
  if ('text' in plan) return reply([{ type: 'text', text: plan.text, citations: null }] as never, 'end_turn');
  return reply([{ type: 'tool_use', id: `demo_tool_${Date.now()}`, name: plan.name, input: plan.input }] as never, 'tool_use');
}
