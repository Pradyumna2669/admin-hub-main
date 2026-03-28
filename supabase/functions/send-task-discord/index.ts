import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type TaskRow = {
  id: string;
  title: string | null;
  task_type: string | null;
  subreddit_flair: string | null;
  minimum_karma: number | null;
  cqs_levels: string[] | null;
  created_at: string | null;
  discord_message_id: string | null;
};

type AssignmentRow = {
  id: string;
  task_id: string;
  user_id: string;
  created_at: string | null;
  submitted_at?: string | null;
  status?: string | null;
  payment_status?: string | null;
  is_removal?: boolean | null;
  discord_claim_notified_at: string | null;
  tasks?: TaskRow | null;
  profiles?: {
    full_name?: string | null;
    email?: string | null;
    reddit_username?: string | null;
    reddit_data?: unknown;
  } | null;
};

type UserRole = "owner" | "admin" | "moderator" | "client" | "worker" | null;

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeWebhookUrl = (value: string) => {
  const trimmed = value.trim();
  const withoutQuery = trimmed.split("?")[0];
  return withoutQuery.replace(/\/$/, "");
};

const displayNameFromProfile = (profile: AssignmentRow["profiles"]) => {
  const emailPrefix = profile?.email?.split("@")[0];
  return (
    profile?.full_name?.trim() ||
    profile?.reddit_username?.trim() ||
    emailPrefix ||
    "Someone"
  );
};

const discordUsernameFromProfile = (profile: AssignmentRow["profiles"]) => {
  const data = profile?.reddit_data;
  if (!data) return null;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      return typeof parsed?.discordUsername === "string"
        ? parsed.discordUsername
        : null;
    } catch {
      return null;
    }
  }
  if (typeof data === "object" && data && "discordUsername" in data) {
    const value = (data as { discordUsername?: unknown }).discordUsername;
    return typeof value === "string" ? value : null;
  }
  return null;
};

const buildTaskEmbed = (task: TaskRow, taskUrl: string) => {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Task ID", value: task.id, inline: true },
  ];

  if (task.task_type) {
    fields.push({ name: "Type", value: task.task_type.replace(/_/g, " "), inline: true });
  }

  if (task.subreddit_flair) {
    fields.push({ name: "Subreddit", value: `r/${task.subreddit_flair}`, inline: true });
  }

  if (typeof task.minimum_karma === "number" && task.minimum_karma > 0) {
    fields.push({ name: "Minimum Karma", value: String(task.minimum_karma), inline: true });
  }

  if (Array.isArray(task.cqs_levels) && task.cqs_levels.length > 0) {
    fields.push({ name: "CQS", value: task.cqs_levels.join(", "), inline: true });
  }

  fields.push({ name: "Claim Link", value: taskUrl, inline: false });

  return {
    title: task.title || "New task",
    url: taskUrl,
    color: 0x2563eb,
    fields,
    timestamp: task.created_at || undefined,
  };
};

const buildStatusLabel = (assignment: AssignmentRow) => {
  const status = (assignment.status || '').toLowerCase();
  const payment = (assignment.payment_status || '').toLowerCase();
  if (status === 'cancelled') {
    return assignment.is_removal ? 'Rejected' : 'Cancelled';
  }
  if (status === 'submitted') {
    return 'Submitted (Manual Review)';
  }
  if (status === 'completed') {
    return payment === 'paid' ? 'Paid' : 'Approved (Payment Pending)';
  }
  if (status === 'in_progress') {
    return 'Claimed';
  }
  return status ? status.replace(/_/g, ' ') : 'Pending';
};

const buildStatusEmbed = (
  task: TaskRow,
  taskUrl: string,
  assignment: AssignmentRow,
  claimedBy: string,
  claimedAt: string | null
) => {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Task ID", value: task.id, inline: true },
    { name: "Status", value: buildStatusLabel(assignment), inline: true },
    { name: "Claimed By", value: claimedBy, inline: true },
  ];

  if (claimedAt) {
    fields.push({ name: "Claimed At", value: claimedAt, inline: true });
  }

  if (assignment.submitted_at) {
    fields.push({ name: "Submitted At", value: assignment.submitted_at, inline: true });
  }

  if (assignment.payment_status) {
    fields.push({ name: "Payment", value: assignment.payment_status, inline: true });
  }

  fields.push({ name: "Task Link", value: taskUrl, inline: false });

  return {
    title: task.title || "Task update",
    url: taskUrl,
    color: 0x2563eb,
    fields,
  };
};

const sendDiscordRequest = async (url: string, payload: unknown, method = "POST") => {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (response.status === 429) {
    const retry = await response.json().catch(() => null);
    const retryAfterMs =
      typeof retry?.retry_after === "number" ? Math.ceil(retry.retry_after * 1000) : 1000;
    await sleep(retryAfterMs);
    return sendDiscordRequest(url, payload, method);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord request failed (${response.status}): ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json().catch(() => null);
};

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200);
    if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const webhookRaw = Deno.env.get("DISCORD_WEBHOOK_URL");
    const baseUrl =
      Deno.env.get("PUBLIC_SITE_URL") ||
      Deno.env.get("SITE_URL") ||
      Deno.env.get("SUPABASE_PUBLIC_URL") ||
      "";

    if (!url || !serviceRoleKey) {
      return json({ ok: false, reason: "server_not_configured" }, 500);
    }

    if (!webhookRaw) {
      return json({ ok: false, reason: "discord_not_configured" }, 500);
    }
    if (!baseUrl) {
      return json({ ok: false, reason: "site_url_not_configured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    console.log("send-task-discord request", {
      hasAuth: !!authHeader,
      authLength: authHeader ? authHeader.length : 0,
      event: req.method,
    });
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
      console.error("send-task-discord auth failed", {
        message: userErr?.message || "Invalid session.",
      });
      return json(
        { ok: false, reason: "unauthorized", message: userErr?.message || "Invalid session." },
        401
      );
    }

    let body: { event?: string; task_ids?: string[]; assignment_id?: string; force?: boolean };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, reason: "invalid_json" }, 400);
    }

    const event =
      body.event === "created" || body.event === "claimed" || body.event === "status"
        ? body.event
        : null;
    if (!event) {
      return json({ ok: false, reason: "invalid_event" }, 400);
    }

    const supabaseAdmin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const webhookUrl = normalizeWebhookUrl(webhookRaw);
    const webhookWaitUrl = `${webhookUrl}?wait=true`;

    if (event === "created") {
      const { data: role, error: roleErr } = await supabaseAdmin.rpc("get_user_role", {
        _user_id: user.id,
      });
      if (roleErr) {
        return json({ ok: false, reason: "role_lookup_failed", message: roleErr.message }, 403);
      }

      const roleValue = String(role || "") as UserRole;
      if (!["admin", "owner", "moderator"].includes(roleValue)) {
        return json({ ok: false, reason: "forbidden" }, 403);
      }

      const taskIds = Array.from(
        new Set((body.task_ids || []).filter((value): value is string => typeof value === "string" && value.length > 0))
      );
      if (taskIds.length === 0) {
        return json({ ok: true, sent: 0, skipped: 0 });
      }

      const { data: tasks, error: tasksErr } = await supabaseAdmin
        .from("tasks")
        .select("id, title, task_type, subreddit_flair, minimum_karma, cqs_levels, created_at, discord_message_id")
        .in("id", taskIds);

      if (tasksErr) {
        return json({ ok: false, reason: "tasks_lookup_failed", message: tasksErr.message }, 500);
      }

      let sent = 0;
      let skipped = 0;

      for (const task of (tasks || []) as TaskRow[]) {
        if (!task) continue;
        if (task.discord_message_id) {
          skipped += 1;
          continue;
        }
        const taskUrl = `${baseUrl.replace(/\/$/, "")}/worker/task/${task.id}`;
        const payload = {
          content: "New task available",
          embeds: [buildTaskEmbed(task, taskUrl)],
        };

        try {
          const message = await sendDiscordRequest(webhookWaitUrl, payload, "POST");
          const messageId = message && typeof message.id === "string" ? message.id : null;
          if (messageId) {
            await supabaseAdmin
              .from("tasks")
              .update({ discord_message_id: messageId })
              .eq("id", task.id);
          }
          sent += 1;
        } catch (error) {
          console.error("Failed to send Discord task message", { taskId: task.id, error });
          skipped += 1;
        }
      }

      return json({ ok: true, sent, skipped });
    }

    const assignmentId =
      typeof body.assignment_id === "string" ? body.assignment_id.trim() : "";
    if (!assignmentId) {
      return json({ ok: false, reason: "invalid_request" }, 400);
    }

    const { data: assignment, error: assignmentErr } = await supabaseAdmin
      .from("task_assignments")
      .select("id, task_id, user_id, created_at, submitted_at, status, payment_status, is_removal, discord_claim_notified_at, tasks(id, title, discord_message_id), profiles:user_id(full_name, email, reddit_username, reddit_data)")
      .eq("id", assignmentId)
      .maybeSingle();

    if (assignmentErr) {
      return json({ ok: false, reason: "assignment_lookup_failed", message: assignmentErr.message }, 500);
    }

    const assignmentRow = assignment as AssignmentRow | null;
    if (!assignmentRow) {
      return json({ ok: false, reason: "assignment_not_found" }, 404);
    }

    const { data: role, error: roleErr } = await supabaseAdmin.rpc("get_user_role", {
      _user_id: user.id,
    });
    if (roleErr) {
      return json({ ok: false, reason: "role_lookup_failed", message: roleErr.message }, 403);
    }
    const roleValue = String(role || "") as UserRole;
    const isStaff = ["admin", "owner", "moderator"].includes(roleValue);

    if (!isStaff && assignmentRow.user_id !== user.id) {
      return json({ ok: false, reason: "forbidden" }, 403);
    }

    const force = body.force === true;
    if (event === "claimed" && assignmentRow.discord_claim_notified_at && !force) {
      return json({ ok: true, sent: 0, skipped: 1, reason: "already_notified" });
    }

    const task = assignmentRow.tasks;
    if (!task) {
      return json({ ok: false, reason: "task_not_found" }, 404);
    }

    const taskUrl = `${baseUrl.replace(/\/$/, "")}/worker/task/${task.id}`;
    const displayName = displayNameFromProfile(assignmentRow.profiles);
    const discordUsername = discordUsernameFromProfile(assignmentRow.profiles);
    const claimedBy = discordUsername ? `${displayName} (Discord: ${discordUsername})` : displayName;
    const claimedAt = assignmentRow.created_at
      ? new Date(assignmentRow.created_at).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC"
      : null;

    try {
      if (!task.discord_message_id) {
        return json({ ok: true, sent: 0, skipped: 1, reason: "missing_message_id" });
      }

      const updatePayload = {
        content: "Task update",
        embeds: [buildStatusEmbed(task, taskUrl, assignmentRow, claimedBy, claimedAt)],
      };
      await sendDiscordRequest(
        `${webhookUrl}/messages/${task.discord_message_id}`,
        updatePayload,
        "PATCH"
      );

      if (event === "claimed") {
        await supabaseAdmin
          .from("task_assignments")
          .update({ discord_claim_notified_at: new Date().toISOString() })
          .eq("id", assignmentRow.id);
      }

      return json({ ok: true, sent: 1, skipped: 0 });
    } catch (error) {
      console.error("Failed to send Discord claim message", { assignmentId, error });
      return json({ ok: false, reason: "discord_failed" }, 500);
    }
  } catch (error) {
    console.error("send-task-discord unhandled error", error);
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
