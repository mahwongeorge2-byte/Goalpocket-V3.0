-- Extra locks for Supabase (safe on plain PostgreSQL too).
-- The app talks to the database only from the server, as the role gp_app.
-- Supabase's public Data API (anon / authenticated keys) must not reach these tables.

-- 1. The app's own login role. Create it once by hand with a strong password:
--      create role gp_app login password '<long random password>';
--    (kept out of this file so the password never lands in git or migration history)
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gp_app') then
    execute 'grant authenticated to gp_app';      -- lets the server switch to the RLS role per request
    execute 'grant usage on schema public, gp to gp_app';
    execute 'grant select, insert, delete on app_users to gp_app';
    execute 'grant select on categories to gp_app';
  end if;
end $$;

-- 2. The server (gp_app) creates and deletes accounts; nobody else touches app_users.
drop policy if exists server_manage on app_users;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gp_app') then
    execute 'create policy server_manage on app_users for all to gp_app using (true) with check (true)';
  end if;
end $$;

-- 3. Categories are shared read-only reference data.
alter table categories enable row level security;
drop policy if exists read_all on categories;
create policy read_all on categories for select using (true);

-- 4. Close the public Data API: no access for anon, and authenticated may only do
--    what the per-table policies allow (the app sets the user itself, server-side).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all functions in schema gp from anon';
  end if;
end $$;
revoke insert, update, delete, truncate, references, trigger on app_users, categories from authenticated;
revoke execute on function gp.uid() from public;
grant execute on function gp.uid() to authenticated;

-- 5. Fixed search path for the user-id function (Supabase advisor).
alter function gp.uid() set search_path = '';
