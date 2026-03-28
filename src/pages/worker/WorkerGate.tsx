import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { WorkerProfileForm } from '@/components/auth/WorkerProfileForm';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  parseRedditData,
  retryRedditAccountVerification,
} from '@/lib/redditVerification';
import { getPendingReferralCode, normalizeReferralCode } from '@/lib/referrals';

interface Props {
  children?: React.ReactNode;
}

type RedditAccountRow = {
  id: string;
  reddit_username: string | null;
  reddit_data: unknown;
  is_verified: boolean | null;
  karma_range: string | null;
  cqs: string | null;
};

const getAutoVerifyAttempts = (redditData: unknown) => {
  const parsed: any = parseRedditData(redditData);
  const attempts = parsed?.verification?.autoVerifyAttempts;
  return typeof attempts === 'number' && attempts >= 0 ? attempts : 0;
};

const getVerificationStatus = (redditData: unknown) => {
  const parsed: any = parseRedditData(redditData);
  return parsed?.verification?.status || 'pending_manual_verification';
};

const getRejectionReason = (redditData: unknown) => {
  const parsed: any = parseRedditData(redditData);
  return (
    parsed?.verification?.rejectionReason ||
    parsed?.verification?.rejection_reason ||
    ''
  );
};

const WorkerGate: React.FC<Props> = ({ children }) => {
  const { user, userRole, loading } = useAuth();
  const [needsProfile, setNeedsProfile] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isVerified, setIsVerified] = useState<boolean | null>(null);
  const [retryingAccountId, setRetryingAccountId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<RedditAccountRow[]>([]);
  const [upiId, setUpiId] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [showAddAccountForm, setShowAddAccountForm] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const initialReferralCode =
    normalizeReferralCode((user?.user_metadata as any)?.referral_code) || getPendingReferralCode();

  const refreshProfileState = async () => {
    if (!user || userRole !== 'worker') {
      setChecking(false);
      return;
    }

    const [{ data: profileData }, { data: accountRows, error: accountsError }] =
      await Promise.all([
        supabase
          .from('profiles')
          .select('upi_id, timezone, reddit_username, reddit_profile, reddit_data, karma, karma_range, cqs, cqs_proof, is_verified, avatar_url')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('reddit_accounts')
          .select('id, reddit_username, reddit_data, is_verified, karma_range, cqs')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
      ]);

    if (accountsError) {
      const hasLegacyAccount = !!profileData?.reddit_username;
      const hasUpi = !!profileData?.upi_id;
      const legacyData = parseRedditData(profileData?.reddit_data);
      const hasTimezone = !!profileData?.timezone || !!(legacyData as any)?.timezone;
      setNeedsProfile(!hasUpi || !hasLegacyAccount);
      setIsVerified(!!profileData?.is_verified);
      setAccounts([]);
      setChecking(false);
      return;
    }

    let accountList = (accountRows || []) as RedditAccountRow[];

    if (accountList.length === 0 && profileData?.reddit_username) {
      const { error: backfillError } = await (supabase as any).rpc(
        'backfill_legacy_my_reddit_account'
      );

      if (!backfillError) {
        const { data: refreshedAccounts } = await supabase
          .from('reddit_accounts')
          .select('id, reddit_username, reddit_data, is_verified, karma_range, cqs')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        accountList = (refreshedAccounts || []) as RedditAccountRow[];
      }
    }
    const verified = accountList.some((a) => a.is_verified);
    const hasUpi = !!profileData?.upi_id;
    const fallbackTimezone = (accountList || [])
      .map((account) => parseRedditData(account.reddit_data))
      .find((data) => (data as any)?.timezone);
    const legacyTimezone = (parseRedditData(profileData?.reddit_data) as any)?.timezone;
    const hasTimezone = !!profileData?.timezone || !!fallbackTimezone || !!legacyTimezone;

    setAccounts(accountList);
    setUpiId(profileData?.upi_id ?? null);
    setTimezone(profileData?.timezone ?? (fallbackTimezone as any)?.timezone ?? legacyTimezone ?? null);
    setNeedsProfile(!hasUpi || accountList.length === 0);
    setIsVerified(verified);

    if (verified && location.pathname === '/worker') {
      navigate('/worker/dashboard', { replace: true });
    }

    setChecking(false);
  };

  useEffect(() => {
    if (!loading) {
      refreshProfileState();
    }
  }, [user, userRole, loading, navigate, location.pathname]);

  if (loading || checking) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  if (userRole !== 'worker') {
    return <div className="p-8 text-center">Access denied.</div>;
  }

  if (needsProfile && user) {
    if (location.pathname === '/worker/dashboard') {
      return <>{children}</>;
    }

    return <Navigate to="/worker/dashboard" replace />;
  }

  const handleRetryAutoVerify = async (account: RedditAccountRow) => {
    if (!user) {
      return;
    }

    const attempts = getAutoVerifyAttempts(account.reddit_data);
    if (attempts >= 2) {
      toast({
        title: 'Auto verify limit reached',
        description: 'Admin verification is now required.',
      });
      return;
    }

    setRetryingAccountId(account.id);

    if (!account.reddit_username) {
      toast({
        title: 'Missing Reddit username',
        description: 'Please update your Reddit account details.',
        variant: 'destructive',
      });
      setRetryingAccountId(null);
      return;
    }

    try {
      const result = await retryRedditAccountVerification(account.id);

      if (result.is_verified) {
        toast({ title: 'Reddit account verified!' });
        await refreshProfileState();
        setRetryingAccountId(null);
        navigate('/worker/dashboard', { replace: true });
        return;
      } else {
        toast({
          title:
            result.auto_verify_attempts >= 2
              ? 'Auto verify limit reached'
              : 'Still pending verification',
          description:
            result.auto_verify_attempts >= 2
              ? 'Reddit profile still needs admin verification.'
              : 'Reddit profile still needs admin verification.',
        });
      }
    } catch (error) {
      toast({
        title: 'Failed to retry auto verification',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
      setRetryingAccountId(null);
      return;
    }

    await refreshProfileState();
    setRetryingAccountId(null);
  };

  if (isVerified === false) {
    const hasRejectedAccount = accounts.some(
      (account) => getVerificationStatus(account.reddit_data) === 'rejected_by_admin'
    );

    if (showAddAccountForm && user) {
      const rejectionDetails = (accounts || [])
        .filter((account) => getVerificationStatus(account.reddit_data) === 'rejected_by_admin')
        .map((account) => ({
          username: account.reddit_username || 'unknown',
          reason: getRejectionReason(account.reddit_data),
        }));
      return (
        <div className="p-8 space-y-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowAddAccountForm(false)}
          >
            Back to verification status
          </Button>
          <WorkerProfileForm
            userId={user.id}
            existingUpiId={upiId}
            initialReferralCode={initialReferralCode}
            rejectionDetails={rejectionDetails}
            onComplete={async (result) => {
              setChecking(true);
              await refreshProfileState();
              setShowAddAccountForm(false);
              if (result?.isVerified) {
                navigate('/worker/dashboard', { replace: true });
              }
            }}
          />
        </div>
      );
    }

    return (
      <div className="p-8 text-center text-yellow-600 font-semibold space-y-4">
        <div>
          Your Reddit accounts are pending admin verification.
          You cannot start tasks until at least one account is verified.
        </div>
        {hasRejectedAccount && (
          <div className="text-sm text-red-600">
            One or more accounts were rejected. Please add a different Reddit account.
          </div>
        )}
        <div className="space-y-3">
          {(accounts || []).map((account) => {
            const attempts = getAutoVerifyAttempts(account.reddit_data);
            const status = getVerificationStatus(account.reddit_data);
            const rejectionReason = getRejectionReason(account.reddit_data);
            return (
              <div
                key={account.id}
                className="mx-auto max-w-xl rounded-lg border border-border bg-card/70 p-4 text-left"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">u/{account.reddit_username}</div>
                    <div className="text-xs text-muted-foreground">
                      Status: {status === 'rejected_by_admin' ? 'Rejected' : account.is_verified ? 'Verified' : 'Pending'}
                    </div>
                    {status === 'rejected_by_admin' && (
                      <div className="mt-1 text-xs text-red-600">
                        Rejection reason: {rejectionReason || 'No reason provided'}
                      </div>
                    )}
                  </div>
                  {!account.is_verified && status !== 'rejected_by_admin' && attempts < 2 ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={retryingAccountId === account.id}
                      onClick={() => handleRetryAutoVerify(account)}
                    >
                      {retryingAccountId === account.id
                        ? 'Trying auto verify...'
                        : 'Try Auto Verify Again'}
                    </Button>
                  ) : status !== 'rejected_by_admin' ? (
                    <div className="text-xs text-muted-foreground">
                      Auto verify limit reached
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {hasRejectedAccount && (
          <div className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAddAccountForm(true)}
            >
              Add another Reddit account
            </Button>
          </div>
        )}
      </div>
    );
  }

  return <>{children}</>;
};

export default WorkerGate;
