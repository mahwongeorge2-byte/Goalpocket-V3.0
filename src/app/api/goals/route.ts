import { z } from 'zod';
import { asUser } from '@/lib/db';
import { loadLedger } from '@/lib/repo';
import { buildGoal, buildContribution, applyPending } from '@/lib/actions';
import { json, fail, requireUser, sameOrigin, guarded } from '@/lib/http';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goal'), name: z.string().trim().min(1).max(40), target_amount: z.number().positive(), currency: z.enum(['USD', 'LRD']), target_date: z.string() }),
  z.object({ action: z.literal('contribute'), pocket_id: z.string().uuid(), amount: z.number().positive(), date: z.string() }),
]);

export const POST = guarded(async (req: Request) => {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail('Please check the form.');
  const out: { error?: string; message?: string } = await asUser(uid, async (tx) => {
    const { ledger } = await loadLedger(tx);
    const r = b.data.action === 'goal' ? buildGoal(ledger, b.data) : buildContribution(ledger, b.data);
    if (!r.ok) return { error: r.error };
    return { message: await applyPending(tx, uid, ledger, r.value) };
  });
  if (out.error) return fail(out.error);
  return json({ ok: true, message: out.message });
});
