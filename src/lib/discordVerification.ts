import { supabase } from '@/integrations/supabase/client';
import { getAuthRedirectUrl } from '@/lib/authRedirect';

export type DiscordVerificationStatus = {
  discord_user_id: string | null;
  discord_username: string | null;
  discord_in_server: boolean | null;
  discord_verified: boolean | null;
  discord_last_checked_at: string | null;
  discord_verified_at: string | null;
};

export type DiscordVerificationSyncResult = {
  ok: boolean;
  linked: boolean;
  in_server: boolean;
  verified: boolean;
  discord_username?: string | null;
  invite_url?: string;
  role_configured?: boolean;
};

type DiscordVerificationErrorBody = {
  ok?: boolean;
  reason?: string;
  message?: string;
  invite_url?: string;
  missing?: string[];
};

const normalizeDiscordLinkError = (error: unknown) => {
  const rawMessage = error instanceof Error ? error.message : String(error || 'Discord linking failed.');
  const normalized = rawMessage.trim().toLowerCase();

  if (normalized.includes('manual linking is disabled')) {
    return new Error(
      'Discord linking is disabled in Supabase Auth for this project. Enable Manual Linking in Supabase Authentication settings so email/password users can connect Discord accounts.',
    );
  }

  if (normalized.includes('identity is already linked') || normalized.includes('already linked to another user')) {
    return new Error('This Discord account is already linked to another website account.');
  }

  return error instanceof Error ? error : new Error(rawMessage);
};

const normalizeDiscordVerificationError = (payload: DiscordVerificationErrorBody | null, status: number) => {
  const reason = (payload?.reason || '').trim().toLowerCase();
  const message = (payload?.message || '').trim();

  if (reason === 'discord_not_linked') {
    return new Error('Connect your Discord account to the website first, then try verification again.');
  }

  if (reason === 'discord_not_configured') {
    const missing = Array.isArray(payload?.missing)
      ? payload?.missing.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];

    if (missing.length > 0) {
      return new Error(
        `Discord verification is not configured on the server yet. Missing: ${missing.join(', ')}. Add these as Supabase Edge Function secrets and redeploy the function.`,
      );
    }

    return new Error('Discord verification is not configured on the server yet. Add DISCORD_BOT_TOKEN and DISCORD_GUILD_ID to the Supabase Edge Function secrets.');
  }

  if (reason === 'unauthorized') {
    return new Error(message || 'Your session expired. Please sign in again.');
  }

  if (reason === 'discord_lookup_failed') {
    return new Error(message || 'Discord server lookup failed. Check the bot token and guild configuration.');
  }

  if (reason === 'discord_role_assignment_failed') {
    return new Error(message || 'Discord role assignment failed. Check bot permissions and role hierarchy.');
  }

  if (reason === 'discord_role_cleanup_failed') {
    return new Error(message || 'Discord role cleanup failed. Check bot permissions and role hierarchy.');
  }

  return new Error(message || `Discord verification failed (${status}).`);
};

export const getDiscordAuthCallbackError = (search: string) => {
  const params = new URLSearchParams(search);
  const error = (params.get('error') || '').trim().toLowerCase();
  const errorCode = (params.get('error_code') || '').trim().toLowerCase();
  const errorDescription = (params.get('error_description') || '').trim();

  if (!error && !errorCode && !errorDescription) {
    return null;
  }

  if (errorCode === 'identity_already_exists') {
    return new Error('This Discord account is already linked to another website account.');
  }

  if (errorCode === 'identity_not_found') {
    return new Error('Discord identity linking could not be completed. Please try again.');
  }

  if (errorCode === 'provider_email_needs_verification') {
    return new Error('Verify your email account first, then connect Discord again.');
  }

  if (error === 'access_denied') {
    return new Error('Discord authorization was cancelled or denied.');
  }

  if (errorDescription) {
    return normalizeDiscordLinkError(new Error(errorDescription));
  }

  if (errorCode) {
    return new Error(`Discord linking failed: ${errorCode.replace(/_/g, ' ')}.`);
  }

  return new Error('Discord linking failed. Please try again.');
};

export async function startDiscordIdentityLink(redirectPath: string) {
  const { error } = await supabase.auth.linkIdentity({
    provider: 'discord',
    options: {
      redirectTo: getAuthRedirectUrl(redirectPath),
    },
  });

  if (error) {
    throw normalizeDiscordLinkError(error);
  }
}

export async function syncDiscordVerification() {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    throw new Error('Missing auth session.');
  }

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-discord-verification`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: '{}',
  });

  const payload = (await response.json().catch(() => null)) as DiscordVerificationSyncResult | DiscordVerificationErrorBody | null;

  if (!response.ok) {
    throw normalizeDiscordVerificationError(payload as DiscordVerificationErrorBody | null, response.status);
  }

  return (payload || null) as DiscordVerificationSyncResult | null;
}
