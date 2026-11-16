import { sql, asUser } from '@/lib/db';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Setup check. Open /api/health in a browser. Shows what is working and what is missing. Never shows secrets or user data. */
export async function GET() {
  const checks: Record<string, string> = {
    DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'MISSING',
    SESSION_SECRET: (process.env.SESSION_SECRET ?? '').length >= 32 ? 'set' : 'MISSING or shorter than 32 characters',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ? 'set (OpenRouter AI configured)' : 'not set (demo chat mode, this is fine)',
  };
  try {
    const [r] = await sql`select count(*)::int as n from categories`;
    checks.database = 'connected';
    checks.tables = r.n > 0 ? 'ready' : 'empty: run db/001_schema.sql';
  } catch (e) {
    console.error('health check failed', e instanceof Error ? e.message : e);
    checks.database = 'NOT working: check DATABASE_URL, or run the SQL files in db/';
    return json({ ok: false, checks }, 503);
  }
  try {
    await asUser('00000000-0000-0000-0000-000000000000', async (tx) => { await tx`select 1 from profiles limit 1`; });
    checks.userAccess = 'ready';
  } catch (e) {
    console.error('health user-access check failed', e instanceof Error ? e.message : e);
    checks.userAccess = 'NOT working: run db/002_supabase.sql again after creating the gp_app role';
  }
  try {
    await sql`select count(*)::int as n from app_users`;
    checks.accounts = 'ready';
  } catch {
    checks.accounts = 'NOT working: run db/002_supabase.sql again after creating the gp_app role';
  }
  const ok = !Object.values(checks).some((v) => v.includes('MISSING') || v.includes('NOT working') || v.includes('empty'));
  return json({ ok, checks }, ok ? 200 : 503);
}
