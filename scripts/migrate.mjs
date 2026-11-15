// Runs every db/*.sql file in order against DATABASE_URL.
import postgres from 'postgres';
import { readFileSync, readdirSync } from 'node:fs';
const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL first.'); process.exit(1); }
const sql = postgres(url, { max: 1, onnotice: () => {} });
for (const f of readdirSync('db').filter(f => f.endsWith('.sql')).sort()) {
  await sql.unsafe(readFileSync(`db/${f}`, 'utf8'));
  console.log('applied', f);
}
await sql.end();
