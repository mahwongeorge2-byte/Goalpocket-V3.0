import { z } from 'zod';
import { runChat } from '@/lib/ai/chat';
import { asUser } from '@/lib/db';
import { chatHistory } from '@/lib/repo';
import { json, fail, requireUser, sameOrigin, guarded } from '@/lib/http';

export const maxDuration = 60;

/** Recent chat text, so the conversation survives a page reload. */
export const GET = guarded(async (req: Request) => {
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const conversationId = new URL(req.url).searchParams.get('conversationId') ?? undefined;
  if (conversationId && !z.string().uuid().safeParse(conversationId).success) return fail('Invalid conversation', 400);
  const rows = await asUser(uid, (tx) => chatHistory(tx, 100, conversationId));
  return json(rows.map((r) => ({ role: r.role, text: (r.content as { text?: string })?.text ?? '' })));
});

export const POST = guarded(async (req: Request) => {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const uid = await requireUser();
  if (!uid) return fail('Not signed in', 401);
  const body = z.object({ message: z.string(), conversationId: z.string().uuid().optional() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return fail('Missing message');
  return json(await runChat(uid, body.data.message, { conversationId: body.data.conversationId }));
});
