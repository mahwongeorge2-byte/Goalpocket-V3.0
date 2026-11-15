import { z } from 'zod';
import { asUser } from '@/lib/db';
import { loadLedger } from '@/lib/repo';
import { affordability } from '@/lib/engine';
import { toCents } from '@/lib/money';
import { json, fail, requireUser, sameOrigin } from '@/lib/http';

/** "Can I afford it?" without the AI: same engine, same math. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const b = z.object({ item: z.string().trim().min(1).max(60), price: z.number().positive(), currency: z.enum(['USD', 'LRD']) })
    .safeParse(await req.json().catch(() => null));
  if (!b.success) return fail('Please enter an item and a price.');
  const a = await asUser(uid, async (tx) => affordability((await loadLedger(tx)).ledger, toCents(b.data.price)!, b.data.currency, b.data.item));
  return json(a);
}
