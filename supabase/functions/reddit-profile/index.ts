/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type N8nRedditProfile = Record<string, unknown>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });

const isUsernameSafe = (u: string) =>
  /^[A-Za-z0-9_-]{3,40}$/.test(u) && !u.includes("..");

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

  let body: { username?: unknown };
  try {
    body = (await req.json()) as { username?: unknown };
  } catch {
    return json({ ok: false, reason: "invalid_json" }, 400);
  }

  const username = typeof body?.username === "string" ? body.username.trim() : "";
  if (!username) return json({ ok: false, reason: "missing_username" }, 400);
  if (!isUsernameSafe(username)) return json({ ok: false, reason: "invalid_username" }, 400);

  const url = new URL("https://n8n.stoic-ops.com/webhook/reddit-profile");
  url.searchParams.set("username", username);

  try {
    const resp = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } });
    if (!resp.ok) {
      return json({ ok: false, reason: `n8n_http_${resp.status}` }, 200);
    }

    const profile = (await resp.json()) as unknown;
    if (!profile || typeof profile !== "object") {
      return json({ ok: false, reason: "n8n_invalid_json" }, 200);
    }

    return json({ ok: true, profile: profile as N8nRedditProfile }, 200);
  } catch {
    return json({ ok: false, reason: "n8n_network_error" }, 200);
  }
});

