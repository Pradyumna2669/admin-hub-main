import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type TaskRow = {
  id: string;
  title: string | null;
  minimum_karma: number | null;
  cqs_levels: string[] | null;
  status: string | null;
};

type ProfileRow = {
  user_id: string;
  is_banned: boolean | null;
};

type RedditAccountRow = {
  id: string;
  user_id: string;
  karma: number | null;
  karma_range: string | null;
  cqs: string | null;
  is_verified: boolean | null;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type PushSubscriptionUserRow = Pick<PushSubscriptionRow, "user_id">;

const CQS_RANKS: Record<string, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  highest: 3,
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

const deriveApproxKarma = (karma?: number | null, karmaRange?: string | null) => {
  if (typeof karma === "number" && Number.isFinite(karma)) {
    return karma;
  }

  const value = karmaRange?.trim().toLowerCase() || "";
  if (!value) return 0;
  if (value.startsWith("100k")) return 100000;
  if (value.startsWith("50k")) return 50000;
  if (value.startsWith("25k")) return 25000;
  if (value.startsWith("5k")) return 5000;
  if (value.startsWith("1k")) return 1000;
  return 0;
};

const normalizeCqsLevel = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase() || "";
  if (!normalized || !(normalized in CQS_RANKS)) {
    return null;
  }

  return normalized;
};

const isAccountEligibleForTask = (task: TaskRow, account: RedditAccountRow) => {
  if (!account.is_verified) {
    return false;
  }

  if (task.status && task.status !== "pending") {
    return false;
  }

  const workerKarma = deriveApproxKarma(account.karma, account.karma_range);
  const minimumKarma =
    typeof task.minimum_karma === "number" && Number.isFinite(task.minimum_karma)
      ? task.minimum_karma
      : 0;

  if (workerKarma < minimumKarma) {
    return false;
  }

  const allowedCqs = Array.isArray(task.cqs_levels)
    ? task.cqs_levels.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (allowedCqs.length === 0) {
    return true;
  }

  const workerCqs = normalizeCqsLevel(account.cqs);
  if (!workerCqs) {
    return false;
  }

  const minimumRequiredRank = Math.min(
    ...allowedCqs
      .map((value) => normalizeCqsLevel(value))
      .filter((value): value is string => value !== null)
      .map((value) => CQS_RANKS[value])
  );

  return CQS_RANKS[workerCqs] >= minimumRequiredRank;
};

