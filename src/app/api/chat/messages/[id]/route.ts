import { z } from 'zod';
import { asUser } from '@/lib/db';
import { deleteChatMessage, replaceChatMessageForResend } from '@/lib/repo';
import { json, fail, requireUser, sameOrigin, guarded } from '@/lib/http';

export const DELETE = guarded(async (req: Request, context: { params: Promise<{ id: string }> }) => {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('Invalid message id');
  const deleted = await asUser(uid, (tx) => deleteChatMessage(tx, id));
  if (!deleted) return fail('Message not found', 404);
  return json({ deleted: true });
});

export const PATCH = guarded(async (req: Request, context: { params: Promise<{ id: string }> }) => {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('Invalid message id');
  const body = z.object({ text: z.string().trim().min(1).max(500) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return fail('Message must be between 1 and 500 characters');
  const conversationId = await asUser(uid, (tx) => replaceChatMessageForResend(tx, id, body.data.text));
  if (!conversationId) return fail('Only your own user messages can be edited', 404);
  return json({ conversationId, text: body.data.text });
});
