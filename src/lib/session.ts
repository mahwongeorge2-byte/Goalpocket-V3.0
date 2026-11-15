import 'server-only';
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed, http-only session cookie holding the user id.
// The browser cannot read or forge it.
const COOKIE = 'gp_session';

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters).');
  return s;
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

export async function setSession(userId: string) {
  const jar = await cookies();
  jar.set(COOKIE, `${userId}.${sign(userId)}`, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/', maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function getUserId(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const id = raw.slice(0, i);
  const sig = Buffer.from(raw.slice(i + 1));
  const expected = Buffer.from(sign(id));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  return id;
}
