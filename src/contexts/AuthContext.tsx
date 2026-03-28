import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { getAuthRedirectUrl } from '@/lib/authRedirect';

type UserRole = 'owner' | 'admin' | 'moderator' | 'client' | 'worker' | null;
type SessionExpiryReason = 'expired' | 'other-device' | null;

const ROLE_PRIORITY: Record<Exclude<UserRole, null>, number> = {
  owner: 5,
  admin: 4,
  moderator: 3,
  worker: 2,
  client: 1,
};

interface WorkerProfileFields {
  redditId: string;
  referredBy?: string;
  discordUsername?: string;
  karma: string;
  timezone: string;
  paymentReady: string;
  cqsLink: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  userRole: UserRole;
  isBanned: boolean;
  banReason: string | null;
  sessionExpired: boolean;
  sessionExpiryReason: SessionExpiryReason;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    fullName?: string,
    role?: 'client' | 'worker',
    workerFields?: WorkerProfileFields,
    screenshotFile?: File | null,
    referralCode?: string | null
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SINGLE_DEVICE_CHECK_INTERVAL_MS = 30_000;

const decodeJwtPayload = (token: string) => {
  try {
    const [, rawPayload] = token.split('.');
    if (!rawPayload) return null;

    const base64 = rawPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4 || 4)) % 4);
    const payload = atob(padded);
    return JSON.parse(payload) as Record<string, unknown>;
  } catch (error) {
    console.error('Failed to decode session token payload:', error);
    return null;
  }
};

const getSessionMetadata = (activeSession: Session | null) => {
  if (!activeSession?.access_token) {
    return { sessionId: null, issuedAt: null };
  }

  const payload = decodeJwtPayload(activeSession.access_token);
  const sessionId = typeof payload?.session_id === 'string' ? payload.session_id : null;
  const issuedAt = typeof payload?.iat === 'number' ? payload.iat : null;

  return { sessionId, issuedAt };
};

const getCurrentDeviceLabel = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'Unknown device';
  }

  const platform = navigator.userAgentData?.platform || navigator.platform || 'Unknown platform';
  const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const formFactor = isMobile ? 'Mobile' : 'Desktop';
  return `${platform} ${formFactor}`;
};

const normalizeUserRole = (value: unknown): UserRole => {
  return value === 'owner' ||
    value === 'admin' ||
    value === 'moderator' ||
    value === 'client' ||
    value === 'worker'
    ? value
    : null;
};

const pickHighestPriorityRole = (values: unknown[]): UserRole => {
  let bestRole: UserRole = null;

  values.forEach((value) => {
    const normalizedRole = normalizeUserRole(value);
    if (!normalizedRole) return;

    if (!bestRole || ROLE_PRIORITY[normalizedRole] > ROLE_PRIORITY[bestRole]) {
      bestRole = normalizedRole;
    }
  });

  return bestRole;
};


const inferAuthProvider = (user: User | null) => {
  if (!user) return 'email';

  const identities = Array.isArray((user as any).identities) ? (user as any).identities : [];
  const nonEmailProvider = identities
    .map((identity: any) => (typeof identity?.provider === 'string' ? identity.provider.trim().toLowerCase() : null))
    .find((provider: string | null) => !!provider && provider !== 'email');

  return (
    nonEmailProvider ||
    (typeof (user as any)?.app_metadata?.provider === 'string'
      ? (user as any).app_metadata.provider.trim().toLowerCase()
      : null) ||
    (typeof (user as any)?.user_metadata?.provider === 'string'
      ? (user as any).user_metadata.provider.trim().toLowerCase()
      : null) ||
    'email'
  );
};

