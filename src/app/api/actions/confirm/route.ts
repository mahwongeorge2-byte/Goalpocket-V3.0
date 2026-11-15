import { z } from 'zod';
import { asUser } from '@/lib/db';
import { loadLedger, rememberCategory, addChat } from '@/lib/repo';
import { applyPending, validateTxnItem, type Pending, type TxnItem } from '@/lib/actions';
import { pocketBalances } from '@/lib/engine';
import { formatMoney } from '@/lib/money';
import { CATEGORY_KEYS } from '@/lib/ai/tools';
import { json, fail, requireUser, sameOrigin } from '@/lib/http';

const Body = z.object({
  id: z.string().uuid(),
  // Optional edits the user made on the confirm card (transactions only).
  items: z.array(z.object({
    type: z.enum(['income', 'expense']), amount: z.number().positive(), currency: z.enum(['USD', 'LRD']),
    pocket_id: z.string().uuid(), category: z.enum(CATEGORY_KEYS), description: z.string().max(120), date: z.string(),
  })).max(10).optional(),
});

/** The only way a proposal becomes a real record: the user's tap. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return fail('Bad request');

  try {
    const result = await asUser(uid, async (tx) => {
      // Lock the row so a double tap can't save twice.
      const [row] = await tx`select * from pending_actions where id = ${body.data.id} for update`;
      if (!row) throw new Error('This card is no longer available.');
      if (row.status !== 'pending') throw new Error('This card was already handled.');
      if (new Date(row.expires_at) < new Date()) throw new Error('This card expired. Please send the message again.');
      const { ledger } = await loadLedger(tx);
      let p = row.payload as Pending;

      if (p.kind === 'transactions' && body.data.items) {
        const items: TxnItem[] = [];
        for (const raw of body.data.items) {
          const r = validateTxnItem(ledger, raw);
          if (!r.ok) throw new Error(r.error);
          items.push(r.value);
        }
        // Learn from category corrections.
        for (let i = 0; i < items.length; i++) {
          if (p.items[i] && items[i].category !== p.items[i].category) await rememberCategory(tx, uid, items[i].description, items[i].category);
        }
        p = { kind: 'transactions', items };
      }
      const message = await applyPending(tx, uid, ledger, p);
      await tx`update pending_actions set status = 'confirmed' where id = ${row.id}`;

      // Code-written confirmation with fresh balances of the pockets involved.
      const { ledger: after } = await loadLedger(tx);
      const touched = new Set<string>(
        p.kind === 'transactions' ? p.items.map((i) => i.pocketId)
          : p.kind === 'transfer' ? [p.fromPocketId, p.toPocketId]
          : p.kind === 'goal_contribution' ? [p.pocketId] : []);
      const lines = pocketBalances(after).filter((b) => touched.has(b.pocket.id)).map((b) => `${b.pocket.name}: ${formatMoney(b.balanceCents, b.pocket.currency)} left.`);
      const text = [message, ...lines].join(' ');
      await addChat(tx, uid, 'assistant', { text });
      return text;
    });
    return json({ ok: true, message: result });
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not save.', 409);
  }
}
