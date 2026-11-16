-- Add persistent, user-scoped chat conversations while preserving every existing message.
-- Existing messages for each user are grouped into one "Previous chat".

create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  title text not null default 'New chat' check (length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table chat_messages
  add column if not exists conversation_id uuid;

with existing_users as (
  select user_id, min(created_at) as first_message
  from chat_messages
  where conversation_id is null
  group by user_id
), inserted as (
  insert into chat_conversations (user_id, title, created_at, updated_at)
  select user_id, 'Previous chat', first_message, first_message
  from existing_users
  returning id, user_id
)
update chat_messages m
set conversation_id = i.id
from inserted i
where m.user_id = i.user_id
  and m.conversation_id is null;

do $ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_messages_conversation_id_fkey'
      and conrelid = 'chat_messages'::regclass
  ) then
    alter table chat_messages
      add constraint chat_messages_conversation_id_fkey
      foreign key (conversation_id) references chat_conversations(id) on delete cascade;
  end if;
end $;

alter table chat_messages
  alter column conversation_id set not null;

create index if not exists chat_messages_conversation_created_idx
  on chat_messages (conversation_id, created_at);

create index if not exists chat_conversations_user_updated_idx
  on chat_conversations (user_id, updated_at desc);

alter table chat_conversations enable row level security;
alter table chat_conversations force row level security;
drop policy if exists own_rows on chat_conversations;
create policy own_rows on chat_conversations
  for all to authenticated
  using (user_id = gp.uid())
  with check (user_id = gp.uid());
grant select, insert, update, delete on chat_conversations to authenticated;
