/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const LEAGUE_ORDER = ["bronze", "silver", "gold", "platinum", "diamond"] as const;

type League = typeof LEAGUE_ORDER[number];
type UserRole = "owner" | "admin" | "moderator" | "client" | "worker" | null;

type RedditAccountRow = {
  user_id: string;
  karma: number | null;
  karma_range: string | null;
  cqs: string | null;
};

type ProfileRow = {
  user_id: string;
  league: string | null;
  is_banned: boolean | null;
};

const isHighCqs = (cqs?: string | null) => {
  if (!cqs) return false;
  const v = cqs.trim().toLowerCase();
  return v === "high" || v === "highest";
};

const baseLeague = (karma: number | null | undefined) => {
  const v = typeof karma === "number" && Number.isFinite(karma) ? karma : 0;
  if (v >= 50_000) return "diamond" as const;
  if (v >= 25_000) return "platinum" as const;
  if (v >= 5_000) return "gold" as const;
  if (v >= 1_000) return "silver" as const;
  return "bronze" as const;
};

const deriveFromRange = (range?: string | null) => {
  if (!range) return null;
  const r = range.trim().toLowerCase();
  if (r.startsWith("50k")) return 50_000;
  if (r.startsWith("25k")) return 25_000;
  if (r.startsWith("5k")) return 5_000;
  if (r.startsWith("1k")) return 1_000;
  if (r.includes("200") && r.includes("1k")) return 200;
  return null;
};

const computeLeague = (karma: number | null | undefined, karmaRange: string | null | undefined, cqs: string | null | undefined) => {
  const effectiveKarma = Number.isFinite(karma as number) ? (karma as number) : deriveFromRange(karmaRange);
  const base = baseLeague(effectiveKarma ?? 0);
  if (isHighCqs(cqs)) {
    if (base === "bronze") return "silver" as const;
    if (base === "silver") return "gold" as const;
    if (base === "gold") return "platinum" as const;
    return "diamond" as const;
  }
  return base;
};

const maxLeague = (leagues: League[]) => {
  let best: League | null = null;
  for (const league of leagues) {
    if (!best) {
      best = league;
      continue;
    }
    if (LEAGUE_ORDER.indexOf(league) > LEAGUE_ORDER.indexOf(best)) {
      best = league;
    }
  }
  return best;
};

const isTrustedServerCall = (authHeader: string | null) => {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return false;
  return token === SERVICE_ROLE_KEY || (!!CRON_SECRET && token === CRON_SECRET);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST" && req.method !== "GET") return json({ ok: false, reason: "method_not_allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ ok: false, reason: "missing_service_role_env" }, 500);
  }

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authHeader = req.headers.get("Authorization");
  if (!isTrustedServerCall(authHeader)) {
    if (!authHeader) {
      return json({ ok: false, reason: "unauthorized" }, 401);
    }

    const supabaseUser = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await supabaseUser.auth.getUser();
    const user = userRes?.user ?? null;
    if (userErr || !user) {
      return json({ ok: false, reason: "unauthorized", message: userErr?.message ?? "Invalid session." }, 401);
    }

    const { data: role, error: roleErr } = await client.rpc("get_user_role", { _user_id: user.id });
    if (roleErr) {
      return json({ ok: false, reason: "role_lookup_failed", message: roleErr.message }, 403);
    }

    const roleValue = String(role || "") as UserRole;
    if (!["owner", "admin", "moderator"].includes(roleValue)) {
      return json({ ok: false, reason: "forbidden" }, 403);
    }
  }

  const [{ data: profiles, error: profileErr }, { data: accounts, error: accountErr }] = await Promise.all([
    client
      .from("profiles")
      .select("user_id, league, is_banned"),
    client
      .from("reddit_accounts")
      .select("user_id, karma, karma_range, cqs")
      .eq("is_verified", true),
  ]);

  if (profileErr) return json({ ok: false, reason: profileErr.message }, 500);
  if (accountErr) return json({ ok: false, reason: accountErr.message }, 500);

  const accountsByUserId = new Map<string, RedditAccountRow[]>();
  for (const account of (accounts || []) as RedditAccountRow[]) {
    const list = accountsByUserId.get(account.user_id) || [];
    list.push(account);
    accountsByUserId.set(account.user_id, list);
  }

  const updates: Array<{ user_id: string; league: string }> = [];
  for (const p of (profiles || []) as ProfileRow[]) {
    if (p.is_banned) continue;
    const userAccounts = accountsByUserId.get(p.user_id) || [];
    if (userAccounts.length === 0) continue;
    const leagues = userAccounts.map((a) => computeLeague(a.karma, a.karma_range, a.cqs));
    const next = maxLeague(leagues as League[]) || null;
    const prev = p.league || null;
    if (next && next !== prev) updates.push({ user_id: p.user_id, league: next });
  }

  for (let i = 0; i < updates.length; i += 50) {
    const chunk = updates.slice(i, i + 50);
    const promises = chunk.map((update) =>
      client.from("profiles").update({ league: update.league }).eq("user_id", update.user_id)
    );
    const results = await Promise.all(promises);
    for (const res of results) {
      if (res.error) {
         console.error("Error updating profile:", res.error);
         return json({ ok: false, reason: res.error.message, updated: i }, 500);
      }
    }
  }

  return json({ ok: true, scanned: (profiles || []).length, updated: updates.length });
});