const normalizeDuplicateSignUpMessage = (message: string, authProvider?: string | null) => {
  const normalized = (message || '').trim().toLowerCase();
  const looksLikeDuplicate =
    normalized.includes('already registered') ||
    normalized.includes('already exists') ||
    normalized.includes('user already registered') ||
    normalized.includes('identity already exists') ||
    normalized.includes('duplicate key value') ||
    normalized.includes('error creating identity');

  if (!looksLikeDuplicate) {
    return null;
  }

  if (authProvider && authProvider !== 'email') {
    return `An account already exists for this email. Sign in using ${authProvider} or use Forgot Password if you previously set an email password.`;
  }

  if (normalized.includes('error creating identity')) {
    return 'This email is already linked to an account or identity. Please sign in instead or use Forgot Password.';
  }

  return 'An account with this email already exists. Please sign in instead or use Forgot Password.';
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<UserRole>(null);
  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionExpiryReason, setSessionExpiryReason] = useState<SessionExpiryReason>(null);
  const [loading, setLoading] = useState(true);
  const forcedSessionExpiryReasonRef = useRef<SessionExpiryReason>(null);
  const bootstrappedRef = useRef(false);

  const clearAuthState = () => {
    setSession(null);
    setUser(null);
    setUserRole(null);
    setIsBanned(false);
    setBanReason(null);
  };

  const expireSession = async (reason: SessionExpiryReason) => {
    forcedSessionExpiryReasonRef.current = reason;
    setSessionExpired(!!reason);
    setSessionExpiryReason(reason);
    clearAuthState();
    setLoading(false);

    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // ignore
    }

    if (typeof window !== 'undefined') {
      const target = `/login?session=${encodeURIComponent(reason || 'expired')}`;
      const current = `${window.location.pathname}${window.location.search}`;
      if (current !== target) {
        window.location.replace(target);
      }
    }
  };

  const fetchUserRole = async (userId: string) => {
    try {
      const { data, error } = await supabase.rpc('get_user_role', {
        _user_id: userId,
      });

      const normalizedRole = normalizeUserRole(data);
      if (normalizedRole) {
        return normalizedRole;
      }

      if (error) {
        console.error('Error fetching user role via RPC:', error);
      }

      const { data: roleRow, error: roleRowError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (roleRowError) {
        console.error('Error fetching user role via table fallback:', roleRowError);
        return null;
      }

      return pickHighestPriorityRole((roleRow || []).map((row) => row.role));
    } catch (error) {
      console.error('Error fetching user role:', error);
      return null;
    }
  };

  const fetchUserRoleWithRetry = async (userId: string, attempts = 4, delayMs = 300) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const role = await fetchUserRole(userId);
      if (role) {
        return role;
      }

      if (attempt < attempts - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      }
    }

    return null;
  };

  const fetchBanState = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching ban state:', error);
        return { isBanned: false, banReason: null };
      }

      const row = (data || {}) as {
        is_banned?: boolean | null;
        banned_reason?: string | null;
      };

      return {
        isBanned: !!row.is_banned,
        banReason: row.banned_reason || null,
      };
    } catch (error) {
      console.error('Error fetching ban state:', error);
      return { isBanned: false, banReason: null };
    }
  };

  const extractDiscordIdentity = (user: User | null) => {
    if (!user) return null;
    const identities = Array.isArray((user as any).identities) ? (user as any).identities : [];
    const discordIdentity = identities.find((identity: any) => identity?.provider === 'discord');
    if (!discordIdentity) return null;

    const identityData = discordIdentity.identity_data || {};
    const discordId =
      identityData?.id ||
      identityData?.user_id ||
      identityData?.sub ||
      discordIdentity?.id ||
      null;

    const discordUsername =
      identityData?.username ||
      identityData?.global_name ||
      identityData?.full_name ||
      user.user_metadata?.full_name ||
      null;

    if (!discordId) return null;
    return {
      discordId: String(discordId),
      discordUsername: discordUsername ? String(discordUsername) : null,
    };
  };

  const ensureDiscordIdentityLink = async (user: User | null) => {
    const identity = extractDiscordIdentity(user);
    if (!identity || !user) return;

    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('discord_user_id, discord_username')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError) {
        console.error('Error fetching profile for Discord linking:', profileError);
        return;
      }

      const needsUpdate =
        (profile?.discord_user_id || null) !== identity.discordId ||
        (identity.discordUsername && (profile?.discord_username || null) !== identity.discordUsername);

      if (!needsUpdate) return;

      const { error: updateError } = await (supabase as any).rpc(
        'sync_my_discord_identity',
        {
          p_discord_user_id: identity.discordId,
          p_discord_username: identity.discordUsername || null,
        }
      );

      if (updateError) {
        console.error('Error updating Discord identity:', updateError);
      }
    } catch (error) {
      console.error('Error linking Discord identity:', error);
    }
  };

  const ensureMyUserBootstrap = async (activeUser: User | null) => {
    if (!activeUser?.id || !activeUser.email) {
      return;
    }

    try {
      const { error } = await (supabase as any).rpc('ensure_my_user_bootstrap', {
        p_email: activeUser.email,
        p_full_name: typeof activeUser.user_metadata?.full_name === 'string' ? activeUser.user_metadata.full_name : null,
        p_provider: inferAuthProvider(activeUser),
        p_requested_role: typeof activeUser.user_metadata?.role === 'string' ? activeUser.user_metadata.role : null,
      });

      if (error) {
        console.error('Error ensuring user bootstrap state:', error);
      }
    } catch (error) {
      console.error('Error ensuring user bootstrap state:', error);
    }
  };

  const fetchActiveSessionState = async (userId: string) => {
    const { data, error } = await supabase
      .from('active_user_sessions')
      .select('session_id, issued_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching active auth session state:', error);
      return null;
    }

    return data;
  };

  const registerActiveSession = async (userId: string, activeSession: Session) => {
    const { sessionId, issuedAt } = getSessionMetadata(activeSession);
    if (!sessionId || !issuedAt) return true;

    const { error } = await supabase.rpc('claim_active_session', {
      p_session_id: sessionId,
      p_issued_at: issuedAt,
      p_device_label: getCurrentDeviceLabel(),
    });

    if (error) {
      console.error('Error registering active auth session:', error);
      return false;
    }

    return true;
  };

  const clearActiveSession = async (userId: string, activeSession: Session | null) => {
    const { sessionId } = getSessionMetadata(activeSession);
    if (!sessionId) return;

    const { error } = await supabase.rpc('release_active_session', {
      p_session_id: sessionId,
    });

    if (error) {
      console.error('Error clearing active auth session:', error);
    }
  };

  const enforceSingleDeviceSession = async (userId: string, activeSession: Session) => {
    const { sessionId, issuedAt } = getSessionMetadata(activeSession);
    if (!sessionId || !issuedAt) {
      return true;
    }

    const activeSessionState = await fetchActiveSessionState(userId);
    const storedSessionId = activeSessionState?.session_id || null;
    const storedIssuedAt =
      typeof activeSessionState?.issued_at === 'number' ? activeSessionState.issued_at : null;

    if (storedSessionId && storedSessionId !== sessionId && storedIssuedAt && storedIssuedAt > issuedAt) {
      await expireSession('other-device');
      return false;
    }

    const registered = await registerActiveSession(userId, activeSession);
    if (!registered) {
      await expireSession('expired');
      return false;
    }

    return true;
  };

  const validateSingleDeviceSession = async (userId: string, activeSession: Session) => {
    const { sessionId } = getSessionMetadata(activeSession);
    if (!sessionId) return true;

    const activeSessionState = await fetchActiveSessionState(userId);
    const activeSessionId = activeSessionState?.session_id || null;

    if (activeSessionId && activeSessionId !== sessionId) {
      await expireSession('other-device');
      return false;
    }

    return true;
  };

  const hydrateAuthState = async (nextSession: Session | null) => {
    if (forcedSessionExpiryReasonRef.current) {
      setSessionExpired(true);
      setSessionExpiryReason(forcedSessionExpiryReasonRef.current);
      clearAuthState();
      setLoading(false);
      return;
    }

    if (!nextSession?.user) {
      setSessionExpired(false);
      setSessionExpiryReason(null);
      clearAuthState();
      setLoading(false);
      return;
    }

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    const verifiedUser = userRes?.user ?? null;
    if (userErr || !verifiedUser) {
      console.warn('Session exists locally but failed verification. Clearing auth state.', userErr);
      await expireSession('expired');
      return;
    }

    const allowedSession = await enforceSingleDeviceSession(verifiedUser.id, nextSession);
    if (!allowedSession) {
      return;
    }

    forcedSessionExpiryReasonRef.current = null;
    setSessionExpired(false);
    setSessionExpiryReason(null);
    setSession(nextSession);
    setUser(verifiedUser);
    await ensureMyUserBootstrap(verifiedUser);
    await ensureDiscordIdentityLink(verifiedUser);
    const [role, banState] = await Promise.all([
      fetchUserRoleWithRetry(verifiedUser.id),
      fetchBanState(verifiedUser.id),
    ]);
    setUserRole(role || normalizeUserRole(verifiedUser.user_metadata?.role));
    setIsBanned(banState.isBanned);
    setBanReason(banState.banReason);
    setLoading(false);
  };

  useEffect(() => {
    // Set up auth state listener BEFORE checking session
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setTimeout(() => {
        if (event === 'TOKEN_REFRESHED') {
          if (forcedSessionExpiryReasonRef.current) {
            return;
          }

          if (!session?.user) {
            clearAuthState();
            setLoading(false);
            return;
          }

          setSession(session);
          void validateSingleDeviceSession(session.user.id, session);
          return;
        }

        const shouldShowLoading = !bootstrappedRef.current;

        if (shouldShowLoading) {
          setLoading(true);
        }

        void hydrateAuthState(session);
      }, 0);
    });

    // Check for existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      await hydrateAuthState(session);
      bootstrappedRef.current = true;
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.id || !session) {
      return;
    }

    let active = true;
    const channel = supabase
      .channel(`single-device-session:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'active_user_sessions',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (!active) return;

          const { sessionId } = getSessionMetadata(session);
          const nextSessionId =
            typeof payload.new?.session_id === 'string'
              ? payload.new.session_id
              : null;

          if (sessionId && nextSessionId && nextSessionId !== sessionId) {
            void expireSession('other-device');
          }
        }
      )
      .subscribe();

    const intervalId = window.setInterval(() => {
      void validateSingleDeviceSession(user.id, session);
    }, SINGLE_DEVICE_CHECK_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, session]);

  const signIn = async (email: string, password: string) => {
    forcedSessionExpiryReasonRef.current = null;
    setSessionExpired(false);
    setSessionExpiryReason(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  };

  const signUp = async (
    email: string,
    password: string,
    fullName?: string,
    role: 'client' | 'worker' = 'worker',
    workerFields?: WorkerProfileFields,
    screenshotFile?: File | null,
    referralCode?: string | null
  ) => {
    forcedSessionExpiryReasonRef.current = null;
    setSessionExpired(false);
    setSessionExpiryReason(null);
    const normalizedEmail = email.trim().toLowerCase();
    // Check if email is admin (admin-only account, no signup allowed)
    // Admins must be created by system

    const { data: accountLookup, error: lookupError } = await supabase.functions.invoke('check-account-exists', {
      body: { email: normalizedEmail },
    });

    const initialAccountExists = !lookupError && !!(accountLookup as any)?.exists;
    let knownAuthProvider = !lookupError && typeof (accountLookup as any)?.auth_provider === 'string'
      ? (accountLookup as any).auth_provider
      : null;

    if (initialAccountExists) {
      return {
        error: new Error(
          normalizeDuplicateSignUpMessage('already registered', knownAuthProvider) ||
            'An account with this email already exists. Please sign in instead.',
        ),
      };
    }

    const { error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: getAuthRedirectUrl('/login'),
        data: {
          full_name: fullName || '',
          role,
          referral_code: referralCode || undefined,
        }
      }
    });

    if (signUpError) {
      let confirmedExistingAccount = initialAccountExists;

      if (!confirmedExistingAccount) {
        const { data: retryLookup, error: retryLookupError } = await supabase.functions.invoke('check-account-exists', {
          body: { email: normalizedEmail },
        });

        if (!retryLookupError && (retryLookup as any)?.exists) {
          confirmedExistingAccount = true;
          knownAuthProvider = typeof (retryLookup as any)?.auth_provider === 'string'
            ? (retryLookup as any).auth_provider
            : knownAuthProvider;
        }
      }

      const duplicateMessage = confirmedExistingAccount
        ? normalizeDuplicateSignUpMessage(signUpError.message, knownAuthProvider)
        : null;

      const normalizedSignUpMessage = (signUpError.message || '').trim().toLowerCase();
      const fallbackMessage = normalizedSignUpMessage.includes('error creating identity')
        ? 'Account creation failed on the server. Please try again later. If the issue continues, contact support.'
        : signUpError.message;

      return {
        error: new Error(duplicateMessage || fallbackMessage),
      };
    }



    return { error: null };
  };

  const signOut = async () => {
    const currentUserId = user?.id || session?.user?.id || null;
    const currentSession = session;
    forcedSessionExpiryReasonRef.current = null;
    try {
      if (currentUserId) {
        await clearActiveSession(currentUserId, currentSession);
      }
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error) {
      console.warn('Sign out failed, clearing session locally.', error);
    } finally {
      setSessionExpired(false);
      setSessionExpiryReason(null);
      clearAuthState();
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, userRole, isBanned, banReason, sessionExpired, sessionExpiryReason, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};





