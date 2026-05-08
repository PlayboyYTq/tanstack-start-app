-- Restore app-level triggers that were missing after remixing.

DROP TRIGGER IF EXISTS handle_new_group_after_insert ON public.groups;
CREATE TRIGGER handle_new_group_after_insert
AFTER INSERT ON public.groups
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_group();

DROP TRIGGER IF EXISTS handle_friend_request_accept_before_update ON public.friend_requests;
CREATE TRIGGER handle_friend_request_accept_before_update
BEFORE UPDATE ON public.friend_requests
FOR EACH ROW
EXECUTE FUNCTION public.handle_friend_request_accept();

DROP TRIGGER IF EXISTS handle_user_block_after_insert ON public.user_blocks;
CREATE TRIGGER handle_user_block_after_insert
AFTER INSERT ON public.user_blocks
FOR EACH ROW
EXECUTE FUNCTION public.handle_user_block();

DROP TRIGGER IF EXISTS bump_conversation_timestamp_after_message ON public.messages;
CREATE TRIGGER bump_conversation_timestamp_after_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.bump_conversation_timestamp();

DROP TRIGGER IF EXISTS validate_group_permissions_before_write ON public.groups;
CREATE TRIGGER validate_group_permissions_before_write
BEFORE INSERT OR UPDATE ON public.groups
FOR EACH ROW
EXECUTE FUNCTION public.validate_group_permissions();

-- Ensure realtime sends enough row data for updates/deletes.
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.message_deletions REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.groups REPLICA IDENTITY FULL;

-- Add supporting tables to realtime publication if not already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_deletions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_deletions;
  END IF;
END $$;