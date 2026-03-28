-- Add moderator role, chat moderation, message deletion logging, and account bans.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role'
      AND e.enumlabel = 'moderator'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'moderator';
  END IF;
END$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banned_reason TEXT,
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason TEXT;

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason TEXT;

CREATE OR REPLACE FUNCTION public.is_staff_role(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text IN ('owner', 'admin', 'moderator')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_chat_admin_role(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.contains_blocked_chat_content(_content TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized TEXT := lower(coalesce(_content, ''));
  blocked_terms TEXT[] := ARRAY[
    'fuck',
    'fucking',
    'motherfucker',
    'bitch',
    'slut',
    'whore',
    'pussy',
    'dick',
    'cock',
    'penis',
    'vagina',
    'boobs',
    'tits',
    'blowjob',
    'handjob',
    'porn',
    'xxx',
    'nude',
    'nudes',
    'masturbat',
    'horny',
    'anal',
    'cum',
    'cumming',
    'nsfw'
  ];
  term TEXT;
BEGIN
  IF normalized = '' THEN
    RETURN FALSE;
  END IF;

  FOREACH term IN ARRAY blocked_terms LOOP
    IF position(term in normalized) > 0 THEN
      RETURN TRUE;
    END IF;
  END LOOP;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_chat_message_allowed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_banned BOOLEAN := FALSE;
BEGIN
  SELECT coalesce(is_banned, false)
  INTO sender_banned
  FROM public.profiles
  WHERE user_id = NEW.sender_id;

  IF sender_banned THEN
    RAISE EXCEPTION 'This account has been banned and cannot send messages.';
  END IF;

  IF public.contains_blocked_chat_content(NEW.content) THEN
    RAISE EXCEPTION 'Message blocked by moderation because it contains restricted content.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_moderation_guard ON public.messages;
CREATE TRIGGER messages_moderation_guard
  BEFORE INSERT OR UPDATE OF content
  ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_chat_message_allowed();

DROP TRIGGER IF EXISTS group_messages_moderation_guard ON public.group_messages;
CREATE TRIGGER group_messages_moderation_guard
  BEFORE INSERT OR UPDATE OF content
  ON public.group_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_chat_message_allowed();

CREATE OR REPLACE FUNCTION public.delete_direct_message(
  p_message_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  target_message public.messages%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT public.is_staff_role(actor_id) THEN
    RAISE EXCEPTION 'Not authorized to moderate direct messages.';
  END IF;

  SELECT *
  INTO target_message
  FROM public.messages
  WHERE id = p_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Direct message not found.';
  END IF;

  IF target_message.deleted_at IS NOT NULL THEN
    RETURN target_message;
  END IF;

  UPDATE public.messages
  SET
    deleted_at = now(),
    deleted_by = actor_id,
    deleted_reason = nullif(trim(coalesce(p_reason, '')), '')
  WHERE id = p_message_id
  RETURNING * INTO target_message;

  INSERT INTO public.activity_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    actor_id,
    'chat_message_deleted',
    'direct_message',
    p_message_id,
    jsonb_build_object(
      'sender_id', target_message.sender_id,
      'receiver_id', target_message.receiver_id,
      'deleted_reason', target_message.deleted_reason,
      'message_preview', left(target_message.content, 160)
    )
  );

  RETURN target_message;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_group_message(
  p_message_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.group_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  target_message public.group_messages%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT public.is_staff_role(actor_id) THEN
    RAISE EXCEPTION 'Not authorized to moderate group messages.';
  END IF;

  SELECT *
  INTO target_message
  FROM public.group_messages
  WHERE id = p_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group message not found.';
  END IF;

  IF target_message.deleted_at IS NOT NULL THEN
    RETURN target_message;
  END IF;

  UPDATE public.group_messages
  SET
    deleted_at = now(),
    deleted_by = actor_id,
    deleted_reason = nullif(trim(coalesce(p_reason, '')), '')
  WHERE id = p_message_id
  RETURNING * INTO target_message;

  INSERT INTO public.activity_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    actor_id,
    'chat_message_deleted',
    'group_message',
    p_message_id,
    jsonb_build_object(
      'room', target_message.room,
      'sender_id', target_message.sender_id,
      'deleted_reason', target_message.deleted_reason,
      'message_preview', left(target_message.content, 160)
    )
  );

  RETURN target_message;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_ban_status(
  p_target_user_id UUID,
  p_is_banned BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  target_role TEXT;
  updated_profile public.profiles%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT public.is_chat_admin_role(actor_id) THEN
    RAISE EXCEPTION 'Not authorized to update account bans.';
  END IF;

  SELECT role::text
  INTO target_role
  FROM public.user_roles
  WHERE user_id = p_target_user_id
  LIMIT 1;

  IF target_role IN ('owner', 'admin', 'moderator') THEN
    RAISE EXCEPTION 'Staff accounts cannot be banned here.';
  END IF;

  UPDATE public.profiles
  SET
    is_banned = p_is_banned,
    banned_reason = CASE WHEN p_is_banned THEN nullif(trim(coalesce(p_reason, '')), '') ELSE NULL END,
    banned_at = CASE WHEN p_is_banned THEN now() ELSE NULL END,
    banned_by = CASE WHEN p_is_banned THEN actor_id ELSE NULL END
  WHERE user_id = p_target_user_id
  RETURNING * INTO updated_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target profile not found.';
  END IF;

  INSERT INTO public.activity_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    actor_id,
    CASE WHEN p_is_banned THEN 'user_banned' ELSE 'user_unbanned' END,
    'user',
    p_target_user_id,
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'reason', nullif(trim(coalesce(p_reason, '')), '')
    )
  );

  RETURN updated_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_direct_message(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_group_message(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_ban_status(UUID, BOOLEAN, TEXT) TO authenticated;

DROP POLICY IF EXISTS "Moderators can view all roles" ON public.user_roles;
CREATE POLICY "Moderators can view all roles"
  ON public.user_roles FOR SELECT
  USING (public.get_user_role(auth.uid())::text = 'moderator');

DROP POLICY IF EXISTS "Staff can view all profiles" ON public.profiles;
CREATE POLICY "Staff can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_staff_role(auth.uid()));

DROP POLICY IF EXISTS "Staff can update all profiles" ON public.profiles;
CREATE POLICY "Staff can update all profiles"
  ON public.profiles FOR UPDATE
  USING (public.is_staff_role(auth.uid()))
  WITH CHECK (public.is_staff_role(auth.uid()));

DROP POLICY IF EXISTS "Moderators can manage links" ON public.links;
CREATE POLICY "Moderators can manage links"
  ON public.links FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  );

DROP POLICY IF EXISTS "Moderators can manage categories" ON public.categories;
CREATE POLICY "Moderators can manage categories"
  ON public.categories FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  );

DROP POLICY IF EXISTS "Moderators can manage category assignments" ON public.category_assignments;
CREATE POLICY "Moderators can manage category assignments"
  ON public.category_assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  );

DROP POLICY IF EXISTS "Moderators can manage tasks" ON public.tasks;
CREATE POLICY "Moderators can manage tasks"
  ON public.tasks FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  );

