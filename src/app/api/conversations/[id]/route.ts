import { asUser } from '@/lib/db';
import { deleteChatConversation } from '@/lib/repo';
import { json, fail, requireUser, sameOrigin, guarded } from '@/lib/http';

export const DELETE = guarded(async (req: Request, context: { params: Promise<{ id: string }> }) => {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('Invalid conversation id');
  const deleted = await asUser(uid, (tx) => deleteChatConversation(tx, id));
  if (!deleted) return fail('Conversation not found', 404);
  return json({ deleted: true });
});
