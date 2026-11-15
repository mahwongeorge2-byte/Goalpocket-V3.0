import 'server-only';
import { redirect } from 'next/navigation';
import { getUserId } from './session';
import { asUser } from './db';
import { getProfile } from './repo';

/** Pages behind sign-in: send people without a finished setup back to the welcome screen. */
export async function requireSetUser() {
  const uid = await getUserId();
  if (!uid) redirect('/');
  const profile = await asUser(uid, (tx) => getProfile(tx)).catch(() => null);
  if (!profile?.setupDone) redirect('/');
  return uid;
}
