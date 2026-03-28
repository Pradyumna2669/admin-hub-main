-- Add payment proof tracking and payout ledger support.

CREATE TABLE IF NOT EXISTS public.payment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID REFERENCES public.task_assignments(id) ON DELETE SET NULL,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  worker_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  worker_name TEXT,
  worker_email TEXT,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  transaction_id TEXT NOT NULL,
  payment_proof_url TEXT NOT NULL,
  notes TEXT,
  paid_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payer_name TEXT,
  paid_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_logs
  ADD COLUMN IF NOT EXISTS assignment_id UUID REFERENCES public.task_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS worker_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS worker_name TEXT,
  ADD COLUMN IF NOT EXISTS worker_email TEXT,
  ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payer_name TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

ALTER TABLE public.payment_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS payment_completed_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS payment_logs_transaction_id_unique_idx
  ON public.payment_logs (lower(transaction_id));

CREATE INDEX IF NOT EXISTS payment_logs_worker_id_paid_at_idx
  ON public.payment_logs (worker_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS payment_logs_paid_by_paid_at_idx
  ON public.payment_logs (paid_by, paid_at DESC);

DROP POLICY IF EXISTS "Staff can view payment logs" ON public.payment_logs;
CREATE POLICY "Staff can view payment logs"
  ON public.payment_logs
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'moderator')
  );

DROP POLICY IF EXISTS "Staff can insert payment logs" ON public.payment_logs;
CREATE POLICY "Staff can insert payment logs"
  ON public.payment_logs
  FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'moderator')
  );

DROP POLICY IF EXISTS "Workers can view own payment logs" ON public.payment_logs;
CREATE POLICY "Workers can view own payment logs"
  ON public.payment_logs
  FOR SELECT
  USING (auth.uid() = worker_id);