const matchesEligibility = (task: TaskRow, accounts: RedditAccountRow[] | null, isBanned: boolean) => {
  if (isBanned) {
    return false;
  }

  return (accounts || []).some((account) => isAccountEligibleForTask(task, account));
};

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

    const { data: role, error: roleErr } = await supabaseUser.rpc("get_user_role", {
      _user_id: user.id,
    });
    if (roleErr) {
      return json({ ok: false, reason: "role_lookup_failed", message: roleErr.message }, 403);
    }

    if (!["admin", "owner", "moderator"].includes(String(role || ""))) {
      return json({ ok: false, reason: "forbidden" }, 403);
    }

    let body: { task_ids?: string[] };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, reason: "invalid_json" }, 400);
    }

    const taskIds = Array.from(new Set((body.task_ids || []).filter((value): value is string => typeof value === "string" && value.length > 0)));
    if (taskIds.length === 0) {
      return json({ ok: true, sent: 0, skipped: 0 });
    }

    const supabaseAdmin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: tasks, error: tasksErr }, { data: subscriptionUsers, error: subsErr }] = await Promise.all([
      supabaseAdmin
        .from("tasks")
        .select("id, title, minimum_karma, cqs_levels, status")
        .in("id", taskIds),
      supabaseAdmin
        .from("push_subscriptions")
        .select("user_id"),
    ]);

    if (tasksErr) {
      return json({ ok: false, reason: "tasks_lookup_failed", message: tasksErr.message }, 500);
    }
    if (subsErr) {
      return json({ ok: false, reason: "subscriptions_lookup_failed", message: subsErr.message }, 500);
    }

    const userIds = Array.from(
      new Set(((subscriptionUsers || []) as PushSubscriptionUserRow[]).map((row) => row.user_id).filter(Boolean))
    );
    if (userIds.length === 0) {
      return json({ ok: true, sent: 0, skipped: 0 });
    }

    const [{ data: profiles, error: profilesErr }, { data: accounts, error: accountsErr }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("user_id, is_banned")
        .in("user_id", userIds),
      supabaseAdmin
        .from("reddit_accounts")
        .select("id, user_id, karma, karma_range, cqs, is_verified")
        .in("user_id", userIds),
    ]);

    if (profilesErr) {
      return json({ ok: false, reason: "profiles_lookup_failed", message: profilesErr.message }, 500);
    }
    if (accountsErr) {
      return json({ ok: false, reason: "accounts_lookup_failed", message: accountsErr.message }, 500);
    }

    const profileByUserId = new Map<string, ProfileRow>(
      (profiles || []).map((profile) => [profile.user_id, profile as ProfileRow])
    );

    const accountsByUserId = new Map<string, RedditAccountRow[]>();
    for (const account of (accounts || []) as RedditAccountRow[]) {
      const list = accountsByUserId.get(account.user_id) || [];
      list.push(account);
      accountsByUserId.set(account.user_id, list);
    }

    const tasksByUser = new Map<string, TaskRow[]>();

    for (const userId of userIds) {
      const profile = profileByUserId.get(userId) || null;
      const eligibleTasks = ((tasks || []) as TaskRow[]).filter((task) =>
        matchesEligibility(task, accountsByUserId.get(userId) || [], !!profile?.is_banned)
      );
      if (eligibleTasks.length > 0) {
        tasksByUser.set(userId, eligibleTasks);
      }
    }

    const recipientUserIds = Array.from(tasksByUser.keys());
    if (recipientUserIds.length === 0) {
      return json({ ok: true, sent: 0, skipped: userIds.length });
    }

    const { data: subscriptions, error: fullSubsErr } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", recipientUserIds);

    if (fullSubsErr) {
      return json({ ok: false, reason: "subscriptions_lookup_failed", message: fullSubsErr.message }, 500);
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const staleSubscriptionIds: string[] = [];
    let sent = 0;
    let skipped = Math.max(0, userIds.length - recipientUserIds.length);

    for (const subscription of (subscriptions || []) as PushSubscriptionRow[]) {
      const eligibleTasks = tasksByUser.get(subscription.user_id) || [];
      if (eligibleTasks.length === 0) {
        skipped += 1;
        continue;
      }

      const firstTask = eligibleTasks[0];
      const count = eligibleTasks.length;
      const payload = JSON.stringify({
        title: count === 1 ? "New task available" : `${count} new tasks available`,
        body:
          count === 1
            ? `${firstTask.title || "A new task"} is ready to claim.`
            : `${count} new tasks match your profile and are ready to claim.`,
        url: "/worker/tasks",
        taskIds: eligibleTasks.map((task) => task.id),
        tag: count === 1 ? `task-${firstTask.id}` : "worker-task-batch",
      });

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
        const statusCode = typeof error === "object" && error && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode)
          : null;

        if (statusCode === 404 || statusCode === 410) {
          staleSubscriptionIds.push(subscription.id);
        } else {
          console.error("Failed to send web push", {
            subscriptionId: subscription.id,
            error,
          });
        }
      }
    }

    if (staleSubscriptionIds.length > 0) {
      await supabaseAdmin.from("push_subscriptions").delete().in("id", staleSubscriptionIds);
    }

    return json({
      ok: true,
      sent,
      skipped,
      stale_removed: staleSubscriptionIds.length,
    });
  } catch (error) {
    console.error("send-task-push unhandled error", error);
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

