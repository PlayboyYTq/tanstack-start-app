-- Friend requests
create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_request_not_self check (sender_id <> receiver_id),
  unique (sender_id, receiver_id)
);

create index friend_requests_receiver_idx on public.friend_requests(receiver_id, status);
create index friend_requests_sender_idx on public.friend_requests(sender_id, status);

alter table public.friend_requests enable row level security;

create policy "Users can view their requests"
  on public.friend_requests for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "Users can send requests"
  on public.friend_requests for insert to authenticated
  with check (auth.uid() = sender_id);

create policy "Receiver can update request"
  on public.friend_requests for update to authenticated
  using (auth.uid() = receiver_id);

create policy "Either party can delete request"
  on public.friend_requests for delete to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- Friendships (canonical: user_a < user_b)
create table public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint friendship_users_ordered check (user_a < user_b)
);

alter table public.friendships enable row level security;

create policy "Users can view their friendships"
  on public.friendships for select to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

create policy "Users can remove their friendships"
  on public.friendships for delete to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

-- Helper: are two users friends?
create or replace function public.are_friends(_a uuid, _b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships
    where (user_a = least(_a,_b) and user_b = greatest(_a,_b))
  );
$$;

-- Auto-create friendship when a request is accepted
create or replace function public.handle_friend_request_accept()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and (old.status is distinct from 'accepted') then
    insert into public.friendships (user_a, user_b)
    values (least(new.sender_id, new.receiver_id), greatest(new.sender_id, new.receiver_id))
    on conflict do nothing;
    new.responded_at := now();
  elsif new.status = 'declined' and (old.status is distinct from 'declined') then
    new.responded_at := now();
  end if;
  return new;
end;
$$;

create trigger on_friend_request_status_change
  before update on public.friend_requests
  for each row execute function public.handle_friend_request_accept();

-- Realtime
alter publication supabase_realtime add table public.friend_requests;
alter publication supabase_realtime add table public.friendships;
alter table public.friend_requests replica identity full;
alter table public.friendships replica identity full;

-- Restrict conversation creation to friends only
drop policy if exists "Users can create conversations they're part of" on public.conversations;

create policy "Friends can create conversations"
  on public.conversations for insert to authenticated
  with check (
    (auth.uid() = user_a or auth.uid() = user_b)
    and public.are_friends(user_a, user_b)
  );