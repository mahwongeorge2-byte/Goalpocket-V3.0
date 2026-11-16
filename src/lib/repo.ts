import 'server-only';
import { sql, type Tx } from './db';
import type { Ledger, Pocket, Txn, Transfer, Contribution, Goal, Budget } from './engine';
import type { Currency } from './money';
import { todayISO } from './dates';

export type Profile = { userId: string; displayName: string; homeCurrency: Currency; setupDone: boolean };

const d = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const n = (v: unknown) => Number(v);

export async function createUser(kind: 'demo' | 'guest' | 'email'): Promise<string> {
  // app_users rows are created by the server itself (outside any user's RLS scope).
  const [row] = await sql`insert into app_users (kind) values (${kind}) returning id`;
  return row.id as string;
}

export async function getProfile(tx: Tx): Promise<Profile | null> {
  const [p] = await tx`select * from profiles limit 1`;
  if (!p) return null;
  return { userId: p.user_id, displayName: p.display_name, homeCurrency: p.home_currency, setupDone: p.setup_done };
}

export async function loadLedger(tx: Tx, today = todayISO()): Promise<{ ledger: Ledger; profile: Profile }> {
  const profile = await getProfile(tx);
  if (!profile) throw new Error('No profile');
  const [rate] = await tx`select lrd_per_usd from exchange_rates order by set_at desc limit 1`;
  const pockets = await tx`select * from pockets where not archived order by sort, created_at`;
  const txns = await tx`select * from transactions where not deleted order by occurred_on, created_at`;
  const transfers = await tx`select * from transfers where not deleted`;
  const contribs = await tx`select * from goal_contributions where not deleted`;
  const [goal] = await tx`select * from goals where status = 'active' order by created_at desc limit 1`;
  const [budget] = await tx`select * from budgets where active order by created_at desc limit 1`;
  const ledger: Ledger = {
    today,
    homeCurrency: profile.homeCurrency,
    lrdPerUsd: rate ? n(rate.lrd_per_usd) : 172,
    pockets: pockets.map((p): Pocket => ({ id: p.id, name: p.name, kind: p.kind, currency: p.currency, openingBalanceCents: n(p.opening_balance_cents), spendable: p.spendable })),
    transactions: txns.map((t): Txn => ({ id: t.id, type: t.type, pocketId: t.pocket_id, amountCents: n(t.amount_cents), currency: t.currency, category: t.category, description: t.description, occurredOn: d(t.occurred_on) })),
    transfers: transfers.map((t): Transfer => ({ id: t.id, fromPocketId: t.from_pocket_id, toPocketId: t.to_pocket_id, amountOutCents: n(t.amount_out_cents), amountInCents: n(t.amount_in_cents), occurredOn: d(t.occurred_on) })),
    contributions: contribs.map((c): Contribution => ({ id: c.id, goalId: c.goal_id, pocketId: c.pocket_id, amountFromPocketCents: n(c.amount_from_pocket_cents), amountToGoalCents: n(c.amount_to_goal_cents), occurredOn: d(c.occurred_on) })),
    goal: goal ? ({ id: goal.id, name: goal.name, targetCents: n(goal.target_cents), currency: goal.currency, targetDate: d(goal.target_date) } as Goal) : null,
    budget: budget ? ({ id: budget.id, category: budget.category, limitCents: n(budget.limit_cents), currency: budget.currency } as Budget) : null,
  };
  return { ledger, profile };
}

export async function recentTransactions(tx: Tx, limit = 20) {
  const rows = await tx`
    select t.*, p.name as pocket_name, c.label as category_label, c.icon
    from transactions t join pockets p on p.id = t.pocket_id join categories c on c.key = t.category
    where not t.deleted order by t.occurred_on desc, t.created_at desc limit ${limit}`;
  return rows.map((t) => ({
    id: t.id as string, type: t.type as 'income' | 'expense', amountCents: n(t.amount_cents), currency: t.currency as Currency,
    category: t.category as string, categoryLabel: t.category_label as string, icon: t.icon as string,
    description: t.description as string, occurredOn: d(t.occurred_on), pocketId: t.pocket_id as string, pocketName: t.pocket_name as string,
  }));
}

export async function categories(tx: Tx) {
  return (await tx`select key, label, icon from categories order by label`) as unknown as { key: string; label: string; icon: string }[];
}

// ---------- Writes (always inside asUser, so RLS checks ownership) ----------

export async function insertTransaction(tx: Tx, uid: string, t: Omit<Txn, 'id'> & { source?: string }) {
  const [row] = await tx`insert into transactions (user_id, type, pocket_id, amount_cents, currency, category, description, occurred_on, source)
    values (${uid}, ${t.type}, ${t.pocketId}, ${t.amountCents}, ${t.currency}, ${t.category}, ${t.description}, ${t.occurredOn}, ${t.source ?? 'chat'}) returning id`;
  return row.id as string;
}

