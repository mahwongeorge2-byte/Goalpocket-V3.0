import { requireSetUser } from '@/lib/guard';
import GoalScreen from '@/components/GoalScreen';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireSetUser();
  return <GoalScreen />;
}
