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
const BATCH_SIZE = 5;
const DELAY_MS = 1000;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type RedditAccountRow = {
  id: string;
  user_id: string;
  reddit_username: string | null;
  karma: number | null;
  cqs: string | null;
  is_verified: boolean | null;
  reddit_data: any;
};

type UserRole = "owner" | "admin" | "moderator" | "client" | "worker" | null;

const isTrustedServerCall = (authHeader: string | null) => {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return false;
  return token === SERVICE_ROLE_KEY || (!!CRON_SECRET && token === CRON_SECRET);
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);

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

  const { data: accounts, error: accountErr } = await client
    .from("reddit_accounts")
    .select("id, user_id, reddit_username, karma, cqs, is_verified, reddit_data")
    .eq("is_verified", true);

  if (accountErr) {
    return json({ ok: false, reason: accountErr.message }, 500);
  }

  const verifiedAccounts = (accounts || []) as RedditAccountRow[];
  const validAccounts = verifiedAccounts.filter(a => a.reddit_username);

  console.log(`Found ${validAccounts.length} verified Reddit accounts to update.`);

  const updates: Array<{ id: string; karma: number; is_verified?: boolean; reddit_data?: any }> = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < validAccounts.length; i += BATCH_SIZE) {
    const batch = validAccounts.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (account) => {
      try {
        const url = new URL("https://n8n.stoic-ops.com/webhook/reddit-profile");
        url.searchParams.set("username", account.reddit_username!);

        const resp = await fetch(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" }
        });

        if (!resp.ok) {
          console.warn(`[${account.reddit_username}] HTTP Error: ${resp.status}`);
          failureCount++;
          return;
        }

        const profile = await resp.json() as any;

        if (!profile || typeof profile !== "object") {
          console.warn(`[${account.reddit_username}] Invalid JSON from n8n`);
          failureCount++;
          return;
        }

        const newKarma = typeof profile.total_karma === "number" ? profile.total_karma : account.karma;
        const isSuspended = profile.is_suspended === true;

        const updateData: any = {
          id: account.id,
          karma: newKarma,
        };

        if (isSuspended) {
          updateData.is_verified = false;

          const existingData = typeof account.reddit_data === 'object' && account.reddit_data !== null
            ? account.reddit_data
            : {};

          updateData.reddit_data = {
            ...existingData,
            verification: {
              ...(existingData.verification || {}),
              status: 'rejected_by_admin',
              rejectionReason: 'Account Banned on Reddit',
              rejectedAt: new Date().toISOString(),
              rejectedBy: 'system'
            }
          };
        }

        updates.push(updateData);
        successCount++;
        console.log(`[${account.reddit_username}] Success: Karma = ${newKarma}`);

      } catch (err) {
        console.warn(`[${account.reddit_username}] Network/Fetch Error:`, err);
        failureCount++;
      }
    });

    await Promise.all(batchPromises);

    if (i + BATCH_SIZE < validAccounts.length) {
      await delay(DELAY_MS);
    }
  }

  console.log(`Updating ${updates.length} accounts in database...`);

  let dbSuccessCount = 0;
  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    const standardisedChunk = chunk.map(u => {
      const payload: any = { id: u.id, karma: u.karma };
      if (u.is_verified !== undefined) payload.is_verified = u.is_verified;
      if (u.reddit_data !== undefined) payload.reddit_data = u.reddit_data;
      return payload;
    });

    for (const update of standardisedChunk) {
      const { error: upErr } = await client
        .from("reddit_accounts")
        .update(update)
        .eq("id", update.id);

      if (!upErr) {
        dbSuccessCount++;
      } else {
        console.error(`DB Update Error for ${update.id}:`, upErr);
      }
    }
  }

  try {
    const fnUrl = `${SUPABASE_URL}/functions/v1/refresh-leagues`;
    const fnResp = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });
    console.log(`Triggered refresh-leagues: ${fnResp.status}`);
  } catch (err) {
    console.error('Error triggering refresh-leagues:', err);
  }

  return json({
    ok: true,
    scanned: validAccounts.length,
    n8n_success: successCount,
    n8n_failures: failureCount,
    db_updated: dbSuccessCount
  });
});
