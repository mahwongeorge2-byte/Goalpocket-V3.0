-- Goalpocket schema. Safe to run on plain PostgreSQL 15+ or on Supabase.
-- All money is stored as whole cents (bigint). Every table carries user_id
-- and is protected by Row Level Security: a request only sees rows whose
-- user_id matches the user id the server sets for that request.

create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema if not exists gp;

-- The server sets request.jwt.claims = {"sub": "<user id>"} at the start of
-- every transaction (same setting Supabase uses), then switches to the
-- 'authenticated' role so RLS applies.
create or replace function gp.uid() returns uuid
language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('demo','guest','email')),
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  user_id uuid primary key references app_users(id) on delete cascade,
  display_name text not null default 'Friend',
  home_currency text not null default 'USD' check (home_currency in ('USD','LRD')),
  setup_done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists exchange_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  lrd_per_usd numeric(12,4) not null check (lrd_per_usd > 0),
  set_at timestamptz not null default now(),
  note text
);

create table if not exists pockets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  kind text not null check (kind in ('cash','orange_money','momo','susu','bank','other')),
  currency text not null check (currency in ('USD','LRD')),
  opening_balance_cents bigint not null default 0,
  spendable boolean not null default true,
  sort int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  key text primary key,
  label text not null,
  icon text not null
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  type text not null check (type in ('income','expense')),
  pocket_id uuid not null references pockets(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency in ('USD','LRD')),
  category text not null references categories(key),
  description text not null default '' check (length(description) <= 120),
  occurred_on date not null,
  source text not null default 'chat' check (source in ('chat','manual','seed')),
  transfer_id uuid,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  from_pocket_id uuid not null references pockets(id) on delete cascade,
  to_pocket_id uuid not null references pockets(id) on delete cascade,
  amount_out_cents bigint not null check (amount_out_cents > 0),
  amount_in_cents bigint not null check (amount_in_cents > 0),
  occurred_on date not null,
  note text not null default '',
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  check (from_pocket_id <> to_pocket_id)
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  target_cents bigint not null check (target_cents > 0),
  currency text not null check (currency in ('USD','LRD')),
  target_date date not null,
  status text not null default 'active' check (status in ('active','done','archived')),
  created_at timestamptz not null default now()
);

create table if not exists goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  goal_id uuid not null references goals(id) on delete cascade,
  pocket_id uuid not null references pockets(id) on delete cascade,
  amount_from_pocket_cents bigint not null check (amount_from_pocket_cents > 0),
  amount_to_goal_cents bigint not null check (amount_to_goal_cents > 0),
  occurred_on date not null,
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  category text references categories(key),
  limit_cents bigint not null check (limit_cents > 0),
  currency text not null check (currency in ('USD','LRD')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  keyword text not null,
  category text not null references categories(key),
  created_at timestamptz not null default now(),
  unique (user_id, keyword)
);

create table if not exists pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists rate_limits (
  user_id uuid not null references app_users(id) on delete cascade,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (user_id, window_start)
);

insert into categories (key,label,icon) values
 ('food','Food','🍲'),('transport','Transport','🛺'),('housing','Housing','🏠'),
 ('utilities','Utilities','💡'),('education','Education','📚'),('health','Health','🩺'),
 ('phone_data','Phone & Data','📱'),('entertainment','Entertainment','🎉'),
 ('shopping','Shopping','🛍️'),('business','Business','💼'),('family','Family & Support','👪'),
 ('fees','Fees','🧾'),('savings','Savings','🐷'),('income','Income','💵'),('other','Other','•')
on conflict (key) do nothing;

-- Row Level Security on every per-user table.
do $$
declare t text;
begin
  foreach t in array array['profiles','exchange_rates','pockets','transactions','transfers',
    'goals','goal_contributions','budgets','category_rules','pending_actions','chat_messages','rate_limits']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists own_rows on %I', t);
    execute format('create policy own_rows on %I for all to authenticated using (user_id = gp.uid()) with check (user_id = gp.uid())', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

alter table app_users enable row level security;
drop policy if exists own_user on app_users;
create policy own_user on app_users for select to authenticated using (id = gp.uid());
grant select on app_users to authenticated;
grant select on categories to authenticated;
grant usage on schema gp to authenticated;
grant execute on function gp.uid() to authenticated;

