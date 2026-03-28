import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { CommunityButtons } from '@/components/community/CommunityButtons';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  creditsToInr,
  DEFAULT_CREDITS_PER_INR,
  DEFAULT_REFERRAL_REWARD_CREDITS,
  formatCreditsInrHint,
  inrToCredits,
} from '@/lib/credits';
import { ArrowDownToLine, Copy, Gamepad2, IndianRupee, Share2, Users, Wallet } from 'lucide-react';

type WalletRow = {
  credits: number | null;
  referral_code: string | null;
  referred_by_user_id: string | null;
};

type CreditSettingsRow = {
  credits_per_inr: number | null;
  referral_reward_credits: number | null;
  min_withdrawal_credits: number | null;
};

type ReferralRewardRow = {
  id: string;
  referred_user_id: string;
  reward_credits: number;
  created_at: string;
};

type WithdrawalRequestRow = {
  id: string;
  credits_requested: number;
  inr_amount: number;
  upi_id: string | null;
  notes: string | null;
  admin_notes: string | null;
  status: string;
  created_at: string;
};

type ReferralJoinerRow = {
  referred_user_id: string;
  full_name: string | null;
  reddit_username: string | null;
  email: string | null;
  joined_at: string;
  completed_tasks: number;
  reward_credited: boolean;
  reward_credits: number;
};

const WorkerWalletPage: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [withdrawCredits, setWithdrawCredits] = useState('');
  const [withdrawNotes, setWithdrawNotes] = useState('');

  const walletQuery = useQuery({
    queryKey: ['worker-wallet', user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('users')
        .select('credits, referral_code, referred_by_user_id')
        .eq('id', user?.id)
        .maybeSingle();

      if (error) throw error;
      return (data || null) as WalletRow | null;
    },
    enabled: !!user?.id,
  });

  const settingsQuery = useQuery({
    queryKey: ['credit-settings'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('credit_settings')
        .select('credits_per_inr, referral_reward_credits, min_withdrawal_credits')
        .eq('id', true)
        .maybeSingle();

      if (error) throw error;
      return (data || null) as CreditSettingsRow | null;
    },
  });

  const referralsQuery = useQuery({
    queryKey: ['worker-referral-rewards', user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('referral_rewards')
        .select('id, referred_user_id, reward_credits, created_at')
        .eq('referrer_user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = ((data || []) as ReferralRewardRow[]).filter((row) => !!row.referred_user_id);
      return rows.map((row) => ({
        ...row,
        referred_name: `User ${row.referred_user_id.slice(0, 8)}`,
      }));
    },
    enabled: !!user?.id,
  });

  const referralJoinersQuery = useQuery({
    queryKey: ['worker-referral-joiners', user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_my_referral_joiners');
      if (error) throw error;
      return (data || []) as ReferralJoinerRow[];
    },
    enabled: !!user?.id,
  });

  const withdrawalsQuery = useQuery({
    queryKey: ['worker-withdrawal-requests', user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('withdrawal_requests')
        .select('id, credits_requested, inr_amount, upi_id, notes, admin_notes, status, created_at')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as WithdrawalRequestRow[];
    },
    enabled: !!user?.id,
  });

  const creditsPerInr = settingsQuery.data?.credits_per_inr || DEFAULT_CREDITS_PER_INR;
  const referralRewardCredits = settingsQuery.data?.referral_reward_credits || DEFAULT_REFERRAL_REWARD_CREDITS;
  const minWithdrawalCredits = settingsQuery.data?.min_withdrawal_credits || creditsPerInr;
  const balanceCredits = walletQuery.data?.credits || 0;
  const balanceInr = creditsToInr(balanceCredits, creditsPerInr);
  const referralLink = walletQuery.data?.referral_code
    ? `${window.location.origin}/login?mode=signup&ref=${walletQuery.data.referral_code}`
    : '';

  const totalReferralCredits = useMemo(
    () => (referralsQuery.data || []).reduce((sum, row: any) => sum + (row.reward_credits || 0), 0),
    [referralsQuery.data]
  );

  const pendingWithdrawalCredits = useMemo(
    () =>
      (withdrawalsQuery.data || [])
        .filter((row) => row.status === 'pending' || row.status === 'processing')
        .reduce((sum, row) => sum + (row.credits_requested || 0), 0),
    [withdrawalsQuery.data]
  );

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      const parsedCredits = Number(withdrawCredits);

      if (!Number.isFinite(parsedCredits) || parsedCredits <= 0) {
        throw new Error('Enter a valid credit amount.');
      }

      const { data, error } = await (supabase as any).rpc('create_wallet_withdrawal_request', {
        p_credits: Math.floor(parsedCredits),
        p_notes: withdrawNotes.trim() || null,
      });

      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['worker-wallet'] });
      queryClient.invalidateQueries({ queryKey: ['worker-withdrawal-requests'] });
      setWithdrawCredits('');
      setWithdrawNotes('');
      toast({
        title: 'Withdrawal requested',
        description: `Requested ${result?.credits_requested || 0} credits (Rs ${Number(result?.inr_amount || 0).toFixed(2)}).`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Withdrawal failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Wallet</h1>
          <p className="text-sm text-muted-foreground">
            Arcade credits and referral rewards are stored in one wallet and withdrawn from here.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Available Balance</p>
                <p className="mt-2 text-3xl font-bold">{balanceCredits.toLocaleString()} credits</p>
                <p className="mt-1 text-sm text-green-600">Rs {balanceInr.toFixed(2)}</p>
              </div>
              <Wallet className="h-10 w-10 text-primary" />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Per Referral Reward</p>
                <p className="mt-2 text-3xl font-bold">{referralRewardCredits} credits</p>
                <p className="mt-1 text-sm text-green-600">Rs {creditsToInr(referralRewardCredits, creditsPerInr).toFixed(2)}</p>
              </div>
              <Users className="h-10 w-10 text-primary" />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Conversion</p>
                <p className="mt-2 text-3xl font-bold">{creditsPerInr}</p>
                <p className="mt-1 text-sm text-muted-foreground">{formatCreditsInrHint(creditsPerInr)}</p>
              </div>
              <IndianRupee className="h-10 w-10 text-primary" />
            </div>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <div className="space-y-6">
            <Card className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Referral Code</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Share this with new taskers. You get the reward only after their first verified task.
                  </p>
                </div>
                <Share2 className="h-5 w-5 text-muted-foreground" />
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <Input value={walletQuery.data?.referral_code || ''} readOnly className="font-semibold tracking-wide" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const code = walletQuery.data?.referral_code || '';
                    if (!code) return;
                    await navigator.clipboard.writeText(code);
                    toast({ title: 'Referral code copied' });
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Code
                </Button>
              </div>

              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <Input value={referralLink} readOnly className="text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    if (!referralLink) return;
                    await navigator.clipboard.writeText(referralLink);
                    toast({ title: 'Referral link copied' });
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Link
                </Button>
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Referral Earnings</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Total earned from successful first-task referrals: {totalReferralCredits} credits.
                  </p>
                </div>
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border p-4">
                  <div className="text-sm text-muted-foreground">Successful Referrals</div>
                  <div className="mt-2 text-2xl font-bold">{referralsQuery.data?.length || 0}</div>
                </div>
                <div className="rounded-xl border p-4">
                  <div className="text-sm text-muted-foreground">Referral Credits</div>
                  <div className="mt-2 text-2xl font-bold">{totalReferralCredits}</div>
                </div>
                <div className="rounded-xl border p-4">
                  <div className="text-sm text-muted-foreground">INR Value</div>
                  <div className="mt-2 text-2xl font-bold">Rs {creditsToInr(totalReferralCredits, creditsPerInr).toFixed(2)}</div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {(referralsQuery.data || []).length > 0 ? (
                  (referralsQuery.data || []).map((reward: any) => (
                    <div key={reward.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                      <div>
                        <p className="font-medium">{reward.referred_name}</p>
                        <p className="text-xs text-muted-foreground">
                          First task verified on {new Date(reward.created_at).toLocaleString()}
                        </p>
                      </div>
                      <Badge className="bg-green-500/15 text-green-600">
                        +{reward.reward_credits} credits
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    No referral rewards credited yet.
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">People Who Joined With Your Link</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    You can see who joined already. Reward unlocks after their first submitted and verified task.
                  </p>
                </div>
                <Share2 className="h-5 w-5 text-muted-foreground" />
              </div>

              <div className="mt-4 space-y-3">
                {(referralJoinersQuery.data || []).length > 0 ? (
                  (referralJoinersQuery.data || []).map((joiner) => {
                    const label =
                      joiner.full_name || joiner.reddit_username || joiner.email || joiner.referred_user_id;
                    const status = joiner.reward_credited
                      ? `Reward credited (+${joiner.reward_credits} credits)`
                      : joiner.completed_tasks > 0
                        ? 'First task completed, waiting for reward sync'
                        : 'Joined, first task pending';

                    return (
                      <div key={joiner.referred_user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                        <div>
                          <p className="font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground">
                            Joined on {new Date(joiner.joined_at).toLocaleString()}
                          </p>
                        </div>
                        <Badge variant="outline">{status}</Badge>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    No one has joined with your referral link yet.
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Withdraw Credits</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Minimum request: {minWithdrawalCredits} credits (Rs {creditsToInr(minWithdrawalCredits, creditsPerInr).toFixed(2)}).
                  </p>
                </div>
                <ArrowDownToLine className="h-5 w-5 text-muted-foreground" />
              </div>

              <div className="mt-4 space-y-4">
                <div className="rounded-xl border bg-muted/20 p-4 text-sm">
                  <div>{formatCreditsInrHint(creditsPerInr)}</div>
                  <div className="mt-1">Arcade winnings and referral rewards both use this same conversion.</div>
                  <div className="mt-1">Pending withdrawals: {pendingWithdrawalCredits} credits.</div>
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-medium">Credits to withdraw</label>
                  <Input
                    type="number"
                    min={minWithdrawalCredits}
                    step={1}
                    value={withdrawCredits}
                    onChange={(e) => setWithdrawCredits(e.target.value)}
                    placeholder={`Example: ${Math.max(minWithdrawalCredits, referralRewardCredits)}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    This request will be worth Rs {creditsToInr(Number(withdrawCredits || 0), creditsPerInr).toFixed(2)}.
                  </p>
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-medium">Notes</label>
                  <Textarea
                    value={withdrawNotes}
                    onChange={(e) => setWithdrawNotes(e.target.value)}
                    placeholder="Optional note for payout handling"
                    rows={4}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => setWithdrawCredits(String(minWithdrawalCredits))}>
                    Min
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setWithdrawCredits(String(balanceCredits))}
                  >
                    All Balance
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setWithdrawCredits(String(inrToCredits(20, creditsPerInr)))}
                  >
                    Rs 20
                  </Button>
                </div>

                <Button
                  type="button"
                  className="w-full"
                  disabled={withdrawMutation.isPending || balanceCredits < minWithdrawalCredits}
                  onClick={() => withdrawMutation.mutate()}
                >
                  {withdrawMutation.isPending ? 'Submitting...' : 'Request Withdrawal'}
                </Button>
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold">Community Support</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Recommend new taskers to join our Discord and Telegram communities for faster support and updates.
              </p>
              <CommunityButtons compact className="mt-4" />
            </Card>

            <Card className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Withdrawal History</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Credits are deducted when the request is created.
                  </p>
                </div>
                <Gamepad2 className="h-5 w-5 text-muted-foreground" />
              </div>

              <div className="mt-4 space-y-3">
                {(withdrawalsQuery.data || []).length > 0 ? (
                  (withdrawalsQuery.data || []).map((request) => (
                    <div key={request.id} className="rounded-xl border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {request.credits_requested} credits {'->'} Rs {Number(request.inr_amount || 0).toFixed(2)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(request.created_at).toLocaleString()} | UPI: {request.upi_id || '-'}
                          </p>
                        </div>
                        <Badge variant="outline" className="uppercase">
                          {request.status}
                        </Badge>
                      </div>
                      {request.notes ? (
                        <p className="mt-3 text-sm text-muted-foreground">{request.notes}</p>
                      ) : null}
                      {request.admin_notes ? (
                        <p className="mt-2 text-sm text-muted-foreground">Admin: {request.admin_notes}</p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    No withdrawal requests yet.
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default WorkerWalletPage;
