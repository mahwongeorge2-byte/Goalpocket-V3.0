import { asUser } from '@/lib/db';
import { createChatConversation, listChatConversations } from '@/lib/repo';
import { json, fail, requireUser, sameOrigin, guarded } from '@/lib/http';

export const GET = guarded(async () => {
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const conversations = await asUser(uid, (tx) => listChatConversations(tx));
  return json(conversations);
});

export const POST = guarded(async (req: Request) => {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const id = await asUser(uid, (tx) => createChatConversation(tx, uid));
  return json({ id }, 201);
});
