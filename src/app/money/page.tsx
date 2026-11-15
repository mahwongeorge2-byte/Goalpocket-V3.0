import { requireSetUser } from '@/lib/guard';
import MoneyScreen from '@/components/MoneyScreen';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireSetUser();
  return <MoneyScreen />;
}
