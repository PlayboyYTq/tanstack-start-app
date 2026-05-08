-- Atomic group creation function: creates the group, adds creator as owner,
-- and adds initial members in one SECURITY DEFINER call. Avoids the
-- chained-RLS race where the second insert (group_members) sees no owner
-- row yet and the who_can_add_members='admin' policy rejects it.
CREATE OR REPLACE FUNCTION public.create_group_with_members(
  _name text,
  _member_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _group_id uuid;
  _mid uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'group name required';
  END IF;

  INSERT INTO public.groups (name, created_by)
  VALUES (btrim(_name), _uid)
  RETURNING id INTO _group_id;

  -- handle_new_group trigger inserts the owner row, but be defensive:
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (_group_id, _uid, 'owner')
  ON CONFLICT DO NOTHING;

  IF _member_ids IS NOT NULL THEN
    FOREACH _mid IN ARRAY _member_ids LOOP
      IF _mid IS NOT NULL AND _mid <> _uid THEN
        INSERT INTO public.group_members (group_id, user_id, role)
        VALUES (_group_id, _mid, 'member')
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN _group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_group_with_members(text, uuid[]) TO authenticated;