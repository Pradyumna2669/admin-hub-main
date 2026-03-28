-- Group chat tables (for #general and future rooms)
-- Avoids FK constraints on receiver_id (direct messages stay in public.messages)

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  room text not null default 'general',
  sender_id uuid references public.profiles(user_id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists group_messages_room_created_at_idx
  on public.group_messages (room, created_at);

alter publication supabase_realtime add table public.group_messages;

alter table public.group_messages enable row level security;

drop policy if exists "Authenticated users can view group messages" on public.group_messages;
create policy "Authenticated users can view group messages" on public.group_messages
  for select using (auth.uid() is not null);

drop policy if exists "Users can insert their group messages" on public.group_messages;
create policy "Users can insert their group messages" on public.group_messages
  for insert with check (auth.uid() = sender_id);

-- Read markers per room (unread + mention counts)
create table if not exists public.group_chat_reads (
  reader_id uuid references auth.users(id) on delete cascade not null,
  room text not null,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (reader_id, room)
);

alter table public.group_chat_reads enable row level security;

drop policy if exists "Users can manage their group_chat_reads" on public.group_chat_reads;
create policy "Users can manage their group_chat_reads" on public.group_chat_reads
  for all
  using (auth.uid() = reader_id)
  with check (auth.uid() = reader_id);

drop policy if exists "Admins and owners can view all group_chat_reads" on public.group_chat_reads;
create policy "Admins and owners can view all group_chat_reads" on public.group_chat_reads
  for select
  using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'owner')
  );
