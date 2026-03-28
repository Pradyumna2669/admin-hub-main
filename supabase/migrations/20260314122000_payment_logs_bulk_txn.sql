-- Allow bulk payouts by reusing transaction_id across multiple payment logs
DROP INDEX IF EXISTS payment_logs_transaction_id_unique_idx;
CREATE INDEX IF NOT EXISTS payment_logs_transaction_id_idx
  ON public.payment_logs (lower(transaction_id));
