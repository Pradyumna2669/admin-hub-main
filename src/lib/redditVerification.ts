import { supabase } from '@/integrations/supabase/client';

export type N8nRedditProfile = {
  username?: string;
  profile_url?: string;
  avatar?: string | null;
  total_karma?: number;
  post_karma?: number;
  comment_karma?: number;
  account_created?: string | null;
  is_verified?: boolean;
  is_employee?: boolean;
  is_suspended?: boolean;
};

export type SaveRedditAccountInput = {
  redditUsername: string;
  karmaRange: string;
  cqs: string;
  cqsProof: string;
  cqsLink: string;
  discordUsername?: string;
  referralCode?: string | null;
  upiId?: string | null;
  screenshotPath?: string | null;
};

export type SaveRedditAccountResult = {
  is_verified: boolean;
};

export type RetryRedditAccountVerificationResult = {
  is_verified: boolean;
  auto_verify_attempts: number;
  verification_status: string;
};

export const normalizeRedditUsername = (value: string) => {
  const v = value.trim();
  return v.replace(/^\/?u\//i, '').replace(/^@/, '').trim();
};

export const parseRedditData = (value: unknown) => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  return value && typeof value === 'object' ? value : {};
};

export const fetchN8nRedditProfile = async (username: string) => {
  try {
    const { data, error } = await supabase.functions.invoke('reddit-profile', {
      body: { username },
    });

    if (error) {
      return {
        ok: false as const,
        error: error.message || 'n8n_proxy_error',
      };
    }

    const ok = !!(data as any)?.ok;
    if (!ok) {
      return {
        ok: false as const,
        error:
          (data as any)?.reason ||
          (data as any)?.error ||
          'n8n_unavailable',
      };
    }

    const profile = (data as any)?.profile;
    if (!profile || typeof profile !== 'object') {
      return { ok: false as const, error: 'n8n_invalid_json' };
    }

    return { ok: true as const, data: profile as N8nRedditProfile };
  } catch {
    return { ok: false as const, error: 'n8n_network_error' };
  }
};

export const isAutoVerifiedRedditProfile = (profile: N8nRedditProfile | null) =>
  !!profile?.profile_url &&
  !!profile?.is_verified &&
  typeof profile?.total_karma === 'number' &&
  !profile?.is_suspended;

type EdgeFunctionResponse = {
  ok?: boolean;
  reason?: string;
  message?: string;
  is_verified?: boolean;
  auto_verify_attempts?: number;
  verification_status?: string;
};

const invokeAuthedEdgeFunction = async <TBody extends Record<string, unknown>>(
  functionName: string,
  body: TBody
) => {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    throw new Error('Your session expired. Please sign in again.');
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    }
  );

  const payload = (await response.json().catch(() => null)) as EdgeFunctionResponse | null;

  if (!response.ok) {
    throw new Error(
      payload?.message ||
        payload?.reason ||
        `Request failed with status ${response.status}.`
    );
  }

  if (!payload?.ok) {
    throw new Error(payload?.message || payload?.reason || 'Request failed.');
  }

  return payload;
};

export const saveRedditAccount = async (input: SaveRedditAccountInput) => {
  const payload = await invokeAuthedEdgeFunction('save-reddit-account', input);

  return {
    is_verified: !!payload.is_verified,
  } satisfies SaveRedditAccountResult;
};

export const retryRedditAccountVerification = async (accountId: string) => {
  const payload = await invokeAuthedEdgeFunction('retry-reddit-account-verification', {
    account_id: accountId,
  });

  return {
    is_verified: !!payload.is_verified,
    auto_verify_attempts: Number(payload.auto_verify_attempts || 0),
    verification_status: payload.verification_status || 'pending_manual_verification',
  } satisfies RetryRedditAccountVerificationResult;
};