DROP POLICY IF EXISTS "Moderators can manage task_items" ON public.task_items;
CREATE POLICY "Moderators can manage task_items"
  ON public.task_items FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  );

DROP POLICY IF EXISTS "Moderators can manage task_type_rates" ON public.task_type_rates;
CREATE POLICY "Moderators can manage task_type_rates"
  ON public.task_type_rates FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  );

DROP POLICY IF EXISTS "Moderators can manage task_submissions" ON public.task_submissions;
CREATE POLICY "Moderators can manage task_submissions"
  ON public.task_submissions FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  );

DROP POLICY IF EXISTS "Moderators can manage task_assignments" ON public.task_assignments;
CREATE POLICY "Moderators can manage task_assignments"
  ON public.task_assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  );

DROP POLICY IF EXISTS "Moderators can read all messages" ON public.messages;
CREATE POLICY "Moderators can read all messages"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
    OR auth.uid() = sender_id
    OR auth.uid() = receiver_id
  );

DROP POLICY IF EXISTS "Moderators can send staff direct messages" ON public.messages;
CREATE POLICY "Moderators can send staff direct messages"
  ON public.messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    OR (
      EXISTS (
        SELECT 1
        FROM public.user_roles r
        WHERE r.user_id = auth.uid()
          AND r.role::text = 'moderator'
      )
      AND sender_id = '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

DROP POLICY IF EXISTS "Moderators can view all chat_reads" ON public.chat_reads;
CREATE POLICY "Moderators can view all chat_reads"
  ON public.chat_reads FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  );

DROP POLICY IF EXISTS "Moderators can view all group_chat_reads" ON public.group_chat_reads;
CREATE POLICY "Moderators can view all group_chat_reads"
  ON public.group_chat_reads FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.role::text = 'moderator'
    )
  );

CREATE OR REPLACE FUNCTION public.list_chat_directory()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  reddit_username text,
  avatar_url text,
  role public.app_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id,
    p.full_name,
    p.reddit_username,
    p.avatar_url,
    ur.role
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT r.role
    FROM public.user_roles r
    WHERE r.user_id = p.user_id
    ORDER BY
      CASE r.role::text
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'moderator' THEN 3
        WHEN 'worker' THEN 4
        ELSE 5
      END
    LIMIT 1
  ) ur ON true
  WHERE auth.uid() IS NOT NULL
  ORDER BY COALESCE(NULLIF(p.full_name, ''), p.reddit_username, p.email);
$$;
