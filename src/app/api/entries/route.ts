import { z } from 'zod';
import { asUser } from '@/lib/db';
import { loadLedger, insertTransaction } from '@/lib/repo';
import { validateTxnItem } from '@/lib/actions';
import { CATEGORY_KEYS } from '@/lib/ai/tools';
import { json, fail, requireUser, sameOrigin } from '@/lib/http';

const Body = z.object({
  type: z.enum(['income', 'expense']), amount: z.number().positive(), pocket_id: z.string().uuid(),
  category: z.enum(CATEGORY_KEYS), description: z.string().max(120), date: z.string(),
});

/** Manual entry (the + button). Works even when the AI is not connected. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail('Please check the form.');
  try {
    await asUser(uid, async (tx) => {
      const { ledger } = await loadLedger(tx);
      const pocket = ledger.pockets.find((p) => p.id === b.data.pocket_id);
      if (!pocket) throw new Error('Unknown pocket.');
      const r = validateTxnItem(ledger, { ...b.data, currency: pocket.currency });
      if (!r.ok) throw new Error(r.error);
      const i = r.value;
      await insertTransaction(tx, uid, { type: i.type, pocketId: i.pocketId, amountCents: i.amountCents, currency: i.currency, category: i.category, description: i.description, occurredOn: i.date, source: 'manual' });
    });
    return json({ ok: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not save.');
  }
}

/** Remove an entry (soft delete). The user taps the entry and confirms. */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!z.string().uuid().safeParse(id).success) return fail('Bad id');
  const rows = await asUser(uid, (tx) => tx`update transactions set deleted = true, updated_at = now() where id = ${id} and not deleted returning id`);
  if (!rows.length) return fail('Entry not found or already removed.', 404);
  return json({ ok: true });
}
