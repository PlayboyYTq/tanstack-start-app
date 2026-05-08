DROP TRIGGER IF EXISTS handle_new_group_after_insert ON public.groups;
DROP TRIGGER IF EXISTS handle_friend_request_accept_before_update ON public.friend_requests;
DROP TRIGGER IF EXISTS handle_user_block_after_insert ON public.user_blocks;
DROP TRIGGER IF EXISTS bump_conversation_timestamp_after_message ON public.messages;
DROP TRIGGER IF EXISTS validate_group_permissions_before_write ON public.groups;