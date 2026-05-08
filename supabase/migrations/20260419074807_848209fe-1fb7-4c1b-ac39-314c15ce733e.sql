-- Group permission settings
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS who_can_send text NOT NULL DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS who_can_edit_info text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS who_can_add_members text NOT NULL DEFAULT 'admin';

-- Validation for permission values
CREATE OR REPLACE FUNCTION public.validate_group_permissions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.who_can_send NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'invalid who_can_send';
  END IF;
  IF NEW.who_can_edit_info NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'invalid who_can_edit_info';
  END IF;
  IF NEW.who_can_add_members NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'invalid who_can_add_members';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_group_permissions ON public.groups;
CREATE TRIGGER trg_validate_group_permissions
  BEFORE INSERT OR UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.validate_group_permissions();

-- Helper: get role of user in group
CREATE OR REPLACE FUNCTION public.group_role(_group uuid, _user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.group_members WHERE group_id = _group AND user_id = _user LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_group_admin_or_owner(_group uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = _group AND user_id = _user AND role IN ('owner','admin')
  );
$$;

-- Allow admins (not just owner) to update group info per setting
DROP POLICY IF EXISTS "Owner can update group" ON public.groups;
CREATE POLICY "Allowed roles can update group"
ON public.groups
FOR UPDATE
TO authenticated
USING (
  CASE who_can_edit_info
    WHEN 'owner'  THEN public.group_role(id, auth.uid()) = 'owner'
    WHEN 'admin'  THEN public.group_role(id, auth.uid()) IN ('owner','admin')
    WHEN 'member' THEN public.is_group_member(id, auth.uid())
  END
);

-- Allow admins to add members (in addition to owner)
DROP POLICY IF EXISTS "Owner can add members or self-add as creator" ON public.group_members;
CREATE POLICY "Allowed roles can add members"
ON public.group_members
FOR INSERT
TO authenticated
WITH CHECK (
  -- creator self-adding as owner on group creation
  (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_members.group_id AND g.created_by = auth.uid())
  )
  OR
  -- based on group setting
  (
    SELECT
      CASE g.who_can_add_members
        WHEN 'owner'  THEN public.group_role(g.id, auth.uid()) = 'owner'
        WHEN 'admin'  THEN public.group_role(g.id, auth.uid()) IN ('owner','admin')
        WHEN 'member' THEN public.is_group_member(g.id, auth.uid())
      END
    FROM public.groups g WHERE g.id = group_members.group_id
  )
);

-- Allow owner to update member roles (promote/demote)
DROP POLICY IF EXISTS "Owner can update member roles" ON public.group_members;
CREATE POLICY "Owner can update member roles"
ON public.group_members
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.group_members m
    WHERE m.group_id = group_members.group_id
      AND m.user_id = auth.uid()
      AND m.role = 'owner'
  )
);

-- Allow admins to remove non-owner members; users can still leave
DROP POLICY IF EXISTS "Owner can remove members; users can leave" ON public.group_members;
CREATE POLICY "Admins can remove members; users can leave"
ON public.group_members
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    public.is_group_admin_or_owner(group_id, auth.uid())
    AND role <> 'owner'
  )
);

-- Restrict sending messages in groups based on who_can_send
DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
CREATE POLICY "Participants can send messages"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND (
    (
      conversation_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = messages.conversation_id
          AND (auth.uid() = c.user_a OR auth.uid() = c.user_b)
          AND NOT public.is_blocked(c.user_a, c.user_b)
      )
    )
    OR
    (
      group_id IS NOT NULL
      AND public.is_group_member(group_id, auth.uid())
      AND (
        SELECT
          CASE g.who_can_send
            WHEN 'owner'  THEN public.group_role(g.id, auth.uid()) = 'owner'
            WHEN 'admin'  THEN public.group_role(g.id, auth.uid()) IN ('owner','admin')
            WHEN 'member' THEN true
          END
        FROM public.groups g WHERE g.id = messages.group_id
      )
    )
  )
);

-- Storage bucket for chat attachments (25MB enforced client-side; bucket is public so URLs render)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone authenticated can read public attachments
DROP POLICY IF EXISTS "Chat attachments are publicly readable" ON storage.objects;
CREATE POLICY "Chat attachments are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-attachments');

DROP POLICY IF EXISTS "Users can upload chat attachments to own folder" ON storage.objects;
CREATE POLICY "Users can upload chat attachments to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users can delete their own chat attachments" ON storage.objects;
CREATE POLICY "Users can delete their own chat attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);