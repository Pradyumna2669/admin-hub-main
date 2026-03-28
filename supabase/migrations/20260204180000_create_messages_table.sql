-- Migration for messages table for chat feature
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references profiles(user_id) on delete cascade,
  receiver_id uuid references profiles(user_id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- Enable Realtime on messages table
alter publication supabase_realtime add table messages;

-- RLS: Allow sender or receiver to select/insert their messages
alter table messages enable row level security;
create policy "Users can view their messages" on messages
  for select using (
    auth.uid() = sender_id or auth.uid() = receiver_id
  );
create policy "Users can insert their messages" on messages
  for insert with check (
    auth.uid() = sender_id
  );
