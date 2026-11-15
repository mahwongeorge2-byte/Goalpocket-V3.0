import { z } from 'zod';
import { asUser } from '@/lib/db';
import { createUser } from '@/lib/repo';
import { setupUser } from '@/lib/setup';
import { setSession } from '@/lib/session';
import { toCents } from '@/lib/money';
import { isISODate, todayISO } from '@/lib/dates';
import { json, fail, sameOrigin, guarded } from '@/lib/http';

const Body = z.object({
  displayName: z.string().trim().min(1).max(30),
  homeCurrency: z.enum(['USD', 'LRD']),
  lrdPerUsd: z.number().positive().max(10000),
  pockets: z.array(z.object({
    name: z.string().trim().min(1).max(40),
    kind: z.enum(['cash', 'orange_money', 'momo', 'susu', 'bank', 'other']),
    currency: z.enum(['USD', 'LRD']),
    balance: z.number().min(0).max(1e9),
    spendable: z.boolean(),
  })).min(1).max(12),
  goal: z.object({ name: z.string().trim().min(1).max(40), target: z.number().positive(), currency: z.enum(['USD', 'LRD']), targetDate: z.string() }).nullable(),
});

/** "Get started": creates a private account on this device with the user's own pockets. */
export const POST = guarded(async (req: Request) => {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Please check the form: ' + parsed.error.issues[0]?.message);
  const b = parsed.data;
  if (b.goal && (!isISODate(b.goal.targetDate) || b.goal.targetDate <= todayISO())) return fail('Goal date must be after today.');
  const uid = await createUser('guest');
  await asUser(uid, (tx) => setupUser(tx, uid, {
    displayName: b.displayName, homeCurrency: b.homeCurrency, lrdPerUsd: b.lrdPerUsd,
    pockets: b.pockets.map((p) => ({ name: p.name, kind: p.kind, currency: p.currency, balanceCents: Math.round(p.balance * 100), spendable: p.spendable })),
    goal: b.goal ? { name: b.goal.name, targetCents: toCents(b.goal.target)!, currency: b.goal.currency, targetDate: b.goal.targetDate } : null,
  }));
  await setSession(uid);
  return json({ ok: true });
});
