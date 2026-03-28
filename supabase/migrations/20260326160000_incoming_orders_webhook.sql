CREATE TABLE IF NOT EXISTS public.incoming_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_type TEXT,
  order_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'orders-webhook',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incoming_orders_received_at_idx
  ON public.incoming_orders (received_at DESC);

CREATE INDEX IF NOT EXISTS incoming_orders_order_id_idx
  ON public.incoming_orders (order_id);

ALTER TABLE public.incoming_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and owners can view incoming orders" ON public.incoming_orders;
CREATE POLICY "Admins and owners can view incoming orders"
  ON public.incoming_orders FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );
