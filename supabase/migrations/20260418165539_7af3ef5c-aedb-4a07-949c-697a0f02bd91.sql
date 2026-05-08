-- Extend messages table
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_for_everyone boolean NOT NULL DEFAULT false;

-- Allow senders to update/delete their own messages
DROP POLICY IF EXISTS "Senders can update their own messages" ON public.messages;
CREATE POLICY "Senders can update their own messages"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Senders can delete their own messages" ON public.messages;
CREATE POLICY "Senders can delete their own messages"
  ON public.messages FOR DELETE
  TO authenticated
  USING (auth.uid() = sender_id);

-- Message reactions
CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view reactions"
  ON public.message_reactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_reactions.message_id
        AND (
          (m.conversation_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = m.conversation_id AND (auth.uid() = c.user_a OR auth.uid() = c.user_b)
          ))
          OR (m.group_id IS NOT NULL AND public.is_group_member(m.group_id, auth.uid()))
        )
    )
  );

CREATE POLICY "Users can add their own reactions"
  ON public.message_reactions FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_reactions.message_id
        AND (
          (m.conversation_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = m.conversation_id AND (auth.uid() = c.user_a OR auth.uid() = c.user_b)
          ))
          OR (m.group_id IS NOT NULL AND public.is_group_member(m.group_id, auth.uid()))
        )
    )
  );

CREATE POLICY "Users can remove their own reactions"
  ON public.message_reactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Per-user "delete for me"
CREATE TABLE IF NOT EXISTS public.message_deletions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE public.message_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own deletions - select"
  ON public.message_deletions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users manage their own deletions - insert"
  ON public.message_deletions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage their own deletions - delete"
  ON public.message_deletions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Realtime
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.message_deletions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON public.message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON public.messages(reply_to_message_id);