/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type N8nRedditProfile = {
  username?: string;
  profile_url?: string;
  avatar?: string | null;
  total_karma?: number;
  is_verified?: boolean;
  is_suspended?: boolean;
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const normalizeRedditUsername = (value: string) =>
  value.trim().replace(/^\/?u\//i, "").replace(/^@/, "").trim().toLowerCase();

const fetchN8nRedditProfile = async (username: string) => {
  const url = new URL("https://n8n.stoic-ops.com/webhook/reddit-profile");
  url.searchParams.set("username", username);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return { ok: false as const, error: `n8n_http_${response.status}` };
    }

    const payload = await response.json();
    if (!payload || typeof payload !== "object") {
      return { ok: false as const, error: "n8n_invalid_json" };
    }

    return { ok: true as const, data: payload as N8nRedditProfile };
  } catch {
    return { ok: false as const, error: "n8n_network_error" };
  }
};

const isAutoVerifiedRedditProfile = (profile: N8nRedditProfile | null) =>
  !!profile?.profile_url &&
  !!profile?.is_verified &&
  typeof profile?.total_karma === "number" &&
  !profile?.is_suspended;

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200);
    if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok: false, reason: "server_not_configured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, reason: "unauthorized" }, 401);
    }

    const body = await req.json().catch(() => null);
    const accountId = typeof body?.account_id === "string" ? body.account_id.trim() : "";
    if (!accountId) {
      return json({ ok: false, reason: "missing_account_id", message: "Account id is required." }, 400);
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userRes, error: userErr } = await supabaseUser.auth.getUser();
    const user = userRes?.user ?? null;
    if (userErr || !user) {
      return json({ ok: false, reason: "unauthorized", message: userErr?.message || "Invalid session." }, 401);
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from("reddit_accounts")
      .select("id, user_id, reddit_username, reddit_data")
      .eq("id", accountId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (accountError) {
      return json({ ok: false, reason: "account_lookup_failed", message: accountError.message }, 500);
    }

    if (!account?.id || !account?.reddit_username) {
      return json({ ok: false, reason: "account_not_found", message: "Reddit account not found." }, 404);
    }

    const redditData = account.reddit_data && typeof account.reddit_data === "object"
      ? account.reddit_data as Record<string, unknown>
      : {};
    const verification = redditData.verification && typeof redditData.verification === "object"
      ? redditData.verification as Record<string, unknown>
      : {};
    const currentAttempts = typeof verification.autoVerifyAttempts === "number"
      ? verification.autoVerifyAttempts
      : 0;

    if (currentAttempts >= 2) {
      return json(
        {
          ok: false,
          reason: "auto_verify_limit_reached",
          message: "Auto verify limit reached. Admin verification is now required.",
        },
        400,
      );
    }

    const username = normalizeRedditUsername(account.reddit_username);
    const n8n = await fetchN8nRedditProfile(username);
    const n8nProfile = n8n.ok ? n8n.data : null;

    if (n8nProfile?.is_suspended) {
      return json(
        {
          ok: false,
          reason: "reddit_account_suspended",
          message: "Suspended Reddit accounts are not allowed.",
        },
        400,
      );
    }

    const shouldAutoVerify = isAutoVerifiedRedditProfile(n8nProfile);
    const nextAttempts = currentAttempts + 1;
    const nowIso = new Date().toISOString();

    const updatedRedditData = {
      ...redditData,
      n8nRedditProfile: n8nProfile,
      n8nFetchedAt: nowIso,
      verification: {
        ...verification,
        autoVerifyAttempts: nextAttempts,
        status: shouldAutoVerify ? "auto_verified" : "pending_manual_verification",
        reason: n8n.ok
          ? n8nProfile?.is_verified
            ? null
            : "n8n_is_verified_false"
          : n8n.error,
      },
    };

    const updates: Record<string, unknown> = {
      reddit_username: n8nProfile?.username?.toLowerCase() || username,
      reddit_profile: n8nProfile?.profile_url || null,
      karma: typeof n8nProfile?.total_karma === "number" ? n8nProfile.total_karma : null,
      is_verified: shouldAutoVerify,
      reddit_data: updatedRedditData,
    };

    if (typeof n8nProfile?.avatar === "string") {
      updates.avatar_url = n8nProfile.avatar;
    }

    const { error: updateError } = await supabaseAdmin
      .from("reddit_accounts")
      .update(updates)
      .eq("id", account.id)
      .eq("user_id", user.id);

    if (updateError) {
      return json({ ok: false, reason: "update_failed", message: updateError.message }, 500);
    }

    return json({
      ok: true,
      is_verified: shouldAutoVerify,
      auto_verify_attempts: nextAttempts,
      verification_status: shouldAutoVerify ? "auto_verified" : "pending_manual_verification",
    });
  } catch (error) {
    console.error("retry-reddit-account-verification unhandled error", error);
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
