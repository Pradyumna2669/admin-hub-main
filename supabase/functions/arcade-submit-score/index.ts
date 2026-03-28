import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type GameName = "flappy" | "snake" | "stack";

type StartBody = {
  action: "start";
  game_name: GameName;
};

type SubmitBody = {
  action?: "submit";
  run_id: string;
  game_name: GameName;
  score: number;
};

type RequestBody = StartBody | SubmitBody;

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

const floorDayUTC = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

const isInt = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.floor(n) === n;

const flappyCreditsTotal = (score: number) => {
  let total = 0;
  if (score >= 10) total += 5;
  if (score >= 25) total += 10;
  if (score >= 50) total += 20;
  if (score > 50) total += Math.min(20, Math.floor((score - 50) / 10) * 2); // up to +20
  return total;
};

const snakeCreditsTotal = (length: number) => {
  let total = 0;
  if (length >= 10) total += 5;
  if (length >= 20) total += 10;
  if (length >= 30) total += 15;
  if (length > 30) total += Math.min(20, Math.floor((length - 30) / 5) * 2); // up to +20
  return total;
};

const stackCreditsTotal = (blocks: number) => {
  // "Combo multiplier" effect via tiered per-block reward:
  // 1 credit each for first 5, 2 credits each for next 5, 3 credits each after.
  const a = Math.min(blocks, 5) * 1;
  const b = Math.max(0, Math.min(blocks, 10) - 5) * 2;
  const c = Math.max(0, blocks - 10) * 3;
  return a + b + c;
};

const creditsFor = (game: GameName, score: number) => {
  if (game === "flappy") return flappyCreditsTotal(score);
  if (game === "snake") return snakeCreditsTotal(score);
  return stackCreditsTotal(score);
};

