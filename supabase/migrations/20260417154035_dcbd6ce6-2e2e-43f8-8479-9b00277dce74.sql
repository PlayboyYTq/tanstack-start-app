create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  date_of_birth date,
  avatar_url text,
  status text not null default 'offline' check (status in ('online','offline')),
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by authenticated users"
  on public.profiles for select to authenticated using (true);

create policy "Users can insert own profile"
  on public.profiles for insert to authenticated with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update to authenticated using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, date_of_birth)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    nullif(new.raw_user_meta_data->>'date_of_birth','')::date
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint conversation_users_ordered check (user_a < user_b),
  unique (user_a, user_b)
);

alter table public.conversations enable row level security;

create policy "Participants can view conversations"
  on public.conversations for select to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

create policy "Users can create conversations they're part of"
  on public.conversations for insert to authenticated
  with check (auth.uid() = user_a or auth.uid() = user_b);

create policy "Participants can update conversations"
  on public.conversations for update to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 4000),
  status text not null default 'sent' check (status in ('sent','delivered','read')),
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on public.messages(conversation_id, created_at);

alter table public.messages enable row level security;

create policy "Participants can view messages"
  on public.messages for select to authenticated using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (auth.uid() = c.user_a or auth.uid() = c.user_b)
    )
  );

create policy "Participants can send messages"
  on public.messages for insert to authenticated with check (
    auth.uid() = sender_id and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (auth.uid() = c.user_a or auth.uid() = c.user_b)
    )
  );

create policy "Recipients can update message status"
  on public.messages for update to authenticated using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (auth.uid() = c.user_a or auth.uid() = c.user_b)
    )
  );

create or replace function public.bump_conversation_timestamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end; $$;

create trigger on_message_insert
  after insert on public.messages
  for each row execute function public.bump_conversation_timestamp();

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.profiles;
alter table public.messages replica identity full;
alter table public.profiles replica identity full;
alter table public.conversations replica identity full;

insert into storage.buckets (id, name, public) values ('avatars','avatars', true)
  on conflict (id) do nothing;

create policy "Avatars are publicly readable"
  on storage.objects for select using (bucket_id = 'avatars');

create policy "Users can upload own avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);