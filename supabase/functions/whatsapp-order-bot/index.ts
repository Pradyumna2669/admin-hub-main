import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type IncomingWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string;
          text?: {
            body?: string;
          };
        }>;
      };
    }>;
  }>;
};

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  whatsapp_phone_e164: string | null;
  whatsapp_opt_in: boolean;
};

type OrderRow = {
  id: string;
  status: string;
  created_at: string;
  public_order_code: string;
  title: string;
  target_link: string | null;
  task_assignments: Array<{
    status: string;
    payment_status: string;
    amount: number | null;
  }> | null;
  task_items: Array<{
    quantity: number;
  }> | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    },
  });

const getEnv = (name: string) => Deno.env.get(name)?.trim() || "";

const timingSafeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
};

const sha256Hex = async (secret: string, body: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return Array.from(new Uint8Array(signature))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
};

const normalizePhoneNumber = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
};

const normalizeOrderCode = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");

const buildHelpText = (name?: string | null) => {
  const greeting = name?.trim() ? `Hi ${name.trim()},` : "Hi,";
  return [
    `${greeting} send one of these commands:`,
    "1. orders",
    "2. status",
    "3. order ORD-1234ABCD",
  ].join("\n");
};

const formatOrderLine = (order: OrderRow) => {
  const assignment = order.task_assignments?.[0];
  const quantity =
    order.task_items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 0;
  const amount = assignment?.amount ?? null;

  return [
    `Order: ${order.public_order_code}`,
    `Title: ${order.title}`,
    `Status: ${(assignment?.status || order.status).replace(/_/g, " ")}`,
    `Payment: ${(assignment?.payment_status || "pending").replace(/_/g, " ")}`,
    quantity > 0 ? `Items: ${quantity}` : null,
    amount !== null ? `Amount: Rs ${amount}` : null,
    order.target_link ? `Link: ${order.target_link}` : null,
    `Created: ${new Date(order.created_at).toLocaleDateString("en-GB", { timeZone: "UTC" })}`,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildOrdersReply = (orders: OrderRow[]) => {
  if (orders.length === 0) {
    return "No orders were found for this WhatsApp number.";
  }

  const header =
    orders.length === 1
      ? "I found 1 order for your account:"
      : `I found ${orders.length} recent orders for your account:`;

  return [header, ...orders.map((order) => formatOrderLine(order))].join("\n\n");
};

const parseIntent = (body: string) => {
  const normalized = body.trim().toLowerCase();
  const orderMatch = body.match(/\bORD-[A-Z0-9-]+\b/i);
  if (orderMatch) {
    return {
      type: "order_lookup" as const,
      orderCode: normalizeOrderCode(orderMatch[0]),
    };
  }
  if (["hi", "hello", "help", "menu", "start"].includes(normalized)) {
    return { type: "help" as const };
  }
  if (normalized.includes("order") || normalized.includes("status")) {
    return { type: "recent_orders" as const };
  }
  return { type: "help" as const };
};

const sendWhatsAppText = async (to: string, body: string) => {
  const accessToken = getEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = getEnv("WHATSAPP_PHONE_NUMBER_ID");

  if (!accessToken || !phoneNumberId) {
    throw new Error("WhatsApp API credentials are not configured.");
  }

  const response = await fetch(
    `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${text}`);
  }
};

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true });

    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ ok: false, reason: "server_not_configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (req.method === "GET") {
      const verifyToken = getEnv("WHATSAPP_VERIFY_TOKEN");
      const url = new URL(req.url);
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (verifyToken && mode === "subscribe" && token === verifyToken && challenge) {
        return new Response(challenge, { status: 200 });
      }

      return new Response("Forbidden", { status: 403 });
    }

    if (req.method !== "POST") {
      return json({ ok: false, reason: "method_not_allowed" }, 405);
    }

    const appSecret = getEnv("WHATSAPP_APP_SECRET");
    const rawBody = await req.text();
    if (appSecret) {
      const providedSignature = req.headers.get("x-hub-signature-256") || "";
      const expectedSignature = `sha256=${await sha256Hex(appSecret, rawBody)}`;
      if (!providedSignature || !timingSafeEqual(providedSignature, expectedSignature)) {
        return json({ ok: false, reason: "invalid_signature" }, 401);
      }
    }

    const payload = JSON.parse(rawBody) as IncomingWebhookPayload;
    const messages =
      payload.entry?.flatMap((entry) =>
        (entry.changes || []).flatMap((change) => change.value?.messages || [])
      ) || [];

    for (const message of messages) {
      const from = normalizePhoneNumber(message.from || "");
      const text = message.text?.body?.trim() || "";
      if (!from || !text) continue;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("user_id, full_name, whatsapp_phone_e164, whatsapp_opt_in")
        .eq("whatsapp_phone_e164", from)
        .maybeSingle();

      if (profileError) {
        console.error("whatsapp-order-bot profile lookup failed", profileError);
        continue;
      }

      const matchedProfile = profile as ProfileRow | null;
      if (!matchedProfile || !matchedProfile.whatsapp_opt_in) {
        await sendWhatsAppText(
          from.replace(/^\+/, ""),
          "Your number is not linked for order updates yet. Please contact support to enable WhatsApp tracking.",
        );
        continue;
      }

      const intent = parseIntent(text);
      let reply = buildHelpText(matchedProfile.full_name);

      if (intent.type === "recent_orders") {
        const { data: orders, error: ordersError } = await supabase
          .from("tasks")
          .select("id, title, status, created_at, public_order_code, target_link, task_items(quantity), task_assignments!inner(status, payment_status, amount)")
          .eq("task_assignments.user_id", matchedProfile.user_id)
          .order("created_at", { ascending: false })
          .limit(5);

        if (ordersError) {
          console.error("whatsapp-order-bot recent orders failed", ordersError);
          reply = "I could not load your orders right now. Please try again shortly.";
        } else {
          reply = buildOrdersReply((orders || []) as OrderRow[]);
        }
      }

      if (intent.type === "order_lookup") {
        const { data: order, error: orderError } = await supabase
          .from("tasks")
          .select("id, title, status, created_at, public_order_code, target_link, task_items(quantity), task_assignments!inner(status, payment_status, amount)")
          .eq("public_order_code", intent.orderCode)
          .eq("task_assignments.user_id", matchedProfile.user_id)
          .maybeSingle();

        if (orderError) {
          console.error("whatsapp-order-bot order lookup failed", orderError);
          reply = "I could not load that order right now. Please try again shortly.";
        } else if (!order) {
          reply = `No order matched ${intent.orderCode} for your account.`;
        } else {
          reply = formatOrderLine(order as OrderRow);
        }
      }

      await sendWhatsAppText(from.replace(/^\+/, ""), reply.slice(0, 4096));
    }

    return json({ ok: true });
  } catch (error) {
    console.error("whatsapp-order-bot unhandled error", error);
    return json(
      {
        ok: false,
        reason: "internal_error",
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
