import { sql, asUser } from '@/lib/db';
import { createUser } from '@/lib/repo';
import { seedDemo } from '@/lib/setup';
import { setSession, getUserId } from '@/lib/session';
import { todayISO } from '@/lib/dates';
import { json, fail, sameOrigin, guarded } from '@/lib/http';

/** Start (or restart) the demo: a fresh private copy of the fictional "Musu" account. */
export const POST = guarded(async (req: Request) => {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const old = await getUserId();
  if (old) await sql`delete from app_users where id = ${old} and kind = 'demo'`;
  const uid = await createUser('demo');
  await asUser(uid, (tx) => seedDemo(tx, uid, todayISO()));
  await setSession(uid);
  return json({ ok: true });
});