const validateRate = (game: GameName, score: number, durationSec: number) => {
  if (durationSec <= 0) return { ok: false, reason: "bad_duration" };

  if (game === "flappy") {
    const max = durationSec * 5 + 10;
    if (score > max) return { ok: false, reason: "score_too_fast" };
  } else if (game === "snake") {
    const max = (durationSec * 2 + 2) + 3; // +3 starting length
    if (score > max) return { ok: false, reason: "score_too_fast" };
  } else {
    const max = durationSec * 3 + 3;
    if (score > max) return { ok: false, reason: "score_too_fast" };
  }

  return { ok: true as const };
};

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200);
    if (req.method !== "POST") return json({ accepted: false, reason: "method_not_allowed" }, 405);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ accepted: false, reason: "server_not_configured" }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ accepted: false, reason: "unauthorized", message: "Missing Authorization header." }, 401);

  // Validate the caller using the official Edge Function pattern:
  // service role key + forward incoming Authorization to auth.getUser().
  const supabaseUser = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userRes, error: userErr } = await supabaseUser.auth.getUser();
  const user = userRes?.user ?? null;
  if (userErr || !user) {
    return json({ accepted: false, reason: "unauthorized", message: userErr?.message || "Invalid session." }, 401);
  }

  const userId = user.id;

  // Keep DB operations on a pure service-role client (no forwarded Authorization).
  const supabaseAdmin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ accepted: false, reason: "invalid_json" }, 400);
  }

  const game = body?.game_name;

  if (game !== "flappy" && game !== "snake" && game !== "stack") {
    return json({ accepted: false, reason: "invalid_game" }, 400);
  }

  if (body?.action === "start") {
    const nowIso = new Date().toISOString();
    const { data, error } = await (supabaseAdmin as any)
      .from("arcade_runs")
      .insert({
        user_id: userId,
        game_name: game,
        started_at: nowIso,
      })
      .select("id, started_at")
      .single();

    if (error) {
      const code = (error as any)?.code;
      if (code === "PGRST205") {
        return json({ accepted: false, reason: "db_not_migrated", message: "Missing arcade_runs table." }, 500);
      }
      return json({ accepted: false, reason: "db_error", message: (error as any)?.message }, 500);
    }

    return json(
      {
        accepted: true,
        run_id: (data as any).id,
        started_at: (data as any).started_at,
      },
      200,
    );
  }

  const runId = body?.run_id;
  const score = body?.score;
  if (typeof runId !== "string" || runId.trim().length < 10) {
    return json({ accepted: false, reason: "invalid_run" }, 400);
  }
  if (!isInt(score) || score < 0 || score > 10000) {
    return json({ accepted: false, reason: "invalid_score" }, 400);
  }

  const now = Date.now();
  const { data: runRow, error: runErr } = await (supabaseAdmin as any)
    .from("arcade_runs")
    .select("id,user_id,game_name,started_at,submitted_at")
    .eq("id", runId)
    .maybeSingle();

  if (runErr) {
    const code = (runErr as any)?.code;
    if (code === "PGRST205") return json({ accepted: false, reason: "db_not_migrated", message: "Missing arcade_runs table." }, 500);
    return json({ accepted: false, reason: "db_error", message: (runErr as any)?.message }, 500);
  }

  if (!runRow) return json({ accepted: false, reason: "invalid_run" }, 400);
  if ((runRow as any).user_id !== userId || (runRow as any).game_name !== game) {
    return json({ accepted: false, reason: "invalid_run" }, 400);
  }
  if ((runRow as any).submitted_at) return json({ accepted: false, reason: "run_already_submitted" }, 400);

  const started = Date.parse((runRow as any).started_at);
  if (!Number.isFinite(started)) return json({ accepted: false, reason: "invalid_time" }, 400);
  if (started > now + 5_000) return json({ accepted: false, reason: "invalid_time" }, 400);
  if (started < now - 30 * 60_000) return json({ accepted: false, reason: "duration_too_long" }, 400);

  const durationSec = (now - started) / 1000;
  const rateOk = validateRate(game, score, durationSec);
  if (!rateOk.ok) return json({ accepted: false, reason: rateOk.reason }, 400);

  // Fetch best score for today (UTC) to award only incremental credits.
  const todayStart = floorDayUTC(new Date(now));
  const { data: prev, error: prevErr } = await (supabaseAdmin as any)
    .from("scores")
    .select("score")
    .eq("user_id", userId)
    .eq("game_name", game)
    .gte("created_at", new Date(todayStart).toISOString())
    .order("score", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (prevErr) {
    const code = (prevErr as any)?.code;
    if (code === "PGRST205") return json({ accepted: false, reason: "db_not_migrated", message: "Missing scores table." }, 500);
    return json({ accepted: false, reason: "db_error", message: (prevErr as any)?.message }, 500);
  }

  const prevBest = isInt((prev as any)?.score) ? (prev as any).score : 0;
  const totalNew = creditsFor(game, score);
  const totalPrev = creditsFor(game, prevBest);
  const delta = Math.max(0, totalNew - totalPrev);

  const { error: insertErr } = await (supabaseAdmin as any).from("scores").insert({
    user_id: userId,
    game_name: game,
    score,
  });

  if (insertErr) {
    const code = (insertErr as any)?.code;
    if (code === "PGRST205") return json({ accepted: false, reason: "db_not_migrated", message: "Missing scores table." }, 500);
    return json({ accepted: false, reason: "db_error", message: (insertErr as any)?.message }, 500);
  }

  const { error: runUpdateErr } = await (supabaseAdmin as any)
    .from("arcade_runs")
    .update({
      submitted_at: new Date(now).toISOString(),
      submitted_score: score,
    })
    .eq("id", runId)
    .is("submitted_at", null);

  if (runUpdateErr) {
    const code = (runUpdateErr as any)?.code;
    if (code === "PGRST205") return json({ accepted: false, reason: "db_not_migrated", message: "Missing arcade_runs table." }, 500);
    return json({ accepted: false, reason: "db_error", message: (runUpdateErr as any)?.message }, 500);
  }

  let creditsTotal = 0;
  if (delta > 0) {
    const { data: creditsRes, error: creditsErr } = await (supabaseAdmin as any).rpc("arcade_increment_credits", {
      p_user_id: userId,
      p_delta: delta,
    });

    if (creditsErr) {
      const code = (creditsErr as any)?.code;
      if (code === "PGRST205") {
        return json({ accepted: true, credits_awarded: 0, credits_total: 0, best_today_score: Math.max(prevBest, score), message: "Missing users table." }, 200);
      }
      return json({ accepted: false, reason: "credits_update_failed", message: (creditsErr as any)?.message }, 500);
    }
    creditsTotal = typeof creditsRes === "number" ? creditsRes : 0;
  } else {
    const { data: urow } = await (supabaseAdmin as any).from("users").select("credits").eq("id", userId).maybeSingle();
    creditsTotal = typeof (urow as any)?.credits === "number" ? (urow as any).credits : 0;
  }

    return json(
      {
        accepted: true,
        credits_awarded: delta,
        credits_total: creditsTotal,
        best_today_score: Math.max(prevBest, score),
      },
      200,
    );
  } catch (err) {
    console.error("arcade-submit-score unhandled error", err);
    return json(
      {
        accepted: false,
        reason: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});
