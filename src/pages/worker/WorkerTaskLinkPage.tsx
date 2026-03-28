import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getBestEligibleRedditAccount, isAccountEligibleForTask, RedditAccount } from '@/lib/redditAccounts';
import { getClaimCooldownRemainingMs, getLatestClaimStartedAt } from '@/lib/taskClaimCooldown';
import { sendTaskClaimedDiscord } from '@/lib/taskDiscord';
import { DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES, useTaskClaimSettings } from '@/hooks/useTaskClaimSettings';

const WorkerTaskLinkPage: React.FC = () => {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: taskClaimSettings } = useTaskClaimSettings();
  const [autoClaimState, setAutoClaimState] = React.useState<'idle' | 'claiming' | 'failed'>('idle');
  const [autoClaimError, setAutoClaimError] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['worker-task-link', taskId, user?.id],
    queryFn: async () => {
      if (!taskId || !user?.id) {
        return null;
      }

      const [
        { data: task, error: taskError },
        { data: myAssignments, error: myAssignmentsError },
        { data: activeAssignments, error: activeAssignmentsError },
        { data: userAssignments, error: userAssignmentsError },
        { data: redditAccounts, error: redditAccountsError },
      ] = await Promise.all([
          supabase
            .from('tasks')
            .select('id, title, status, task_type, minimum_karma, cqs_levels, category_id, categories(claim_cooldown_minutes)')
            .eq('id', taskId)
            .maybeSingle(),
          supabase
            .from('task_assignments')
            .select('id, status, user_id, created_at, started_at')
            .eq('task_id', taskId)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('task_assignments')
            .select('id, status, user_id, created_at, started_at')
            .eq('task_id', taskId)
            .in('status', ['pending', 'in_progress', 'submitted'])
            .order('created_at', { ascending: false }),
          supabase
            .from('task_assignments')
            .select('id, status, user_id, created_at, started_at, task:tasks(category_id)')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(50),
          supabase
            .from('reddit_accounts')
            .select('id, user_id, reddit_username, reddit_profile, is_verified, karma, karma_range, cqs, avatar_url, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
        ]);

      if (taskError) throw taskError;
      if (myAssignmentsError) throw myAssignmentsError;
      if (activeAssignmentsError) throw activeAssignmentsError;
      if (userAssignmentsError) throw userAssignmentsError;
      if (redditAccountsError) throw redditAccountsError;

      return {
        task,
        myAssignments: myAssignments || [],
        activeAssignments: activeAssignments || [],
        userAssignments: userAssignments || [],
        redditAccounts: (redditAccounts || []) as RedditAccount[],
      };
    },
    enabled: !!taskId && !!user?.id,
  });

  React.useEffect(() => {
    if (isLoading || !taskId || !data) {
      return;
    }

    const latestMyAssignment = data.myAssignments[0];
    const activeAssignment = data.activeAssignments[0];

    if (latestMyAssignment) {
      navigate(`/worker/my-tasks?task=${taskId}`, { replace: true });
      return;
    }

    if (data.task?.status === 'pending' && !activeAssignment && autoClaimState === 'idle') {
      const eligibleAccounts = (data.redditAccounts || []).filter((account) =>
        isAccountEligibleForTask(account, data.task)
      );

      if (eligibleAccounts.length === 1) {
        const account = getBestEligibleRedditAccount(eligibleAccounts, data.task);
        if (!account) {
          setAutoClaimState('failed');
          setAutoClaimError('No eligible Reddit account found.');
          return;
        }
        const claimCooldownMinutes =
          data.task?.categories?.claim_cooldown_minutes ??
          taskClaimSettings?.claim_cooldown_minutes ??
          DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES;
        const latestStartedAt = getLatestClaimStartedAt(
          data.userAssignments,
          user?.id,
          data.task?.category_id
        );
        const remainingMs = getClaimCooldownRemainingMs(latestStartedAt, claimCooldownMinutes);

        if (remainingMs > 0) {
          setAutoClaimState('failed');
          setAutoClaimError('Claim cooldown active. Try again later.');
          return;
        }

        setAutoClaimState('claiming');
        setAutoClaimError(null);

        (async () => {
          try {
            const { data: assignmentId, error } = await (supabase as any).rpc(
              'claim_task',
              {
                p_task_id: data.task.id,
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

            if (typeof assignmentId === 'string' && assignmentId) {
              await sendTaskClaimedDiscord(assignmentId);
            }

            navigate(`/worker/my-tasks?task=${taskId}`, { replace: true });
          } catch (err: any) {
            setAutoClaimState('failed');
            setAutoClaimError(err?.message || 'Auto-claim failed');
          }
        })();

        return;
      }

      navigate(`/worker/tasks?task=${taskId}`, { replace: true });
    }
  }, [autoClaimState, data, isLoading, navigate, taskClaimSettings, taskId, user?.id]);

  if (isLoading || autoClaimState === 'claiming') {
    return (
      <DashboardLayout>
        <div className="p-8 text-center">
          {autoClaimState === 'claiming' ? 'Claiming task automatically...' : 'Resolving task link...'}
        </div>
      </DashboardLayout>
    );
  }

  const task = data?.task;
  const latestMyAssignment = data?.myAssignments?.[0];
  const activeAssignment = data?.activeAssignments?.[0];

  let title = 'Task unavailable';
  let description = 'This task link is not available right now.';

  if (!task) {
    title = 'Task not found';
    description = 'This task may have been deleted or the link is invalid.';
  } else if (autoClaimState === 'failed') {
    title = 'Auto-claim not available';
    description = autoClaimError || 'This task could not be auto-claimed.';
  } else if (latestMyAssignment) {
    title = 'Opening your task';
    description = 'You already have access to this task in My Tasks.';
  } else if (activeAssignment && activeAssignment.user_id !== user?.id) {
    title = 'Task already claimed';
    description = 'Another tasker has already claimed this task, so it is no longer available.';
  } else if (task.status !== 'pending') {
    title = 'Task no longer available';
    description = 'This task is no longer in the available pool.';
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl py-12">
        <Card className="stoic-card p-8 text-center space-y-4">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => navigate('/worker/tasks')}>
              Available Tasks
            </Button>
            <Button onClick={() => navigate('/worker/my-tasks')}>
              My Tasks
            </Button>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default WorkerTaskLinkPage;
