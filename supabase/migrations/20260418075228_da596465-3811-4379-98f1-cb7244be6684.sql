-- 1. user_blocks table
create table if not exists public.user_blocks (
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

create policy "Users can view their own blocks"
  on public.user_blocks for select to authenticated
  using (auth.uid() = blocker_id);

create policy "Users can create their own blocks"
  on public.user_blocks for insert to authenticated
  with check (auth.uid() = blocker_id);

create policy "Users can delete their own blocks"
  on public.user_blocks for delete to authenticated
  using (auth.uid() = blocker_id);

create index if not exists idx_user_blocks_blocked on public.user_blocks(blocked_id);

-- 2. is_blocked helper (two-way)
create or replace function public.is_blocked(_a uuid, _b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = _a and blocked_id = _b)
       or (blocker_id = _b and blocked_id = _a)
  );
$$;

-- 3. On block: remove friendship + pending requests
create or replace function public.handle_user_block()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.friendships
   where (user_a = least(new.blocker_id, new.blocked_id)
          and user_b = greatest(new.blocker_id, new.blocked_id));
  delete from public.friend_requests
   where (sender_id = new.blocker_id and receiver_id = new.blocked_id)
      or (sender_id = new.blocked_id and receiver_id = new.blocker_id);
  return new;
end;
$$;

drop trigger if exists on_user_block_insert on public.user_blocks;
create trigger on_user_block_insert
  after insert on public.user_blocks
  for each row execute function public.handle_user_block();

-- 4. Phone search (masked)
create or replace function public.search_user_by_phone(_phone text)
returns table(id uuid, name text, avatar_url text, masked_phone text)
language sql stable security definer set search_path = public
as $$
  select p.id,
         p.name,
         p.avatar_url,
         case
           when p.phone is null or length(p.phone) < 4 then null
           else regexp_replace(left(p.phone, greatest(length(p.phone) - 4, 0)), '[0-9]', '●', 'g')
                || right(p.phone, 4)
         end as masked_phone
  from public.profiles p
  where p.phone = _phone
    and p.id <> auth.uid()
    and not public.is_blocked(auth.uid(), p.id);
$$;

-- 5. Tighten friend_requests INSERT to respect blocks
drop policy if exists "Users can send requests" on public.friend_requests;
create policy "Users can send requests"
  on public.friend_requests for insert to authenticated
  with check (
    auth.uid() = sender_id
    and not public.is_blocked(sender_id, receiver_id)
  );

-- 6. Tighten messages INSERT to respect blocks
drop policy if exists "Participants can send messages" on public.messages;
create policy "Participants can send messages"
  on public.messages for insert to authenticated
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (auth.uid() = c.user_a or auth.uid() = c.user_b)
        and not public.is_blocked(c.user_a, c.user_b)
    )
  );