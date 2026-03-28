import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return json({ ok: true }, 200);
  }

  if (req.method !== "POST") {
    return json({ ok: false, reason: "method_not_allowed" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, reason: "server_not_configured" }, 500);
  }

  const payload = await req.json().catch(() => null);
  const event = typeof payload?.event === "string" ? payload.event.trim() : "";
  const orderId = typeof payload?.order_id === "string" ? payload.order_id.trim() : "";
  const orderType = typeof payload?.order_type === "string" ? payload.order_type.trim() : null;
  const orderData =
    payload && typeof payload === "object" && payload.order_data && typeof payload.order_data === "object"
      ? payload.order_data
      : {};

  if (!event || !orderId) {
    return json(
      {
        ok: false,
        reason: "invalid_payload",
        message: "Payload must include event and order_id.",
      },
      400,
    );
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const insertPayload = {
    event,
    order_id: orderId,
    order_type: orderType,
    order_data: orderData,
    raw_payload: payload && typeof payload === "object" ? payload : {},
    source: "orders-webhook",
  };

  const { data, error } = await supabaseAdmin
    .from("incoming_orders")
    .insert(insertPayload)
    .select("id, event, order_id, order_type, order_data, received_at")
    .single();

  if (error) {
    return json(
      {
        ok: false,
        reason: "insert_failed",
        message: error.message,
      },
      500,
    );
  }

  return json(
    {
      ok: true,
      accepted: true,
      stored: true,
      order: data,
    },
    201,
  );
});
