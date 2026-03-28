-- Add Discord-style replies and emoji reactions for group chat.

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS replied_to_id UUID REFERENCES public.group_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS group_messages_room_replied_to_idx
  ON public.group_messages (room, replied_to_id);

CREATE TABLE IF NOT EXISTS public.group_message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.group_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS group_message_reactions_message_created_idx
  ON public.group_message_reactions (message_id, created_at);

ALTER TABLE public.group_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_message_reactions REPLICA IDENTITY FULL;

DROP POLICY IF EXISTS "Authenticated users can view group message reactions" ON public.group_message_reactions;
CREATE POLICY "Authenticated users can view group message reactions"
  ON public.group_message_reactions
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can insert their own group message reactions" ON public.group_message_reactions;
CREATE POLICY "Users can insert their own group message reactions"
  ON public.group_message_reactions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own group message reactions" ON public.group_message_reactions;
CREATE POLICY "Users can delete their own group message reactions"
  ON public.group_message_reactions
  FOR DELETE
  USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_message_reactions;
