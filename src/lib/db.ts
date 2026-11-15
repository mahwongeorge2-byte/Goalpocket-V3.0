import 'server-only';
import postgres from 'postgres';

// One shared connection pool. DATABASE_URL is a server-only setting
// (on Supabase: Project Settings > Database > connection string).
const globalForDb = globalThis as unknown as { _gpSql?: postgres.Sql };

export const sql: postgres.Sql =
  globalForDb._gpSql ??
  postgres(process.env.DATABASE_URL ?? '', {
    max: 5,
    prepare: false, // needed for Supabase's transaction pooler
    onnotice: () => {},
  });
if (process.env.NODE_ENV !== 'production') globalForDb._gpSql = sql;

export type Tx = postgres.TransactionSql;

/**
 * Run `fn` inside a transaction as `userId`. The database itself then enforces
 * that only this user's rows can be read or written (Row Level Security).
 */
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Invalid user id');
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  })) as T;
}
