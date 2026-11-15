import { appState } from '@/lib/state';
import { json, fail, requireUser } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  try {
    return json(await appState(uid));
  } catch {
    return fail('Not set up', 404);
  }
}
