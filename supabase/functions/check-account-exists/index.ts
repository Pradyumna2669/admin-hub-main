import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type AdminUserIdentity = {
  provider?: string | null;
};

type AdminUser = {
  email?: string | null;
  app_metadata?: { provider?: string | null } | null;
  user_metadata?: { provider?: string | null } | null;
  identities?: AdminUserIdentity[] | null;
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

const normalizeProvider = (value: string | null | undefined) => {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
};

const inferProviderFromAdminUser = (user: AdminUser | null | undefined) => {
  if (!user) return null;

  const identities = Array.isArray(user.identities) ? user.identities : [];
  const nonEmailProvider = identities
    .map((identity) => normalizeProvider(identity?.provider))
    .find((provider) => provider && provider !== "email");

  return (
    nonEmailProvider ||
    identities
      .map((identity) => normalizeProvider(identity?.provider))
      .find(Boolean) ||
    normalizeProvider(user.app_metadata?.provider) ||
    normalizeProvider(user.user_metadata?.provider) ||
    "email"
  );
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return json({ ok: true }, 200);
  }

  if (req.method !== "POST") {
    return json({ ok: false, reason: "method_not_allowed" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, reason: "server_not_configured" }, 500);
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email) {
    return json({ ok: false, reason: "missing_email" }, 400);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id, email, auth_provider")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (error) {
    return json({ ok: false, reason: "lookup_failed", message: error.message }, 500);
  }

  if (data?.user_id) {
    return json({
      ok: true,
      exists: true,
      auth_provider: normalizeProvider(data.auth_provider) || "email",
    });
  }

  let page = 1;
  const perPage = 200;

  while (true) {
    const { data: usersPage, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (usersError) {
      return json({ ok: false, reason: "auth_lookup_failed", message: usersError.message }, 500);
    }

    const users = Array.isArray(usersPage?.users) ? (usersPage.users as AdminUser[]) : [];
    const matchingUser = users.find(
      (user) => typeof user.email === "string" && user.email.trim().toLowerCase() === email,
    );

    if (matchingUser) {
      return json({
        ok: true,
        exists: true,
        auth_provider: inferProviderFromAdminUser(matchingUser),
      });
    }

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return json({
    ok: true,
    exists: false,
    auth_provider: null,
  });
});