export async function rememberCategory(tx: Tx, uid: string, description: string, category: string) {
  const keyword = description.trim().toLowerCase().split(/\s+/)[0];
  if (!keyword || keyword.length < 3) return;
  await tx`insert into category_rules (user_id, keyword, category) values (${uid}, ${keyword}, ${category})
    on conflict (user_id, keyword) do update set category = excluded.category`;
}

export async function categoryRules(tx: Tx) {
  return (await tx`select keyword, category from category_rules order by created_at desc limit 50`) as unknown as { keyword: string; category: string }[];
}

export async function createPending(tx: Tx, uid: string, kind: string, payload: unknown) {
  const [row] = await tx`insert into pending_actions (user_id, kind, payload) values (${uid}, ${kind}, ${tx.json(payload as never)}) returning id`;
  return row.id as string;
}

export type ChatConversation = { id: string; title: string; updatedAt: string };

export async function listChatConversations(tx: Tx): Promise<ChatConversation[]> {
  const rows = await tx`select id, title, updated_at from chat_conversations order by updated_at desc, created_at desc limit 100`;
  return rows.map((r) => ({ id: r.id as string, title: r.title as string, updatedAt: new Date(r.updated_at as string | Date).toISOString() }));
}

export async function createChatConversation(tx: Tx, uid: string): Promise<string> {
  const [row] = await tx`insert into chat_conversations (user_id, title) values (${uid}, 'New chat') returning id`;
  return row.id as string;
}

export async function deleteChatConversation(tx: Tx, conversationId: string): Promise<boolean> {
  const rows = await tx`delete from chat_conversations where id = ${conversationId} returning id`;
  return rows.length > 0;
}

/** RLS ensures the requested conversation belongs to the signed-in user. */
async function latestChatConversation(tx: Tx, uid?: string, requestedId?: string): Promise<string> {
  if (requestedId) {
    const [requested] = await tx`select id from chat_conversations where id = ${requestedId} limit 1`;
    if (requested) return requested.id as string;
    throw new Error('Conversation not found');
  }
  const [existing] = await tx`select id from chat_conversations order by updated_at desc, created_at desc limit 1`;
  if (existing) return existing.id as string;
  if (!uid) return '';
  return createChatConversation(tx, uid);
}

export async function addChat(tx: Tx, uid: string, role: 'user' | 'assistant', content: unknown, requestedId?: string) {
  const conversationId = await latestChatConversation(tx, uid, requestedId);
  await tx`insert into chat_messages (user_id, conversation_id, role, content)
    values (${uid}, ${conversationId}, ${role}, ${tx.json(content as never)})`;
  if (role === 'user') {
    const title = String((content as { text?: unknown })?.text ?? 'New chat').trim().slice(0, 80) || 'New chat';
    await tx`update chat_conversations set title = case when title = 'New chat' then ${title} else title end, updated_at = now() where id = ${conversationId}`;
  } else {
    await tx`update chat_conversations set updated_at = now() where id = ${conversationId}`;
  }
  return conversationId;
}

export async function chatHistory(tx: Tx, limit = 30, requestedId?: string) {
  const conversationId = await latestChatConversation(tx, undefined, requestedId);
  if (!conversationId) return [];
  const rows = await tx`select role, content, created_at from chat_messages
    where conversation_id = ${conversationId}
    order by created_at desc limit ${limit}`;
  return rows.reverse().map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }));
}

export async function deleteChatMessage(tx: Tx, messageId: string): Promise<boolean> {
  const rows = await tx`delete from chat_messages where id = ${messageId} returning id`;
  return rows.length > 0;
}

/** Replace a user turn and discard later chat-only messages so it can be resent cleanly. */
export async function replaceChatMessageForResend(tx: Tx, messageId: string, text: string): Promise<string | null> {
  const [message] = await tx`select id, conversation_id, created_at, role from chat_messages where id = ${messageId} limit 1`;
  if (!message || message.role !== 'user') return null;
  const conversationId = message.conversation_id as string;
  await tx`delete from chat_messages where conversation_id = ${conversationId} and created_at >= ${message.created_at}`;
  await tx`update chat_conversations set updated_at = now() where id = ${conversationId}`;
  return conversationId;
}

/** Simple per-user limit: at most `max` chat messages per minute. */
export async function hitRateLimit(tx: Tx, uid: string, max = 12): Promise<boolean> {
  const [row] = await tx`insert into rate_limits (user_id, window_start, count)
    values (${uid}, date_trunc('minute', now()), 1)
    on conflict (user_id, window_start) do update set count = rate_limits.count + 1 returning count`;
  return n(row.count) > max;
}
