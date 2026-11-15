import { z } from 'zod';
import { sql, asUser } from '@/lib/db';
import { clearSession } from '@/lib/session';
import { json, fail, requireUser, sameOrigin } from '@/lib/http';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rate'), lrdPerUsd: z.number().positive().max(10000) }),
  z.object({ action: z.literal('spendable'), pocketId: z.string().uuid(), spendable: z.boolean() }),
  z.object({ action: z.literal('signout') }),
  z.object({ action: z.literal('delete_my_data') }),
]);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail('Bad request');
  const a = b.data;
  if (a.action === 'rate') await asUser(uid, (tx) => tx`insert into exchange_rates (user_id, lrd_per_usd, note) values (${uid}, ${a.lrdPerUsd}, 'Changed in settings')`);
  if (a.action === 'spendable') await asUser(uid, (tx) => tx`update pockets set spendable = ${a.spendable} where id = ${a.pocketId}`);
  if (a.action === 'signout') await clearSession();
  if (a.action === 'delete_my_data') { await sql`delete from app_users where id = ${uid}`; await clearSession(); }
  return json({ ok: true });
}
