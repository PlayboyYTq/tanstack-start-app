
-- Groups table
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  description text,
  avatar_url text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- Group members
create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index idx_group_members_user on public.group_members(user_id);

-- Add group_id to messages (nullable; existing 1:1 messages keep using conversation_id)
alter table public.messages
  add column group_id uuid references public.groups(id) on delete cascade,
  alter column conversation_id drop not null,
  add constraint messages_target_check check (
    (conversation_id is not null and group_id is null) or
    (conversation_id is null and group_id is not null)
  );

create index idx_messages_group on public.messages(group_id, created_at);

-- Helper: is user member of group?
create or replace function public.is_group_member(_group uuid, _user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.group_members where group_id = _group and user_id = _user);
$$;

-- Enable RLS
alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- Groups policies
create policy "Members can view groups"
  on public.groups for select to authenticated
  using (public.is_group_member(id, auth.uid()));

create policy "Authenticated users can create groups"
  on public.groups for insert to authenticated
  with check (auth.uid() = created_by);

create policy "Owner can update group"
  on public.groups for update to authenticated
  using (exists (select 1 from public.group_members
                 where group_id = groups.id and user_id = auth.uid() and role = 'owner'));

create policy "Owner can delete group"
  on public.groups for delete to authenticated
  using (exists (select 1 from public.group_members
                 where group_id = groups.id and user_id = auth.uid() and role = 'owner'));

-- Group members policies
create policy "Members can view group members"
  on public.group_members for select to authenticated
  using (public.is_group_member(group_id, auth.uid()));

-- Allow inserts when (a) the creator inserts themselves as owner of a brand new group,
-- or (b) the requester is the owner of the group adding someone else.
create policy "Owner can add members or self-add as creator"
  on public.group_members for insert to authenticated
  with check (
    (user_id = auth.uid() and exists (
       select 1 from public.groups g where g.id = group_id and g.created_by = auth.uid()
    ))
    or exists (
       select 1 from public.group_members m
       where m.group_id = group_members.group_id and m.user_id = auth.uid() and m.role = 'owner'
    )
  );

create policy "Owner can remove members; users can leave"
  on public.group_members for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
       select 1 from public.group_members m
       where m.group_id = group_members.group_id and m.user_id = auth.uid() and m.role = 'owner'
    )
  );

-- Update messages RLS to include group messages
drop policy if exists "Participants can view messages" on public.messages;
drop policy if exists "Participants can send messages" on public.messages;
drop policy if exists "Recipients can update message status" on public.messages;

create policy "Participants can view messages"
  on public.messages for select to authenticated
  using (
    (conversation_id is not null and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and (auth.uid() = c.user_a or auth.uid() = c.user_b)
    ))
    or
    (group_id is not null and public.is_group_member(group_id, auth.uid()))
  );

create policy "Participants can send messages"
  on public.messages for insert to authenticated
  with check (
    auth.uid() = sender_id and (
      (conversation_id is not null and exists (
         select 1 from public.conversations c
         where c.id = messages.conversation_id
           and (auth.uid() = c.user_a or auth.uid() = c.user_b)
           and not public.is_blocked(c.user_a, c.user_b)
      ))
      or
      (group_id is not null and public.is_group_member(group_id, auth.uid()))
    )
  );

create policy "Recipients can update message status"
  on public.messages for update to authenticated
  using (
    (conversation_id is not null and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and (auth.uid() = c.user_a or auth.uid() = c.user_b)
    ))
    or
    (group_id is not null and public.is_group_member(group_id, auth.uid()))
  );

-- Trigger: auto-add creator as owner-member
create or replace function public.handle_new_group()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end; $$;

create trigger on_group_created
  after insert on public.groups
  for each row execute function public.handle_new_group();

-- Update bump_conversation_timestamp to also bump groups
create or replace function public.bump_conversation_timestamp()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.conversation_id is not null then
    update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  elsif new.group_id is not null then
    update public.groups set last_message_at = new.created_at where id = new.group_id;
  end if;
  return new;
end; $$;

-- Realtime
alter publication supabase_realtime add table public.groups;
alter publication supabase_realtime add table public.group_members;
alter table public.groups replica identity full;
alter table public.group_members replica identity full;
