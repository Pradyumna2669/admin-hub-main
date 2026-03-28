import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Users, Mail, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { LeagueBadge } from '@/components/badges/LeagueBadge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { parseRedditData } from '@/lib/redditVerification';

type RedditAccountRow = {
  id: string;
  user_id: string;
  reddit_username: string | null;
  reddit_profile: string | null;
  is_verified: boolean | null;
  karma: number | null;
  karma_range: string | null;
  cqs: string | null;
  cqs_proof?: string | null;
  reddit_data?: unknown;
};

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const PROFILE_CHUNK_SIZE = 150;

const AdminWorkers: React.FC = () => {
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<RedditAccountRow | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: workers, isLoading } = useQuery({
    queryKey: ['admin-workers'],
    queryFn: async () => {
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'worker');

      if (rolesError) throw rolesError;
      const userIds = roles.map((r) => r.user_id);
      if (userIds.length === 0) return [];

      const userIdChunks = chunkArray(userIds, PROFILE_CHUNK_SIZE);
      const profileResults = await Promise.all(
        userIdChunks.map((chunk) =>
          supabase
            .from('profiles')
            .select('user_id, email, full_name, is_banned, banned_reason, league')
            .in('user_id', chunk)
        )
      );

      const profiles = profileResults.flatMap((result) => {
        if (result.error) throw result.error;
        return result.data || [];
      });

      const accountResults = await Promise.all(
        userIdChunks.map((chunk) =>
          supabase
            .from('reddit_accounts')
            .select('id, user_id, reddit_username, reddit_profile, is_verified, karma, karma_range, cqs, cqs_proof, reddit_data')
            .in('user_id', chunk)
            .order('created_at', { ascending: false })
        )
      );

      const accounts = accountResults.flatMap((result) => {
        if (result.error) throw result.error;
        return result.data || [];
      });

      const accountsByUser = new Map<string, RedditAccountRow[]>();
      for (const account of (accounts || []) as RedditAccountRow[]) {
        const list = accountsByUser.get(account.user_id) || [];
        list.push(account);
        accountsByUser.set(account.user_id, list);
      }

      const workersWithTasks = await Promise.all(
        profiles.map(async (profile) => {
          const { data: assignments } = await supabase
            .from('task_assignments')
            .select('*')
            .eq('user_id', profile.user_id);

          const total = assignments?.length || 0;
          const completed = assignments?.filter((a) => a.status === 'completed').length || 0;
          const pending = assignments?.filter((a) => a.status === 'in_progress').length || 0;
          const totalOwed =
            assignments
              ?.filter((a) => a.status === 'completed' && a.payment_status === 'pending')
              .reduce((sum: number, a: any) => sum + parseFloat(a.amount || 0), 0) || 0;

          return {
            ...profile,
            id: profile.user_id,
            taskCounts: { total, completed, pending },
            totalOwed,
            redditAccounts: accountsByUser.get(profile.user_id) || [],
          };
        })
      );

      return workersWithTasks;
    },
  });

  const verifyAccountMutation = useMutation({
    mutationFn: async (account: RedditAccountRow) => {
      const existingData = parseRedditData(account.reddit_data);
      const nextData = {
        ...(existingData || {}),
        verification: {
          ...(existingData as any)?.verification,
          status: 'verified_by_admin',
          rejectionReason: null,
          rejectedAt: null,
          rejectedBy: null,
        },
      };
      const { error } = await supabase
        .from('reddit_accounts')
        .update({ is_verified: true, reddit_data: nextData })
        .eq('id', account.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-workers'] });
      toast({ title: 'Reddit account verified' });
    },
  });

  const rejectAccountMutation = useMutation({
    mutationFn: async ({ account, reason }: { account: RedditAccountRow; reason: string }) => {
      const trimmedReason = reason.trim();
      const existingData = parseRedditData(account.reddit_data);
      const nextData = {
        ...(existingData || {}),
        verification: {
          ...(existingData as any)?.verification,
          status: 'rejected_by_admin',
          rejectionReason: trimmedReason || null,
          rejectedAt: new Date().toISOString(),
          rejectedBy: user?.id ?? null,
        },
      };
      const { error } = await supabase
        .from('reddit_accounts')
        .update({ is_verified: false, reddit_data: nextData })
        .eq('id', account.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-workers'] });
      toast({ title: 'Reddit account rejected' });
      setRejectDialogOpen(false);
      setRejectReason('');
      setSelectedAccount(null);
    },
    onError: (error: any) => {
      toast({
        title: 'Rejection failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const getAccountStatus = (account: RedditAccountRow) => {
    if (account.is_verified) return 'Verified';
    const parsed = parseRedditData(account.reddit_data) as any;
    const status = parsed?.verification?.status;
    if (status === 'rejected_by_admin') return 'Rejected';
    return 'Pending';
  };

  const getRejectionReason = (account: RedditAccountRow) => {
    const parsed = parseRedditData(account.reddit_data) as any;
    return (
      parsed?.verification?.rejectionReason ||
      parsed?.verification?.rejection_reason ||
      ''
    );
  };

  const banMutation = useMutation({
    mutationFn: async ({
      userId,
      isBanned,
    }: {
      userId: string;
      isBanned: boolean;
    }) => {
      const reason = isBanned
        ? window.prompt('Reason for banning this tasker?') || ''
        : '';

      const { error } = await supabase.rpc('set_user_ban_status', {
        p_target_user_id: userId,
        p_is_banned: isBanned,
        p_reason: reason.trim() || null,
      });

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-workers'] });
      toast({ title: variables.isBanned ? 'Tasker banned' : 'Tasker unbanned' });
    },
    onError: (error: any) => {
      toast({
        title: 'Ban update failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const pendingVerificationCount = (workers || []).reduce((count: number, worker: any) => {
    const pending = (worker.redditAccounts || []).filter(
      (a: RedditAccountRow) => getAccountStatus(a) === 'Pending'
    ).length;
    return count + pending;
  }, 0);

  const filteredWorkers = (workers || []).filter((worker: any) => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const accounts = worker.redditAccounts || [];

    const matchesSearch =
      !normalizedQuery ||
      worker.full_name?.toLowerCase().includes(normalizedQuery) ||
      worker.email?.toLowerCase().includes(normalizedQuery) ||
      accounts.some((account: RedditAccountRow) =>
        account.reddit_username?.toLowerCase().includes(normalizedQuery)
      );

    const matchesStatus =
      statusFilter === 'all' ||
      accounts.some((account: RedditAccountRow) => {
        const accountStatus = getAccountStatus(account).toLowerCase();
        return accountStatus === statusFilter;
      });

    return matchesSearch && matchesStatus;
  });

  const triggerKarmaUpdateMutation = useMutation({
    mutationFn: async () => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error('No active session found. Please sign out and sign in again.');
      }

      const { data, error } = await supabase.functions.invoke('update-worker-karma', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-workers'] });
      toast({ title: 'Worker karma updated successfully' });
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to update karma',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const triggerLeagueUpdateMutation = useMutation({
    mutationFn: async () => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error('No active session found. Please sign out and sign in again.');
      }

      const { data, error } = await supabase.functions.invoke('refresh-leagues', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-workers'] });
      toast({ title: `Leagues updated (${data?.updated ?? 0} modified)` });
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to update leagues',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return (
    <DashboardLayout>
      <div className="w-full min-w-0 space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="break-words text-3xl font-bold">Taskers</h1>
            {pendingVerificationCount > 0 && (
              <span className="inline-flex max-w-full items-center justify-center rounded-full bg-red-500 px-2 py-1 text-xs text-white">
                Pending verification: {pendingVerificationCount}
              </span>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => triggerLeagueUpdateMutation.mutate()}
                disabled={triggerLeagueUpdateMutation.isPending}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${triggerLeagueUpdateMutation.isPending ? 'animate-spin' : ''}`} />
                {triggerLeagueUpdateMutation.isPending ? 'Updating...' : 'Update League'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => triggerKarmaUpdateMutation.mutate()}
                disabled={triggerKarmaUpdateMutation.isPending}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${triggerKarmaUpdateMutation.isPending ? 'animate-spin' : ''}`} />
                {triggerKarmaUpdateMutation.isPending ? 'Updating...' : 'Update Karma'}
              </Button>
            </div>
          </div>
          <p className="break-words text-muted-foreground">
            View tasker performance and verification
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="relative min-w-0 flex-1 md:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, or Reddit username"
              className="pl-10"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <p>Loading...</p>
        ) : filteredWorkers.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredWorkers.map((worker: any) => (
              <div
                key={worker.id}
                className="stoic-card flex h-full min-w-0 flex-col overflow-hidden p-6"
              >
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/20">
                    <span className="text-lg font-medium">
                      {worker.full_name?.charAt(0) || worker.email.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words font-semibold">
                      {worker.full_name || 'Unnamed'}
                    </h3>
                    <p className="flex min-w-0 items-start gap-1 text-sm text-muted-foreground">
                      <Mail className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="break-all">{worker.email}</span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 min-w-0 space-y-1 text-sm">
                  <div className="break-words">
                    League: <LeagueBadge league={worker.league} showLabel />
                  </div>
                  <div className="break-words">
                    Account:{' '}
                    <span className={worker.is_banned ? 'text-red-600' : 'text-green-600'}>
                      {worker.is_banned ? 'Banned' : 'Active'}
                    </span>
                  </div>
                  {worker.banned_reason ? (
                    <div className="break-words text-xs text-muted-foreground">
                      Ban reason: {worker.banned_reason}
                    </div>
                  ) : null}
                  <div className="break-words">Earnings: Rs {worker.totalOwed.toFixed(2)}</div>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="text-sm font-semibold">Reddit Accounts</div>
                  {(worker.redditAccounts || []).length === 0 ? (
                    <div className="text-xs text-muted-foreground">No accounts added yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {(worker.redditAccounts || []).map((account: RedditAccountRow) => (
                        <div key={account.id} className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold">u/{account.reddit_username}</div>
                            <div
                              className={
                                getAccountStatus(account) === 'Verified'
                                  ? 'text-green-600'
                                  : getAccountStatus(account) === 'Rejected'
                                    ? 'text-red-600'
                                    : 'text-yellow-600'
                              }
                            >
                              {getAccountStatus(account)}
                            </div>
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            Karma: {account.karma ?? account.karma_range ?? '-'} | CQS: {account.cqs ?? '-'}
                          </div>
                          {getAccountStatus(account) === 'Rejected' && (
                            <div className="mt-2 text-xs text-red-600">
                              Rejection reason: {getRejectionReason(account) || 'No reason provided'}
                            </div>
                          )}
                          {account.cqs_proof ? (
                            <a
                              href={account.cqs_proof}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-2 text-primary hover:underline"
                            >
                              <span>Open CQS proof</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                          {account.reddit_profile ? (
                            <a
                              href={account.reddit_profile}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-2 text-primary hover:underline"
                            >
                              <span>Open profile</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                          {!account.is_verified && (
                            <div className="mt-2 space-y-2">
                              <Button
                                size="sm"
                                className="w-full"
                                onClick={() => verifyAccountMutation.mutate(account)}
                              >
                                Verify Account
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full text-red-600"
                                onClick={() => {
                                  setSelectedAccount(account);
                                  setRejectReason(getRejectionReason(account));
                                  setRejectDialogOpen(true);
                                }}
                              >
                                Reject Account
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {(userRole === 'admin' || userRole === 'owner') && (
                  <div className="mt-4">
                    <Button
                      size="sm"
                      variant={worker.is_banned ? 'outline' : 'destructive'}
                      className="w-full min-w-0 whitespace-normal break-words"
                      onClick={() =>
                        banMutation.mutate({
                          userId: worker.user_id,
                          isBanned: !worker.is_banned,
                        })
                      }
                      disabled={banMutation.isPending}
                    >
                      {worker.is_banned ? 'Unban Tasker' : 'Ban Tasker'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center">
            <Users className="mx-auto h-12 w-12 text-gray-400" />
            <p>{workers && workers.length > 0 ? 'No taskers match the current filters.' : 'No taskers yet'}</p>
          </div>
        )}
      </div>

      <Dialog
        open={rejectDialogOpen}
        onOpenChange={(open) => {
          setRejectDialogOpen(open);
          if (!open) {
            setRejectReason('');
            setSelectedAccount(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Reddit Account</DialogTitle>
            <DialogDescription className="sr-only">
              Provide a reason for rejecting this Reddit account.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for rejecting this Reddit account"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <Button
            className="mt-3"
            onClick={() => {
              if (!selectedAccount) return;
              if (!rejectReason.trim()) {
                toast({
                  title: 'Rejection reason required',
                  description: 'Please provide a reason for rejecting this account.',
                  variant: 'destructive',
                });
                return;
              }
              rejectAccountMutation.mutate({
                account: selectedAccount,
                reason: rejectReason,
              });
            }}
            disabled={rejectAccountMutation.isPending}
          >
            Confirm Rejection
          </Button>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminWorkers;

