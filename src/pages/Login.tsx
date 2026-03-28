import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { CommunityButtons } from '@/components/community/CommunityButtons';
import { supabase } from '@/integrations/supabase/client';
import { normalizeReferralCode, setPendingReferralCode } from '@/lib/referrals';
import logo from '@/assets/logo.jpg';

const Login: React.FC = () => {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode');
  const sessionStatus = searchParams.get('session');
  const referralCode = normalizeReferralCode(searchParams.get('ref'));

  const [isLogin, setIsLogin] = useState(mode !== 'signup');
  const [referrerLabel, setReferrerLabel] = useState('');

  const { user, session, userRole, isBanned, banReason, sessionExpired, sessionExpiryReason, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    setPendingReferralCode(referralCode || null);
  }, [referralCode]);

  useEffect(() => {
    let active = true;

    const loadReferrer = async () => {
      if (!referralCode) {
        setReferrerLabel('');
        return;
      }

      const { data, error } = await supabase.rpc('get_referral_owner', {
        p_code: referralCode,
      });

      if (!active) return;
      if (error || !Array.isArray(data) || data.length === 0) {
        setReferrerLabel('');
        return;
      }

      const row = data[0] as any;
      setReferrerLabel(row.full_name || row.reddit_username || row.email || row.referral_code || '');
    };

    loadReferrer();

    return () => {
      active = false;
    };
  }, [referralCode]);

  useEffect(() => {
    if (
      !loading &&
      user &&
      session &&
      userRole &&
      !isBanned &&
      !sessionExpired &&
      !sessionExpiryReason
    ) {
      if (userRole === 'admin' || userRole === 'owner') {
        navigate('/admin', { replace: true });
      } else if (userRole === 'moderator') {
        navigate('/admin/tasks', { replace: true });
      } else if (userRole === 'worker') {
        navigate('/worker', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [user, session, userRole, isBanned, loading, navigate, sessionExpired, sessionExpiryReason]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (user && session && isBanned) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md stoic-card p-8 text-center">
          <h1 className="text-2xl font-bold">Account banned</h1>
          <p className="mt-2 text-muted-foreground">
            This account cannot access the platform.
          </p>
          {banReason ? (
            <p className="mt-4 text-sm">
              <strong>Reason:</strong> {banReason}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md relative">
        <div className="text-center mb-8">
          <img src={logo} alt="StoicOps Logo" className="h-20 w-20 mx-auto rounded-xl" />
          <h1 className="text-3xl font-bold mt-4">
            Stoic<span className="text-primary">Ops</span>
          </h1>
          <p className="text-muted-foreground mt-2">
            {isLogin
              ? 'Welcome back. Enter your credentials.'
              : 'Create your account to get started.'}
          </p>
          {(sessionStatus === 'expired' || sessionStatus === 'other-device' || sessionExpired) ? (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
              {(sessionStatus === 'other-device' || sessionExpiryReason === 'other-device')
                ? 'You were signed out because this account was used on another device.'
                : 'Session expired. Please sign in again.'}
            </div>
          ) : null}
          {referralCode ? (
            <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
              <div className="font-medium text-foreground">Referral link detected</div>
              <div className="mt-1 text-muted-foreground">
                {referrerLabel
                  ? `You were invited by ${referrerLabel}.`
                  : `You were invited with referral code ${referralCode}.`}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Your referrer gets credits after your first submitted and verified task.
              </div>
            </div>
          ) : null}
        </div>

        <div className="stoic-card p-8">
          <h2 className="text-xl font-semibold mb-6 text-center">
            {isLogin ? 'Sign In' : 'Create Account'}
          </h2>

          {isLogin ? (
            <LoginForm onSwitchToSignUp={() => setIsLogin(false)} />
          ) : (
            <SignUpForm
              onSwitchToLogin={() => setIsLogin(true)}
              referralCode={referralCode}
              referrerLabel={referrerLabel}
            />
          )}

          <div className="mt-6 border-t border-border pt-6">
            <p className="mb-3 text-center text-sm text-muted-foreground">
              Join our communities for support, updates, and easier access.
            </p>
            <CommunityButtons compact className="justify-center" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
