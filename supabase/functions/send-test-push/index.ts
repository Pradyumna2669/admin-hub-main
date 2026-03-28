import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

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

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200);
    if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("WEB_PUSH_VAPID_SUBJECT") || "mailto:admin@example.com";

    if (!url || !serviceRoleKey) {
      return json({ ok: false, reason: "server_not_configured" }, 500);
    }

    if (!vapidPublicKey || !vapidPrivateKey) {
      return json({ ok: false, reason: "vapid_not_configured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, reason: "unauthorized" }, 401);
    }

    const supabaseUser = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes, error: userErr } = await supabaseUser.auth.getUser();
    const user = userRes?.user ?? null;
    if (userErr || !user) {
      return json({ ok: false, reason: "unauthorized", message: userErr?.message || "Invalid session." }, 401);
    }

    const supabaseAdmin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: subscriptions, error: subsErr } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .eq("user_id", user.id);

    if (subsErr) {
      return json({ ok: false, reason: "subscriptions_lookup_failed", message: subsErr.message }, 500);
    }

    const subscriptionRows = (subscriptions || []) as PushSubscriptionRow[];
    if (subscriptionRows.length === 0) {
      return json({ ok: false, reason: "no_subscriptions" }, 400);
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const payload = JSON.stringify({
      kind: "chat",
      title: "Test notification",
      body: "Push notifications are working.",
      url: "/profile",
      tag: "test-push",
    });

    const staleSubscriptionIds: string[] = [];
    let sent = 0;

    for (const subscription of subscriptionRows) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          payload,
          { TTL: 60 }
        );
        sent += 1;
      } catch (error) {
        const statusCode =
          typeof error === "object" && error && "statusCode" in error
            ? Number((error as { statusCode?: number }).statusCode)
            : null;

        if (statusCode === 404 || statusCode === 410) {
          staleSubscriptionIds.push(subscription.id);
        } else {
          console.error("Failed to send test push", {
            subscriptionId: subscription.id,
            error,
          });
        }
      }
    }

    if (staleSubscriptionIds.length > 0) {
      await supabaseAdmin.from("push_subscriptions").delete().in("id", staleSubscriptionIds);
    }

    return json({ ok: true, sent, stale_removed: staleSubscriptionIds.length });
  } catch (error) {
    console.error("send-test-push unhandled error", error);
    return json(
      {
        ok: false,
        reason: "internal_error",
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});
