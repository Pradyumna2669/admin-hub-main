import { supabase } from "@/integrations/supabase/client";
import type { ArcadeGameName, ArcadeLeaderboardRow, ArcadeStartRunResult, ArcadeSubmitScoreResult } from "@/pages/arcade/types";

const isMissingTable = (err: unknown) => (err as any)?.code === "PGRST205";

export const fetchCredits = async (userId: string): Promise<number> => {
  const { data, error } = await (supabase as any).from("users").select("credits").eq("id", userId).maybeSingle();

  if (error) {
    if (isMissingTable(error)) return 0;
    throw error;
  }

  const credits = (data as any)?.credits;
  return typeof credits === "number" ? credits : 0;
};

export const fetchLeaderboard = async (game: ArcadeGameName, limit = 10): Promise<ArcadeLeaderboardRow[]> => {
  const queryLimit = Math.max(limit * 10, 100);
  const { data, error } = await (supabase as any)
    .from("scores")
    .select("id,user_id,game_name,score,created_at")
    .eq("game_name", game)
    .order("score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(queryLimit);

  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }

  const sortedRows = ((data as ArcadeLeaderboardRow[]) || []).filter((row): row is ArcadeLeaderboardRow => !!row?.user_id);
  if (sortedRows.length === 0) return sortedRows;

  const uniqueRows: ArcadeLeaderboardRow[] = [];
  const seenUsers = new Set<string>();
  for (const row of sortedRows) {
    if (seenUsers.has(row.user_id)) continue;
    seenUsers.add(row.user_id);
    uniqueRows.push(row);
    if (uniqueRows.length >= limit) break;
  }

  if (uniqueRows.length === 0) return uniqueRows;

  return uniqueRows.map((row) => ({
    ...row,
    display_name: `Player ${row.user_id.slice(0, 8)}`,
  }));
};

const invokeArcade = async (body: unknown): Promise<any> => {
  // Some setups don't automatically forward the user's JWT to Edge Functions.
  // Force the Authorization header so the function can authenticate the caller.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const accessToken = session?.access_token;
  if (!accessToken) {
    return { accepted: false, reason: "unauthorized", message: "Please sign in again and retry." };
  }

  const { data, error } = await supabase.functions.invoke("arcade-submit-score", {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (error) {
    const err: any = error;
    const msg = err?.message || "Score submission failed.";
    const lowerMsg = typeof msg === "string" ? msg.toLowerCase() : "";

    // If the function returned a JSON error body (non-2xx), try to surface it to the UI.
    // supabase-js attaches the underlying Response on error.context.response.
    const resp: Response | undefined = err?.context?.response;
    if (resp) {
      try {
        const parsed = await resp.clone().json();
        if (parsed && typeof parsed === "object") {
          const accepted = (parsed as any).accepted;
          if (accepted === false) return parsed as ArcadeSubmitScoreResult;
          const reason = (parsed as any).reason;
          const message = (parsed as any).message;
          if (typeof reason === "string" || typeof message === "string") {
            return {
              accepted: false,
              reason: typeof reason === "string" ? reason : "invoke_failed",
              message: typeof message === "string" ? message : undefined,
            };
          }
        }
      } catch {
        // ignore parsing failure
      }

      return {
        accepted: false,
        reason: "invoke_failed",
        message: `${msg} (HTTP ${resp.status})`,
      };
    }

    const extra =
      lowerMsg.includes("failed to send a request") || lowerMsg.includes("networkerror") || lowerMsg.includes("fetch")
        ? "The browser could not reach the `arcade-submit-score` Edge Function. This is usually a deployed-function CORS/preflight issue. Redeploy the function with `verify_jwt = false` in `supabase/functions/arcade-submit-score/config.toml`."
        : undefined;
    return { accepted: false, reason: "invoke_failed", message: extra ? `${msg} ${extra}` : msg };
  }

  return data;
};

export const startRun = async (game: ArcadeGameName): Promise<ArcadeStartRunResult> =>
  (await invokeArcade({
    action: "start",
    game_name: game,
  })) as ArcadeStartRunResult;

export type SubmitScoreInput = {
  run_id: string;
  game_name: ArcadeGameName;
  score: number;
};

export const submitScore = async (input: SubmitScoreInput): Promise<ArcadeSubmitScoreResult> =>
  (await invokeArcade({
    action: "submit",
    ...input,
  })) as ArcadeSubmitScoreResult;
