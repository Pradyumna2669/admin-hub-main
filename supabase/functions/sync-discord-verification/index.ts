import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type ProfileRow = {
  user_id: string;
  discord_user_id: string | null;
  discord_username: string | null;
  discord_in_server: boolean | null;
  discord_verified: boolean | null;
  discord_last_checked_at: string | null;
  discord_verified_at: string | null;
};

type DiscordGuildMember = {
  user?: {
    id?: string;
    username?: string;
    global_name?: string | null;
  } | null;
  roles?: string[] | null;
};

type ErrorPayload = {
  ok: false;
  reason: string;
  message?: string;
  invite_url?: string;
  missing?: string[];
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

const missingDiscordConfig = () => {
  const missing: string[] = [];
  if (!DISCORD_BOT_TOKEN) missing.push("DISCORD_BOT_TOKEN");
  if (!DISCORD_GUILD_ID) missing.push("DISCORD_GUILD_ID");
  return missing;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") || "";
const DISCORD_GUILD_ID = Deno.env.get("DISCORD_GUILD_ID") || "";
const DISCORD_VERIFIED_ROLE_ID = Deno.env.get("DISCORD_VERIFIED_ROLE_ID") || "";
const DISCORD_UNVERIFIED_ROLE_ID = Deno.env.get("DISCORD_UNVERIFIED_ROLE_ID") || "";
const PUBLIC_DISCORD_INVITE_URL =
  Deno.env.get("PUBLIC_DISCORD_INVITE_URL") || "https://discord.gg/au7BbcANKE";

const discordApi = async (
  path: string,
  init?: RequestInit,
) => {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      ...(init?.headers || {}),
    },
  });
  return response;
};

const syncProfileStatus = async (
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  payload: Record<string, unknown>,
) => {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update(payload)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
};

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200);
    if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok: false, reason: "server_not_configured" }, 500);
    }

    const missingConfig = missingDiscordConfig();
    if (missingConfig.length > 0) {
      const payload: ErrorPayload = {
        ok: false,
        reason: "discord_not_configured",
        message: `Missing Discord server configuration: ${missingConfig.join(", ")}.`,
        missing: missingConfig,
      };
      return json(payload, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, reason: "unauthorized" }, 401);
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
      return json(
        { ok: false, reason: "unauthorized", message: userErr?.message || "Invalid session." },
        401,
      );
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select(
        "user_id, discord_user_id, discord_username, discord_in_server, discord_verified, discord_last_checked_at, discord_verified_at",
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      return json({ ok: false, reason: "profile_lookup_failed", message: profileError.message }, 500);
    }

    const profileRow = profile as ProfileRow | null;
    if (!profileRow?.discord_user_id) {
      return json(
        {
          ok: false,
          reason: "discord_not_linked",
          invite_url: PUBLIC_DISCORD_INVITE_URL,
        },
        400,
      );
    }

    const nowIso = new Date().toISOString();
    const memberResponse = await discordApi(
      `/guilds/${DISCORD_GUILD_ID}/members/${profileRow.discord_user_id}`,
      { method: "GET" },
    );

    if (memberResponse.status === 404) {
      await syncProfileStatus(supabaseAdmin, user.id, {
        discord_in_server: false,
        discord_verified: false,
        discord_last_checked_at: nowIso,
        discord_verified_at: null,
      });

      return json({
        ok: true,
        linked: true,
        in_server: false,
        verified: false,
        invite_url: PUBLIC_DISCORD_INVITE_URL,
      });
    }

    if (!memberResponse.ok) {
      const message = await memberResponse.text();
      return json(
        {
          ok: false,
          reason: "discord_lookup_failed",
          message,
        },
        502,
      );
    }

    const member = (await memberResponse.json()) as DiscordGuildMember;
    const currentRoles = new Set(member.roles || []);

    if (DISCORD_VERIFIED_ROLE_ID && !currentRoles.has(DISCORD_VERIFIED_ROLE_ID)) {
      const addRoleResponse = await discordApi(
        `/guilds/${DISCORD_GUILD_ID}/members/${profileRow.discord_user_id}/roles/${DISCORD_VERIFIED_ROLE_ID}`,
        { method: "PUT" },
      );

      if (!addRoleResponse.ok) {
        const message = await addRoleResponse.text();
        return json(
          {
            ok: false,
            reason: "discord_role_assignment_failed",
            message,
          },
          502,
        );
      }
      currentRoles.add(DISCORD_VERIFIED_ROLE_ID);
    }

    if (DISCORD_UNVERIFIED_ROLE_ID && currentRoles.has(DISCORD_UNVERIFIED_ROLE_ID)) {
      const removeRoleResponse = await discordApi(
        `/guilds/${DISCORD_GUILD_ID}/members/${profileRow.discord_user_id}/roles/${DISCORD_UNVERIFIED_ROLE_ID}`,
        { method: "DELETE" },
      );

      if (!removeRoleResponse.ok) {
        const message = await removeRoleResponse.text();
        return json(
          {
            ok: false,
            reason: "discord_role_cleanup_failed",
            message,
          },
          502,
        );
      }
      currentRoles.delete(DISCORD_UNVERIFIED_ROLE_ID);
    }

    const resolvedUsername =
      member.user?.global_name?.trim() ||
      member.user?.username?.trim() ||
      profileRow.discord_username ||
      null;
    const isVerified = DISCORD_VERIFIED_ROLE_ID
      ? currentRoles.has(DISCORD_VERIFIED_ROLE_ID)
      : true;

    await syncProfileStatus(supabaseAdmin, user.id, {
      discord_username: resolvedUsername,
      discord_in_server: true,
      discord_verified: isVerified,
      discord_last_checked_at: nowIso,
      discord_verified_at: isVerified ? nowIso : null,
    });

    return json({
      ok: true,
      linked: true,
      in_server: true,
      verified: isVerified,
      discord_username: resolvedUsername,
      invite_url: PUBLIC_DISCORD_INVITE_URL,
      role_configured: !!DISCORD_VERIFIED_ROLE_ID,
    });
  } catch (error) {
    console.error("sync-discord-verification unhandled error", error);
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
