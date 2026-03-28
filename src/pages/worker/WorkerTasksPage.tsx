import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TaskCard } from '@/components/tasks/TaskCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ClipboardList, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES, useTaskClaimSettings } from '@/hooks/useTaskClaimSettings';
import { formatCooldownRemaining, getClaimCooldownRemainingMs, getLatestClaimStartedAt } from '@/lib/taskClaimCooldown';
import { formatMinimumCqsRequirement } from '@/lib/taskEligibility';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import {
  getAccountLeague,
  getSortedRedditAccounts,
  isAccountEligibleForTask,
  RedditAccount,
} from '@/lib/redditAccounts';
import { sendTaskClaimedDiscord } from '@/lib/taskDiscord';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { LeagueBadge } from '@/components/badges/LeagueBadge';
import { LEAGUE_LABELS } from '@/lib/workerLeagues';

const TASKS_PAGE_SIZE = 20;
const ACTIVE_ASSIGNMENT_STATUSES = ['pending', 'in_progress', 'submitted'] as const;

const WorkerTasksPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: taskClaimSettings } = useTaskClaimSettings();
  const [now, setNow] = useState(() => Date.now());
  const highlightedTaskId = searchParams.get('task');

  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [claimTask, setClaimTask] = useState<any | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState('');

  const { data: redditAccounts } = useQuery({
    queryKey: ['reddit-accounts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reddit_accounts')
        .select('id, user_id, reddit_username, reddit_profile, is_verified, karma, karma_range, cqs, avatar_url, created_at')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as RedditAccount[];
    },
    enabled: !!user?.id,
  });

  // Get all tasks
  const {
    data: tasksPages,
    isLoading: tasksLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['all-tasks', searchQuery],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * TASKS_PAGE_SIZE;
      const to = from + TASKS_PAGE_SIZE - 1;
      let query = supabase
        .from('tasks')
        .select('*, categories(id, name, claim_cooldown_minutes)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (searchQuery.trim()) {
        query = query.ilike('title', `%${searchQuery.trim()}%`);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < TASKS_PAGE_SIZE ? undefined : allPages.length,
    initialPageParam: 0,
    refetchOnWindowFocus: true,
  });

  // Get all assignments
  const { data: assignments } = useQuery({
    queryKey: ['assignments', user?.id],
    queryFn: async () => {
      if (!user?.id) {
        return [];
      }

      const assignmentColumns = 'task_id,user_id,status,started_at';
      const userAssignmentColumns =
        'task_id,user_id,status,started_at,task:tasks(category_id,categories(claim_cooldown_minutes))';
      const [activeAssignmentsResult, userAssignmentsResult] = await Promise.all([
        supabase
          .from('task_assignments')
          .select(assignmentColumns)
          .in('status', [...ACTIVE_ASSIGNMENT_STATUSES]),
        supabase
          .from('task_assignments')
          .select(userAssignmentColumns)
          .eq('user_id', user.id),
      ]);

      const { data: activeAssignments, error: activeAssignmentsError } = activeAssignmentsResult;
      const { data: userAssignments, error: userAssignmentsError } = userAssignmentsResult;

      if (activeAssignmentsError) throw activeAssignmentsError;
      if (userAssignmentsError) throw userAssignmentsError;

      const mergedAssignments = new Map<string, any>();

      for (const assignment of [...(activeAssignments || []), ...(userAssignments || [])]) {
        const key = `${assignment.task_id}:${assignment.user_id}:${assignment.status}:${assignment.started_at || ''}`;
        mergedAssignments.set(key, assignment);
      }

      return Array.from(mergedAssignments.values());
    },
    enabled: !!user?.id,
    refetchOnWindowFocus: true,
  });

  const defaultClaimCooldownMinutes =
    taskClaimSettings?.claim_cooldown_minutes ?? DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES;

  useEffect(() => {
    if (!(assignments || []).length) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [assignments]);

  // Start task
  const startTaskMutation = useMutation({
    mutationFn: async ({
      task,
      redditAccountId,
    }: {
      task: any;
      redditAccountId: string;
    }) => {
      if (!user) throw new Error('Not logged in');

      const categoryCooldownMinutes =
        task?.categories?.claim_cooldown_minutes ?? defaultClaimCooldownMinutes;
      const latestStartedAt = getLatestClaimStartedAt(assignments, user.id, task.category_id);
      const remainingMs = getClaimCooldownRemainingMs(
        latestStartedAt,
        categoryCooldownMinutes
      );

      if (remainingMs > 0) {
        throw new Error(
          `Claim cooldown active. You can claim another task in ${formatCooldownRemaining(remainingMs)}.`
        );
      }

      const account = (redditAccounts || []).find((a) => a.id === redditAccountId);
      if (!account) {
        throw new Error('Select a Reddit account to claim this task.');
      }

      if (!isAccountEligibleForTask(account, task)) {
        throw new Error('Selected Reddit account is not eligible for this task.');
      }

      // check if task already taken
      const active = assignments?.find(
        (a: any) =>
          a.task_id === task.id &&
          ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)
      );

      if (active) {
        throw new Error('Already claimed by another tasker');
      }

      // check if worker already attempted
      const attempted = assignments?.find(
        (a: any) =>
          a.task_id === task.id &&
          a.user_id === user.id
      );

      if (attempted) {
        throw new Error('You already attempted this task');
      }

      const { data: assignmentId, error } = await (supabase as any).rpc(
        'claim_task',
        {
          p_task_id: task.id,
          p_reddit_account_id: account.id,
        }
      );

      if (error) {
        const message = error.message?.toLowerCase?.() || '';
        if (error.code === '23505' || message.includes('already been claimed')) {
          throw new Error('Already claimed by another tasker');
        }
        throw error;
      }

      return {
        id: typeof assignmentId === 'string' ? assignmentId : null,
      };
    },
    onSuccess: async (assignment: any) => {
      queryClient.invalidateQueries();
      setClaimDialogOpen(false);
      setClaimTask(null);
      setSelectedAccountId('');
      if (assignment?.id) {
        await sendTaskClaimedDiscord(assignment.id);
      }
      toast({
        title: 'Task started',
        description: 'Opening My Tasks so you can complete it.',
      });
      navigate('/worker/my-tasks');
    },
    onError: (err: any) => {
      const message = err?.message?.toLowerCase?.() || '';
      if (message.includes('already claimed')) {
        queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['assignments'] });
      }
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const tasks = tasksPages?.pages.flat() || [];

  const accountMeta = useMemo(() => {
    const list = redditAccounts || [];
    return {
      hasAccounts: list.length > 0,
      hasVerified: list.some((a) => a.is_verified),
    };
  }, [redditAccounts]);

  const enrichedTasks = tasks.map((task: any) => {
    const categoryCooldownMinutes =
      task?.categories?.claim_cooldown_minutes ?? defaultClaimCooldownMinutes;
    const latestCategoryClaimStartedAt = getLatestClaimStartedAt(
      assignments,
      user?.id,
      task.category_id
    );
    const claimCooldownRemainingMs = getClaimCooldownRemainingMs(
      latestCategoryClaimStartedAt,
      categoryCooldownMinutes,
      now
    );
    const isClaimCooldownActive = claimCooldownRemainingMs > 0;
    const activeAssignment = assignments?.find(
      (a: any) =>
        a.task_id === task.id &&
        ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)
    );

    const workerAttempt = assignments?.find(
      (a: any) =>
        a.task_id === task.id &&
        a.user_id === user?.id
    );

    const eligibleAccounts = getSortedRedditAccounts(
      (redditAccounts || []).filter((account) => isAccountEligibleForTask(account, task))
    );

    const reasons: string[] = [];

    if (!accountMeta.hasAccounts) {
      reasons.push('Add a verified Reddit account to claim tasks');
    } else if (!accountMeta.hasVerified) {
      reasons.push('No verified Reddit account yet');
    } else if (eligibleAccounts.length === 0) {
      reasons.push('No eligible Reddit account for this task');
    }

    if (eligibleAccounts.length === 0 && accountMeta.hasVerified) {
      if (task.minimum_karma) {
        reasons.push(`Requires ${task.minimum_karma}+ karma`);
      }

      if (task.cqs_levels && task.cqs_levels.length > 0) {
        reasons.push(`Requires CQS: ${formatMinimumCqsRequirement(task.cqs_levels) || task.cqs_levels.join(', ')}`);
      }
    }

    if (activeAssignment && activeAssignment.user_id !== user?.id) {
      reasons.push('Already claimed by another tasker');
    }

    if (workerAttempt) {
      reasons.push('You already attempted this task');
    }

    if (isClaimCooldownActive && !workerAttempt) {
      reasons.push(
        `Claim cooldown active: ${formatCooldownRemaining(claimCooldownRemainingMs)} remaining`
      );
    }

    return {
      ...task,
      categoryCooldownMinutes,
      claimCooldownRemainingMs,
      activeAssignment,
      eligibleAccounts,
      locked: reasons.length > 0,
      lockReasons: reasons,
    };
  }).filter((task: any) => !task.activeAssignment || task.activeAssignment.user_id === user?.id);

  useEffect(() => {
    if (!highlightedTaskId || tasksLoading || enrichedTasks.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const element = document.getElementById(`worker-available-task-${highlightedTaskId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [enrichedTasks.length, highlightedTaskId, tasksLoading]);

  const copyTaskLink = async (taskId: string) => {
    const url = `${window.location.origin}/worker/task/${taskId}`;
    await navigator.clipboard.writeText(url);
    toast({
      title: 'Task link copied',
      description: 'Share this direct link to the task.',
    });
  };

  const sentinelRef = useInfiniteScroll({
    enabled: true,
    hasMore: !!hasNextPage,
    isLoading: tasksLoading || isFetchingNextPage,
    onLoadMore: () => {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
  });

  const handleStartTask = (task: any) => {
    const eligible = task?.eligibleAccounts || [];
    if (!eligible.length) {
      toast({
        title: 'No eligible Reddit account',
        description: 'Add and verify a Reddit account that meets this task requirement.',
        variant: 'destructive',
      });
      return;
    }

    setClaimTask(task);
    setSelectedAccountId(eligible[0].id);
    setClaimDialogOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="dashboard-hero">
          <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Task marketplace
              </div>
              <div>
                <h1 className="text-3xl font-bold sm:text-4xl">Available Tasks</h1>
                <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                  Browse claimable work here. Task content stays hidden until you claim a task, then the full details appear in My Tasks.
                </p>
              </div>
            </div>

            <div className="glass-panel max-w-md px-4 py-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                <span>Details are protected before claim to keep task delivery cleaner and prevent accidental copy exposure.</span>
              </div>
            </div>
          </div>
        </section>

        <div className="glass-panel p-4 sm:p-5">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="pl-10"
            />
          </div>
        </div>

        {tasksLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="grid gap-4">
            {enrichedTasks.map((task: any) => (
            <TaskCard
              key={task.id}
              task={task}
              highlighted={highlightedTaskId === task.id}
              containerId={`worker-available-task-${task.id}`}
              locked={task.locked}
              lockReasons={task.lockReasons}
              onStart={() => handleStartTask(task)}
              onCopyLink={() => copyTaskLink(task.id)}
              showDetails={false}
              startLabel="Claim Task"
            />
            ))}
          </div>
        )}

        {!tasksLoading && enrichedTasks.length === 0 && (
          <div className="py-12 text-center">
            <ClipboardList className="mx-auto h-12 w-12 text-gray-400" />
            {searchQuery.trim() ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No tasks matched your search right now.
              </p>
            ) : (
              <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground sm:text-base">
                Hang tight! There are currently no tasks to claim. We&apos;ll notify you on Discord and through our website notifications if you have them enabled as soon as new tasks have been added.
              </p>
            )}
          </div>
        )}

        {enrichedTasks.length > 0 && (
          <div ref={sentinelRef} className="py-4 text-center text-sm text-muted-foreground">
            {isFetchingNextPage
              ? 'Loading more tasks...'
              : hasNextPage
                ? 'Scroll to load more'
                : 'You have reached the oldest tasks'}
          </div>
        )}
      </div>

      <Dialog open={claimDialogOpen} onOpenChange={setClaimDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Select Reddit Account</DialogTitle>
            <DialogDescription>
              Choose which verified Reddit account you will use to complete this task.
            </DialogDescription>
          </DialogHeader>

          {claimTask ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                <div className="font-semibold">{claimTask.title}</div>
                {claimTask.subreddit_flair && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    r/{claimTask.subreddit_flair}
                  </div>
                )}
                <div className="mt-2 text-xs text-muted-foreground">
                  Category cooldown: {claimTask.categoryCooldownMinutes} min
                </div>
                {claimTask.claimCooldownRemainingMs > 0 && (
                  <div className="mt-2 text-xs text-destructive">
                    You can claim another task from this category in {formatCooldownRemaining(claimTask.claimCooldownRemainingMs)}.
                  </div>
                )}
              </div>

              <RadioGroup
                value={selectedAccountId}
                onValueChange={setSelectedAccountId}
                className="space-y-3"
              >
                {(claimTask.eligibleAccounts || []).map((account: RedditAccount) => (
                  <Label
                    key={account.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card/70 p-3"
                  >
                    <RadioGroupItem value={account.id} className="mt-1" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">u/{account.reddit_username}</span>
                        {account.is_verified ? (
                          <Badge variant="outline">Verified</Badge>
                        ) : (
                          <Badge variant="outline">Pending</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Karma: {account.karma ?? account.karma_range ?? '-'} | CQS: {account.cqs ?? '-'}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <LeagueBadge league={getAccountLeague(account)} />
                        <span>{LEAGUE_LABELS[getAccountLeague(account)]}</span>
                      </div>
                    </div>
                  </Label>
                ))}
              </RadioGroup>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setClaimDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 stoic-button-primary"
                  disabled={!selectedAccountId || startTaskMutation.isPending || claimTask.claimCooldownRemainingMs > 0}
                  onClick={() => {
                    if (!claimTask || !selectedAccountId) return;
                    startTaskMutation.mutate({ task: claimTask, redditAccountId: selectedAccountId });
                  }}
                >
                  {startTaskMutation.isPending ? 'Claiming...' : 'Confirm Claim'}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default WorkerTasksPage;

