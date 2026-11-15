import { redirect } from 'next/navigation';
import { getUserId } from '@/lib/session';
import { asUser } from '@/lib/db';
import { getProfile } from '@/lib/repo';
import Welcome from '@/components/Welcome';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const uid = await getUserId();
  if (uid) {
    const profile = await asUser(uid, (tx) => getProfile(tx)).catch(() => null);
    if (profile?.setupDone) redirect('/chat');
  }
  return <Welcome />;
}
