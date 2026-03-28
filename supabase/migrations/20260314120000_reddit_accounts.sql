-- Create reddit_accounts table to support multiple verified Reddit identities per worker
CREATE TABLE IF NOT EXISTS public.reddit_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reddit_username TEXT NOT NULL,
  reddit_profile TEXT,
  reddit_data JSONB,
  is_verified BOOLEAN DEFAULT false,
  karma INTEGER,
  karma_range TEXT,
  cqs TEXT,
  cqs_proof TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Keep usernames unique per user (store normalized lower-case usernames)
CREATE UNIQUE INDEX IF NOT EXISTS reddit_accounts_user_username_unique
  ON public.reddit_accounts (user_id, reddit_username);

CREATE INDEX IF NOT EXISTS reddit_accounts_user_id_idx
  ON public.reddit_accounts (user_id);

ALTER TABLE public.reddit_accounts ENABLE ROW LEVEL SECURITY;

-- RLS: owners/admins/moderators can manage all reddit accounts
DROP POLICY IF EXISTS "Staff can manage reddit accounts" ON public.reddit_accounts;
CREATE POLICY "Staff can manage reddit accounts"
  ON public.reddit_accounts FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'moderator'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'moderator'));

-- RLS: users can view their own accounts
DROP POLICY IF EXISTS "Users can view their reddit accounts" ON public.reddit_accounts;
CREATE POLICY "Users can view their reddit accounts"
  ON public.reddit_accounts FOR SELECT
  USING (auth.uid() = user_id);

-- RLS: users can insert their own accounts
DROP POLICY IF EXISTS "Users can insert their reddit accounts" ON public.reddit_accounts;
CREATE POLICY "Users can insert their reddit accounts"
  ON public.reddit_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS: users can update their own accounts
DROP POLICY IF EXISTS "Users can update their reddit accounts" ON public.reddit_accounts;
CREATE POLICY "Users can update their reddit accounts"
  ON public.reddit_accounts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- updated_at trigger
DROP TRIGGER IF EXISTS update_reddit_accounts_updated_at ON public.reddit_accounts;
CREATE TRIGGER update_reddit_accounts_updated_at
  BEFORE UPDATE ON public.reddit_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill existing profile reddit data into reddit_accounts
INSERT INTO public.reddit_accounts (
  user_id,
  reddit_username,
  reddit_profile,
  reddit_data,
  is_verified,
  karma,
  karma_range,
  cqs,
  cqs_proof,
  avatar_url,
  created_at,
  updated_at
)
SELECT
  p.user_id,
  lower(p.reddit_username),
  p.reddit_profile,
  p.reddit_data,
  COALESCE(p.is_verified, false),
  p.karma,
  p.karma_range,
  p.cqs,
  p.cqs_proof,
  p.avatar_url,
  now(),
  now()
FROM public.profiles p
WHERE p.reddit_username IS NOT NULL AND p.reddit_username <> ''
ON CONFLICT DO NOTHING;

-- Track which reddit account was used to claim a task
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS reddit_account_id UUID REFERENCES public.reddit_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS task_assignments_reddit_account_id_idx
  ON public.task_assignments (reddit_account_id);

-- Store reddit account used in task submissions (helps admin review)
ALTER TABLE public.task_submissions
  ADD COLUMN IF NOT EXISTS reddit_account_id UUID REFERENCES public.reddit_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS task_submissions_reddit_account_id_idx
  ON public.task_submissions (reddit_account_id);
