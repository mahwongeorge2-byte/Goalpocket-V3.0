// Tool definitions the AI may call, plus server-side validators.
// Read tools return facts calculated by the engine. Propose tools only create a
// pending action; nothing is saved until the user taps Save.
import { z } from 'zod';
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages';

export const CATEGORY_KEYS = ['food', 'transport', 'housing', 'utilities', 'education', 'health', 'phone_data',
  'entertainment', 'shopping', 'business', 'family', 'fees', 'savings', 'income', 'other'] as const;

const cur = { type: 'string', enum: ['USD', 'LRD'] } as const;
const date = { type: 'string', description: 'YYYY-MM-DD' } as const;
const nullable = (t: string, description?: string) => ({ type: [t, 'null'], ...(description ? { description } : {}) });

function tool(name: string, description: string, properties: Record<string, unknown>): BetaTool {
  return {
    name, description, strict: true,
    input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } as BetaTool['input_schema'],
  };
}

export const TOOLS: BetaTool[] = [
  tool('get_balances', 'Current balance of every pocket and the totals, calculated from recorded entries.', {}),
  tool('get_spending_summary', 'Money in and out between two dates (inclusive), with spending by category. Optionally one category only.', {
    start_date: date, end_date: date, category: { type: ['string', 'null'], enum: [...CATEGORY_KEYS, null] },
  }),
  tool('list_transactions', 'Recorded entries, newest first, optionally filtered.', {
    start_date: nullable('string', 'YYYY-MM-DD or null'), end_date: nullable('string', 'YYYY-MM-DD or null'),
    category: { type: ['string', 'null'], enum: [...CATEGORY_KEYS, null] }, limit: { type: 'integer', description: '1 to 20' },
  }),
  tool('get_goal_status', 'The savings goal: saved so far, amount left, weekly pace needed, the user pace, projected finish date.', {}),
  tool('check_affordability', 'Runs the "Can I afford it?" calculation for an item and price. Always use this for any can-I-afford / should-I-buy question.', {
    item: { type: 'string' }, price: { type: 'number' }, currency: cur,
  }),
  tool('get_budget_status', 'The weekly spending limit: amount used this week, percent, days left.', {}),
  tool('propose_transactions', 'Propose one or more income or expense entries. The user sees confirm cards and must tap Save. Use whenever the user reports money they spent or received.', {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['type', 'amount', 'currency', 'pocket_id', 'category', 'description', 'date'],
        properties: {
          type: { type: 'string', enum: ['income', 'expense'] },
          amount: { type: 'number', description: 'In whole currency units, e.g. 15 or 2.5' },
          currency: cur,
          pocket_id: { type: 'string', description: 'Id of a pocket from the context list. Its currency must match.' },
          category: { type: 'string', enum: [...CATEGORY_KEYS] },
          description: { type: 'string', description: 'Short, in the user words, e.g. "Keke"' },
          date,
        },
      },
    },
  }),
  tool('propose_transfer', 'Propose moving money between two of the user pockets (for example cashing out mobile money). Not spending. A fee, if any, is recorded as a Fees expense from the source pocket.', {
    from_pocket_id: { type: 'string' }, to_pocket_id: { type: 'string' },
    amount_out: { type: 'number', description: 'Amount leaving the source pocket, in its currency' },
    amount_in: nullable('number', 'Amount arriving, in the destination currency. Null if same currency and same amount.'),
    fee: nullable('number', 'Fee in the source pocket currency, or null'), date,
  }),
  tool('propose_goal', 'Propose creating or replacing the savings goal.', {
    name: { type: 'string' }, target_amount: { type: 'number' }, currency: cur, target_date: date,
  }),
  tool('propose_goal_contribution', 'Propose putting money from a pocket into the savings goal. Not spending.', {
    pocket_id: { type: 'string' }, amount: { type: 'number', description: 'In the pocket currency' }, date,
  }),
  tool('propose_edit', 'Propose changing a recorded entry. Use list_transactions first to find its id. Null fields stay unchanged.', {
    transaction_id: { type: 'string' }, amount: nullable('number'), category: { type: ['string', 'null'], enum: [...CATEGORY_KEYS, null] },
    description: nullable('string'), date: nullable('string'), pocket_id: nullable('string'),
  }),
  tool('propose_delete', 'Propose removing a recorded entry. Use list_transactions first to find its id.', { transaction_id: { type: 'string' } }),
  tool('propose_budget', 'Propose setting the weekly spending limit (overall when category is null).', {
    weekly_limit: { type: 'number' }, currency: cur, category: { type: ['string', 'null'], enum: [...CATEGORY_KEYS, null] },
  }),
  tool('ask_user', 'Ask the user ONE short question with 2 to 4 tap-able answers, when amount, currency or pocket is unclear. After calling this, stop and wait.', {
    question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } },
  }),
];

// ---------- Validators (server re-checks everything) ----------
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().positive().finite();
const category = z.enum(CATEGORY_KEYS);
const id = z.string().uuid();

export const V = {
  get_balances: z.object({}).strict(),
  get_spending_summary: z.object({ start_date: iso, end_date: iso, category: category.nullable() }),
  list_transactions: z.object({ start_date: iso.nullable(), end_date: iso.nullable(), category: category.nullable(), limit: z.number().int().min(1).max(20) }),
  get_goal_status: z.object({}).strict(),
  check_affordability: z.object({ item: z.string().min(1).max(60), price: money, currency: z.enum(['USD', 'LRD']) }),
  get_budget_status: z.object({}).strict(),
  propose_transactions: z.object({
    items: z.array(z.object({
      type: z.enum(['income', 'expense']), amount: money, currency: z.enum(['USD', 'LRD']), pocket_id: id,
      category, description: z.string().max(120), date: iso,
    })).min(1).max(10),
  }),
  propose_transfer: z.object({ from_pocket_id: id, to_pocket_id: id, amount_out: money, amount_in: money.nullable(), fee: z.number().min(0).finite().nullable(), date: iso }),
  propose_goal: z.object({ name: z.string().min(1).max(40), target_amount: money, currency: z.enum(['USD', 'LRD']), target_date: iso }),
  propose_goal_contribution: z.object({ pocket_id: id, amount: money, date: iso }),
  propose_edit: z.object({ transaction_id: id, amount: money.nullable(), category: category.nullable(), description: z.string().max(120).nullable(), date: iso.nullable(), pocket_id: id.nullable() }),
  propose_delete: z.object({ transaction_id: id }),
  propose_budget: z.object({ weekly_limit: money, currency: z.enum(['USD', 'LRD']), category: category.nullable() }),
  ask_user: z.object({ question: z.string().min(1).max(200), options: z.array(z.string().min(1).max(40)).min(2).max(4) }),
} as const;

export type ToolName = keyof typeof V;
export const isToolName = (n: string): n is ToolName => n in V;
