import { z } from 'zod';
import { asUser } from '@/lib/db';
import { json, fail, requireUser, sameOrigin } from '@/lib/http';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const body = z.object({ id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return fail('Bad request');
  await asUser(uid, (tx) => tx`update pending_actions set status = 'cancelled' where id = ${body.data.id} and status = 'pending'`);
  return json({ ok: true });
}
