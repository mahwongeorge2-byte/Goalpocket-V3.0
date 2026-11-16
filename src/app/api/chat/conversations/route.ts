import { asUser } from '@/lib/db';
import { createChatConversation, listChatConversations } from '@/lib/repo';
import { json, fail, requireUser, sameOrigin, guarded } from '@/lib/http';

/** List the signed-in user's conversations, newest first. */
export const GET = guarded(async () => {
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const rows = await asUser(uid, (tx) => listChatConversations(tx));
  return json(rows);
});

/** Start a separate conversation without deleting any previous messages. */
export const POST = guarded(async (req: Request) => {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const conversation = await asUser(uid, (tx) => createChatConversation(tx, uid));
  return json(conversation, 201);
});
