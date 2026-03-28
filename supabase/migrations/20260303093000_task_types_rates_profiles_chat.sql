-- Task type expansion + default rate settings + chat robustness

-- ------------------------------------------------------------
-- Profiles: worker/payment fields (idempotent)
-- ------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS upi_id TEXT,
  ADD COLUMN IF NOT EXISTS karma INTEGER,
  ADD COLUMN IF NOT EXISTS karma_range TEXT,
  ADD COLUMN IF NOT EXISTS cqs TEXT,
  ADD COLUMN IF NOT EXISTS cqs_proof TEXT,
  ADD COLUMN IF NOT EXISTS reddit_profile TEXT,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;

DO $$
BEGIN
  ALTER TABLE public.profiles ALTER COLUMN is_verified SET DEFAULT false;
EXCEPTION WHEN others THEN
  NULL;
END $$;

UPDATE public.profiles SET is_verified = false WHERE is_verified IS NULL;

-- ------------------------------------------------------------
-- Task types: add new enum labels
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'task_type' AND e.enumlabel = 'normal_comment'
  ) THEN
    ALTER TYPE public.task_type ADD VALUE 'normal_comment';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'task_type' AND e.enumlabel = 'support_comment'
  ) THEN
    ALTER TYPE public.task_type ADD VALUE 'support_comment';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'task_type' AND e.enumlabel = 'linked_comments'
  ) THEN
    ALTER TYPE public.task_type ADD VALUE 'linked_comments';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'task_type' AND e.enumlabel = 'non_linked_crosspost'
  ) THEN
    ALTER TYPE public.task_type ADD VALUE 'non_linked_crosspost';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'task_type' AND e.enumlabel = 'linked_post_crosspost'
  ) THEN
    ALTER TYPE public.task_type ADD VALUE 'linked_post_crosspost';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'task_type' AND e.enumlabel = 'non_linked_post'
  ) THEN
    ALTER TYPE public.task_type ADD VALUE 'non_linked_post';
  END IF;
END $$;

-- ------------------------------------------------------------
-- Task type rates (settings)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_type_rates (
  task_type public.task_type PRIMARY KEY,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.task_type_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and owners can manage task_type_rates" ON public.task_type_rates;
CREATE POLICY "Admins and owners can manage task_type_rates"
  ON public.task_type_rates FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

-- ------------------------------------------------------------
-- Chat: allow admin/owner to send as STAFF_UUID (virtual staff user)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert their messages" ON public.messages;
CREATE POLICY "Users can insert their messages" on public.messages
  for insert with check (
    auth.uid() = sender_id
    OR (
      (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner'))
      AND sender_id = '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

-- ------------------------------------------------------------
-- Chat reads (unread tracking per user & peer)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_reads (
  reader_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  peer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reader_id, peer_id)
);

ALTER TABLE public.chat_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their chat_reads" ON public.chat_reads;
CREATE POLICY "Users can manage their chat_reads"
  ON public.chat_reads FOR ALL
  USING (auth.uid() = reader_id)
  WITH CHECK (auth.uid() = reader_id);

DROP POLICY IF EXISTS "Admins and owners can view all chat_reads" ON public.chat_reads;
CREATE POLICY "Admins and owners can view all chat_reads"
  ON public.chat_reads FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );
