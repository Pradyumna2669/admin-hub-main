import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const STAFF_UUID = "00000000-0000-0000-0000-000000000001";

type ChatScope = "group" | "direct";

type GroupMessageRow = {
  id: string;
  room: string;
  sender_id: string;
  content: string;
  created_at: string;
};

type DirectMessageRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
};

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  reddit_username: string | null;
  email: string | null;
};

type UserRoleRow = {
  user_id: string;
  role: string | null;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type PushSubscriptionUserRow = Pick<PushSubscriptionRow, "user_id">;

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

const usernameFromProfile = (p: ProfileRow | null) => {
  const raw =
    p?.reddit_username?.trim() ||
    p?.full_name?.trim()?.replace(/\s+/g, "") ||
    p?.email?.split("@")[0] ||
    "user";
  return raw.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
};

const displayNameFromProfile = (p: ProfileRow | null) =>
  p?.full_name?.trim() || p?.reddit_username?.trim() || p?.email?.split("@")[0] || "Someone";

const buildPreviewText = (content: string) => {
  const text = content || "";
  const gifMarker = "[gif]";
  const lines = text.split("\n");
  const textLines: string[] = [];
  let hasGif = false;

  for (const line of lines) {
    if (line.startsWith(gifMarker)) {
      hasGif = true;
      continue;
    }
    textLines.push(line);
  }

  const base = textLines.join("\n").trim() || (hasGif ? "GIF" : "");
  return base.length > 120 ? `${base.slice(0, 120)}...` : base;
};

const parseAdminPrefix = (content: string) => {
  const match = content.match(/^\[(.*?)\]\s+/);
  if (!match) return { senderName: null, stripped: content };
  return { senderName: match[1]?.trim() || null, stripped: content.replace(/^\[.*?\]\s+/, "") };
};

const hasStaffRole = (roles: Set<string>) =>
  roles.has("owner") || roles.has("admin") || roles.has("moderator");

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

    let body: { message_id?: string; scope?: ChatScope };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, reason: "invalid_json" }, 400);
    }

    const messageId = typeof body.message_id === "string" ? body.message_id.trim() : "";
    const scope = body.scope === "group" || body.scope === "direct" ? body.scope : null;
    if (!messageId || !scope) {
      return json({ ok: false, reason: "invalid_request" }, 400);
    }

    const supabaseAdmin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    if (scope === "group") {
      const { data: message, error: messageErr } = await supabaseAdmin
        .from("group_messages")
        .select("id, room, sender_id, content, created_at")
        .eq("id", messageId)
        .maybeSingle();

      if (messageErr) {
        return json({ ok: false, reason: "message_lookup_failed", message: messageErr.message }, 500);
      }

      const groupMessage = message as GroupMessageRow | null;
      if (!groupMessage) {
        return json({ ok: false, reason: "message_not_found" }, 404);
      }

      if (groupMessage.sender_id !== user.id) {
        return json({ ok: false, reason: "forbidden" }, 403);
      }

      const { data: subscriptionUsers, error: subsErr } = await supabaseAdmin
        .from("push_subscriptions")
        .select("user_id");

      if (subsErr) {
        return json({ ok: false, reason: "subscriptions_lookup_failed", message: subsErr.message }, 500);
      }

      const candidateUserIds = Array.from(
        new Set(((subscriptionUsers || []) as PushSubscriptionUserRow[]).map((row) => row.user_id).filter(Boolean))
      );
      if (candidateUserIds.length === 0) {
        return json({ ok: true, sent: 0, skipped: 0 });
      }

      const [{ data: profiles, error: profilesErr }, { data: roles, error: rolesErr }] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("user_id, full_name, reddit_username, email")
          .in("user_id", candidateUserIds),
        supabaseAdmin
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", candidateUserIds),
      ]);

      if (profilesErr) {
        return json({ ok: false, reason: "profiles_lookup_failed", message: profilesErr.message }, 500);
      }
      if (rolesErr) {
        return json({ ok: false, reason: "roles_lookup_failed", message: rolesErr.message }, 500);
      }

      const profileByUserId = new Map<string, ProfileRow>(
        (profiles || []).map((profile) => [profile.user_id, profile as ProfileRow])
      );

      const rolesByUserId = new Map<string, Set<string>>();
      for (const row of (roles || []) as UserRoleRow[]) {
        if (!row.user_id) continue;
        const existing = rolesByUserId.get(row.user_id) || new Set<string>();
        if (row.role) existing.add(String(row.role));
        rolesByUserId.set(row.user_id, existing);
      }

      const contentLower = (groupMessage.content || "").toLowerCase();
      const mentionMatches = contentLower.match(/@([a-z0-9_]+)/g) || [];
      const mentionUsernames = new Set(mentionMatches.map((m) => m.slice(1)));
      const senderRoles = rolesByUserId.get(groupMessage.sender_id) || new Set<string>();

      const recipients = new Set<string>();

      if (mentionUsernames.has("everyone") && hasStaffRole(senderRoles)) {
        for (const userId of candidateUserIds) {
          recipients.add(userId);
        }
      } else {
        const usernameToUserId = new Map<string, string>();
        for (const [userId, profile] of profileByUserId.entries()) {
          usernameToUserId.set(usernameFromProfile(profile), userId);
        }

        for (const mention of mentionUsernames) {
          if (mention === "admin") {
            for (const [userId, rolesSet] of rolesByUserId.entries()) {
              if (rolesSet.has("admin") || rolesSet.has("owner") || rolesSet.has("moderator")) {
                recipients.add(userId);
              }
            }
            continue;
          }
          if (mention === "owner") {
            for (const [userId, rolesSet] of rolesByUserId.entries()) {
              if (rolesSet.has("owner")) {
                recipients.add(userId);
              }
            }
            continue;
          }

          const targetUserId = usernameToUserId.get(mention);
          if (targetUserId) {
            recipients.add(targetUserId);
          }
        }
      }

      recipients.delete(groupMessage.sender_id);

      if (recipients.size === 0) {
        return json({ ok: true, sent: 0, skipped: candidateUserIds.length });
      }

      const recipientUserIds = Array.from(recipients);
      const { data: subscriptions, error: fullSubsErr } = await supabaseAdmin
        .from("push_subscriptions")
        .select("id, user_id, endpoint, p256dh, auth")
        .in("user_id", recipientUserIds);

      if (fullSubsErr) {
        return json({ ok: false, reason: "subscriptions_lookup_failed", message: fullSubsErr.message }, 500);
      }

      let senderProfile = profileByUserId.get(groupMessage.sender_id) || null;
      if (!senderProfile) {
        const { data: senderProfileRow, error: senderProfileErr } = await supabaseAdmin
          .from("profiles")
          .select("user_id, full_name, reddit_username, email")
          .eq("user_id", groupMessage.sender_id)
          .maybeSingle();

        if (senderProfileErr) {
          return json({ ok: false, reason: "profiles_lookup_failed", message: senderProfileErr.message }, 500);
        }

        senderProfile = (senderProfileRow as ProfileRow | null) || null;
      }

      const senderName = displayNameFromProfile(senderProfile);
      const preview = buildPreviewText(groupMessage.content);
      const room = groupMessage.room || "general";
      const urlPath = room === "general" ? "/chat/general" : "/chat/general";

      const payload = JSON.stringify({
        kind: "chat",
        title: `${senderName} in #${room}`,
        body: preview || "New message",
        url: `${urlPath}#chat-message-${groupMessage.id}`,
        tag: `group-${groupMessage.id}`,
        messageId: groupMessage.id,
        room,
      });

      const staleSubscriptionIds: string[] = [];
      let sent = 0;
      let skipped = Math.max(0, candidateUserIds.length - recipientUserIds.length);

      for (const subscription of (subscriptions || []) as PushSubscriptionRow[]) {
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
          const statusCode =
            typeof error === "object" && error && "statusCode" in error
              ? Number((error as { statusCode?: number }).statusCode)
              : null;

          if (statusCode === 404 || statusCode === 410) {
            staleSubscriptionIds.push(subscription.id);
          } else {
            console.error("Failed to send group chat web push", {
              subscriptionId: subscription.id,
              error,
            });
          }
        }
      }

      if (staleSubscriptionIds.length > 0) {
        await supabaseAdmin.from("push_subscriptions").delete().in("id", staleSubscriptionIds);
      }

      return json({ ok: true, sent, skipped, stale_removed: staleSubscriptionIds.length });
    }

    const { data: message, error: messageErr } = await supabaseAdmin
      .from("messages")
      .select("id, sender_id, receiver_id, content, created_at")
      .eq("id", messageId)
      .maybeSingle();

    if (messageErr) {
      return json({ ok: false, reason: "message_lookup_failed", message: messageErr.message }, 500);
    }

    const directMessage = message as DirectMessageRow | null;
    if (!directMessage) {
      return json({ ok: false, reason: "message_not_found" }, 404);
    }

    const { data: roleRes, error: roleErr } = await supabaseAdmin.rpc("get_user_role", {
      _user_id: user.id,
    });
    if (roleErr) {
      return json({ ok: false, reason: "role_lookup_failed", message: roleErr.message }, 403);
    }

    const callerRole = String(roleRes || "");
    const callerIsStaff = ["admin", "owner", "moderator"].includes(callerRole);

    const senderMatches = directMessage.sender_id === user.id;
    const isStaffSender =
      directMessage.sender_id === STAFF_UUID && callerIsStaff;

    if (!senderMatches && !isStaffSender) {
      return json({ ok: false, reason: "forbidden" }, 403);
    }

    let recipientIds: string[] = [];
    if (directMessage.receiver_id === STAFF_UUID) {
      const { data: staffRows, error: staffErr } = await supabaseAdmin
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["admin", "owner", "moderator"]);

      if (staffErr) {
        return json({ ok: false, reason: "roles_lookup_failed", message: staffErr.message }, 500);
      }

      recipientIds = Array.from(
        new Set((staffRows || []).map((row: UserRoleRow) => row.user_id).filter(Boolean))
      );
    } else {
      recipientIds = [directMessage.receiver_id];
    }

    recipientIds = recipientIds.filter((id) => id && id !== directMessage.sender_id);

    if (recipientIds.length === 0) {
      return json({ ok: true, sent: 0, skipped: 0 });
    }

    const { data: subscriptions, error: subsErr } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", recipientIds);

    if (subsErr) {
      return json({ ok: false, reason: "subscriptions_lookup_failed", message: subsErr.message }, 500);
    }

    const subscriptionRows = (subscriptions || []) as PushSubscriptionRow[];
    if (subscriptionRows.length === 0) {
      return json({ ok: true, sent: 0, skipped: 0 });
    }

    const { data: senderProfileRow, error: senderProfileErr } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name, reddit_username, email")
      .eq("user_id", directMessage.sender_id)
      .maybeSingle();

    if (senderProfileErr) {
      return json({ ok: false, reason: "profiles_lookup_failed", message: senderProfileErr.message }, 500);
    }

    let senderName = displayNameFromProfile(senderProfileRow as ProfileRow | null);
    let previewContent = directMessage.content;

    if (directMessage.sender_id === STAFF_UUID) {
      const parsed = parseAdminPrefix(directMessage.content);
      if (parsed.senderName) {
        senderName = parsed.senderName;
        previewContent = parsed.stripped;
      }
    }

    const preview = buildPreviewText(previewContent);
    const urlPath =
      directMessage.receiver_id === STAFF_UUID ? "/admin/chat" : "/worker/chat";

    const payload = JSON.stringify({
      kind: "chat",
      title: `New message from ${senderName}`,
      body: preview || "New message",
      url: urlPath,
      tag: `direct-${directMessage.id}`,
      messageId: directMessage.id,
    });

    const staleSubscriptionIds: string[] = [];
    let sent = 0;
    let skipped = 0;

    for (const subscription of subscriptionRows) {
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
        const statusCode =
          typeof error === "object" && error && "statusCode" in error
            ? Number((error as { statusCode?: number }).statusCode)
            : null;

        if (statusCode === 404 || statusCode === 410) {
          staleSubscriptionIds.push(subscription.id);
        } else {
          console.error("Failed to send direct chat web push", {
            subscriptionId: subscription.id,
            error,
          });
        }
      }
    }

    if (staleSubscriptionIds.length > 0) {
      await supabaseAdmin.from("push_subscriptions").delete().in("id", staleSubscriptionIds);
    }

    return json({ ok: true, sent, skipped, stale_removed: staleSubscriptionIds.length });
  } catch (error) {
    console.error("send-chat-push unhandled error", error);
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

