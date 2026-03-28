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

const isUsernameSafe = (value: string) =>
  /^[A-Za-z0-9_-]{3,40}$/.test(value) && !value.includes("..");

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
    const rawUsername = typeof body?.redditUsername === "string" ? body.redditUsername : "";
    const karmaRange = typeof body?.karmaRange === "string" ? body.karmaRange.trim() : "";
    const cqs = typeof body?.cqs === "string" ? body.cqs.trim() : "";
    const cqsProof = typeof body?.cqsProof === "string" ? body.cqsProof.trim() : "";
    const cqsLink = typeof body?.cqsLink === "string" ? body.cqsLink.trim() : "";
    const discordUsername =
      typeof body?.discordUsername === "string" ? body.discordUsername.trim() : "";
    const referralCode =
      typeof body?.referralCode === "string" ? body.referralCode.trim().toUpperCase() : "";
    const upiId = typeof body?.upiId === "string" ? body.upiId.trim() : "";
    const screenshotPath =
      typeof body?.screenshotPath === "string" ? body.screenshotPath.trim() : "";

    const username = normalizeRedditUsername(rawUsername);

    if (!username || !isUsernameSafe(username)) {
      return json({ ok: false, reason: "invalid_username", message: "Invalid Reddit username." }, 400);
    }

    if (!karmaRange || !cqs || !cqsProof || !cqsLink || !screenshotPath) {
      return json(
        {
          ok: false,
          reason: "missing_fields",
          message: "Karma range, CQS, proof link, profile link, and screenshot are required.",
        },
        400,
      );
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

    if (screenshotPath.includes("..") || !screenshotPath.startsWith(`reddit_screenshots/${user.id}/`)) {
      return json(
        {
          ok: false,
          reason: "invalid_screenshot_path",
          message: "Screenshot path must belong to the current user.",
        },
        400,
      );
    }

    if (referralCode) {
      const { data: referralLookup, error: referralLookupError } = await supabaseUser.rpc(
        "get_referral_owner",
        { p_code: referralCode },
      );

      if (referralLookupError) {
        return json(
          {
            ok: false,
            reason: "referral_lookup_failed",
            message: referralLookupError.message,
          },
          400,
        );
      }

      if (!Array.isArray(referralLookup) || referralLookup.length === 0) {
        return json(
          {
            ok: false,
            reason: "invalid_referral_code",
            message: "Please enter a valid tasker referral code or leave it empty.",
          },
          400,
        );
      }
    }

    const { data: existingAccount, error: existingError } = await supabaseAdmin
      .from("reddit_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("reddit_username", username)
      .maybeSingle();

    if (existingError) {
      return json(
        {
          ok: false,
          reason: "existing_lookup_failed",
          message: existingError.message,
        },
        500,
      );
    }

    if (existingAccount?.id) {
      return json(
        {
          ok: false,
          reason: "duplicate_reddit_account",
          message: "Reddit account already added. Please add a different Reddit username.",
        },
        409,
      );
    }

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
    const nowIso = new Date().toISOString();

    const payload: Record<string, unknown> = {
      user_id: user.id,
      reddit_username: n8nProfile?.username?.toLowerCase() || username,
      reddit_profile: n8nProfile?.profile_url || null,
      karma: typeof n8nProfile?.total_karma === "number" ? n8nProfile.total_karma : null,
      karma_range: karmaRange,
      cqs,
      cqs_proof: cqsProof,
      is_verified: shouldAutoVerify,
      reddit_data: {
        referredBy: referralCode || null,
        referredByCode: referralCode || null,
        discordUsername: discordUsername || null,
        cqsLink,
        redditScreenshot: screenshotPath,
        n8nRedditProfile: n8nProfile,
        n8nFetchedAt: nowIso,
        verification: {
          autoVerifyAttempts: 1,
          status: shouldAutoVerify ? "auto_verified" : "pending_manual_verification",
          reason: n8n.ok
            ? n8nProfile?.is_verified
              ? null
              : "n8n_is_verified_false"
            : n8n.error,
        },
      },
    };

    if (typeof n8nProfile?.avatar === "string") {
      payload.avatar_url = n8nProfile.avatar;
    }

    const { data: insertedAccount, error: insertError } = await supabaseAdmin
      .from("reddit_accounts")
      .insert(payload)
      .select("id")
      .maybeSingle();
    if (insertError || !insertedAccount?.id) {
      return json(
        {
          ok: false,
          reason: "insert_failed",
          message: insertError?.message || "Could not create Reddit account record.",
        },
        500,
      );
    }

    if (upiId) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .update({ upi_id: upiId })
        .eq("user_id", user.id);

      if (profileError) {
        await supabaseAdmin.from("reddit_accounts").delete().eq("id", insertedAccount.id);
        return json(
          {
            ok: false,
            reason: "profile_update_failed",
            message: profileError.message,
          },
          500,
        );
      }
    }

    if (referralCode) {
      const { error: applyReferralError } = await supabaseUser.rpc("apply_referral_code", {
        p_code: referralCode,
      });

      if (applyReferralError) {
        await supabaseAdmin.from("reddit_accounts").delete().eq("id", insertedAccount.id);
        return json(
          {
            ok: false,
            reason: "referral_apply_failed",
            message: applyReferralError.message,
          },
          400,
        );
      }
    }

    return json({
      ok: true,
      is_verified: shouldAutoVerify,
    });
  } catch (error) {
    console.error("save-reddit-account unhandled error", error);
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

