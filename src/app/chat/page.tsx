import { requireSetUser } from '@/lib/guard';
import ChatScreen from '@/components/ChatScreen';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireSetUser();
  return <ChatScreen />;
}
