import 'server-only';
import { NextResponse } from 'next/server';
import { getUserId } from './session';

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** Returns the signed-in user id, or null (the route should answer 401). */
export async function requireUser(): Promise<string | null> {
  return getUserId();
}

/** Same-origin check for state-changing requests (simple CSRF protection). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser clients
  try { return new URL(origin).host === req.headers.get('host'); } catch { return false; }
}

/** Turns a server crash into a short, safe message that says what to fix (never leaks secrets). */
export function serverFail(e: unknown): NextResponse {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('Goalpocket server error:', msg);
  let message = 'The server hit a problem. Please try again.';
  if (/SESSION_SECRET/.test(msg)) message = 'Server setting missing: SESSION_SECRET must be set (32 or more characters).';
  else if (/relation .* does not exist|permission denied|row-level security|role "authenticated"|role "gp_app"/i.test(msg)) message = 'The database is not set up yet. Run the two SQL files in the db folder (see SETUP.md).';
  else if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|CONNECT_TIMEOUT|password authentication|Tenant or user not found|DATABASE_URL|connection/i.test(msg)) message = 'Cannot reach the database. Check the DATABASE_URL setting (see SETUP.md).';
  return NextResponse.json({ error: message }, { status: 503 });
}

/** Wrap a route handler so any crash becomes a clear JSON error instead of a blank 500. */
export function guarded<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try { return await fn(...a); } catch (e) { return serverFail(e); }
  };
}
