import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ClipboardList, Copy, ExternalLink, Clock, Upload, Sparkles, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSearchParams } from 'react-router-dom';
import { sendTaskStatusDiscord } from '@/lib/taskDiscord';
import {
  compressImageForUpload,
  getUploadFileExtension,
  IMAGE_UPLOAD_PRESETS,
} from '@/lib/imageUpload';
import { toStorageObjectValue } from '@/lib/storagePaths';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const getStatusBadge = (status: string, paymentStatus: string) => {
  if (paymentStatus === 'paid') {
    return <Badge className="bg-green-500/20 text-green-400">Paid</Badge>;
  }

  if (paymentStatus === 'failed' || paymentStatus === 'cancelled') {
    return (
      <Badge className="bg-red-500/20 text-red-400">
        Payment Failed
      </Badge>
    );
  }

  if (status === 'completed') {
    return (
      <Badge className="bg-orange-500/20 text-orange-400">
        Payment Pending
      </Badge>
    );
  }

  if (status === 'submitted') {
    return (
      <Badge className="bg-yellow-500/20 text-yellow-400">
        Under Verification
      </Badge>
    );
  }

  if (status === 'in_progress') {
    return (
      <Badge className="bg-blue-500/20 text-blue-400">
        In Progress
      </Badge>
    );
  }

  if (status === 'pending') {
    return (
      <Badge className="bg-amber-500/20 text-amber-400">
        Claimed
      </Badge>
    );
  }

  if (status === 'cancelled') {
    return (
      <Badge className="bg-red-500/20 text-red-400">
        Failed
      </Badge>
    );
  }

  return <Badge>Unknown</Badge>;
};

const TIMELINE_STEPS = [
  'Claimed',
  'Submit task',
  'Manual review',
  'Approved',
  'Settlement successful',
] as const;

const getTimelineStepIndex = (status: string, paymentStatus: string) => {
  if (paymentStatus === 'paid') return 4;
  if (status === 'completed') return 3;
  if (status === 'submitted') return 2;
  if (status === 'in_progress') return 1;
  return 0;
};

const formatDeadline = (assignment: any) => {
  const startedAt = assignment?.started_at ? new Date(assignment.started_at).getTime() : NaN;
  if (!Number.isFinite(startedAt)) return 'Not started';

  const deadline = new Date(
    startedAt + (assignment.tasks?.task_completion_time || 60) * 60 * 1000
  );

  return deadline.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const MyTasksPage: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [commentLink, setCommentLink] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const highlightedTaskId = searchParams.get('task');

  const { data: assignments, isLoading } = useQuery({
    queryKey: ['worker-my-tasks', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_assignments')
        .select(`
          id,
          task_id,
          user_id,
          reddit_account_id,
          amount,
          status,
          payment_status,
          started_at,
          submitted_at,
          created_at,
          reddit_accounts (
            id,
            reddit_username,
            is_verified,
            karma,
            karma_range,
            cqs
          ),
          tasks (
            id,
            title,
            instruction,
            content,
            subreddit_flair,
            target_link,
            amount,
            task_completion_time
          )
        `)
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const channel = supabase
      .channel(`worker-my-tasks:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_assignments',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['worker-my-tasks', user.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, user?.id]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied',
      description: 'Content copied to clipboard',
    });
  };

  const getRemainingTime = (assignment: any) => {
    if (assignment.status !== 'in_progress') return null;

    const started = new Date(assignment.started_at).getTime();
    const limit =
      started +
      (assignment.tasks?.task_completion_time || 60) * 60 * 1000;

    const remaining = limit - now;

    if (remaining <= 0) return 'Waiting for system update...';

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    return `${minutes}m ${seconds}s left`;
  };

  useEffect(() => {
    const hasActiveCountdown = (assignments || []).some(
      (assignment: any) => assignment.status === 'in_progress'
    );

    if (!hasActiveCountdown) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [assignments]);

  useEffect(() => {
    if (!highlightedTaskId || isLoading || !(assignments || []).length) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const element = document.getElementById(`worker-my-task-${highlightedTaskId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [assignments, highlightedTaskId, isLoading]);

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTask || !user) throw new Error('Missing data');
      if (!commentLink) throw new Error('Comment link required');
      if (!screenshot) throw new Error('Screenshot required');

      const optimizedScreenshot = await compressImageForUpload(
        screenshot,
        IMAGE_UPLOAD_PRESETS.screenshot
      );
      const fileExt = getUploadFileExtension(optimizedScreenshot);
      const screenshotPath = `${selectedTask.task_id}/${user.id}/${Date.now()}.${fileExt}`;
      const screenshotValue = toStorageObjectValue('task-submissions', screenshotPath);

      try {
        const { error: uploadError } = await supabase.storage
          .from('task-submissions')
          .upload(screenshotPath, optimizedScreenshot);

        if (uploadError) throw uploadError;

        const { error: submissionError } = await (supabase as any).rpc(
          'submit_task_submission',
          {
            p_task_id: selectedTask.task_id,
            p_submission_links: [commentLink],
            p_screenshot_urls: [screenshotValue],
            p_submission_notes: null,
          }
        );

        if (submissionError) throw submissionError;
        await sendTaskStatusDiscord(selectedTask.id);
      } catch (error) {
        await supabase.storage
          .from('task-submissions')
          .remove([screenshotPath]);

        throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: 'Submitted',
        description: 'Task submitted successfully.',
      });
      setDialogOpen(false);
      setCommentLink('');
      setScreenshot(null);
      queryClient.invalidateQueries();
    },
    onError: (err: any) => {
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const cancelTaskMutation = useMutation({
    mutationFn: async (assignment: any) => {
      const { error } = await supabase
        .from('task_assignments')
        .delete()
        .eq('id', assignment.id)
        .eq('user_id', user?.id);

      if (error) throw error;

      await supabase.from('activity_logs').insert({
        user_id: user?.id,
        action: 'task_claim_cancelled',
        entity_type: 'task',
        entity_id: assignment.task_id,
        details: {
          assignment_id: assignment.id,
          task_title: assignment.tasks?.title || null,
        },
      });
    },
    onSuccess: () => {
      toast({
        title: 'Task cancelled',
        description: 'The task is available again for other taskers.',
      });
      queryClient.invalidateQueries();
    },
    onError: (err: any) => {
      toast({
        title: 'Could not cancel task',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const copyTaskLink = async (taskId: string) => {
    const url = `${window.location.origin}/worker/task/${taskId}`;
    await navigator.clipboard.writeText(url);
    toast({
      title: 'Task link copied',
      description: 'Share this direct link to the claimed task.',
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="dashboard-hero">
          <div className="relative z-10 max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Claimed work
            </div>
            <div>
              <h1 className="text-3xl font-bold sm:text-4xl">My Tasks</h1>
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                Your claimed tasks show the full instruction set, content, submission flow, and timing exactly where you need it.
              </p>
            </div>
          </div>
        </section>

        {isLoading ? (
          <p>Loading...</p>
        ) : assignments && assignments.length > 0 ? (
          <div className="space-y-4">
            {assignments.map((a: any) => {
              const remaining = getRemainingTime(a);
              const timelineStepIndex = getTimelineStepIndex(a.status, a.payment_status);
              const progressCount = a.status === 'cancelled' ? 0 : timelineStepIndex + 1;
              const progressPercent =
                a.status === 'cancelled'
                  ? 0
                  : (progressCount / TIMELINE_STEPS.length) * 100;
              const isPaid = a.payment_status === 'paid';

              return (
                <Card
                  id={`worker-my-task-${a.tasks?.id}`}
                  key={a.id}
                  className={[
                    'stoic-card border-border/70 p-6',
                    highlightedTaskId === a.tasks?.id
                      ? 'border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.6),0_24px_60px_hsl(var(--primary)/0.18)]'
                      : '',
                  ].join(' ')}
                >
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Task ID</p>
                          <p className="mt-1 text-xl font-semibold">{a.tasks?.id}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Reddit Account</p>
                          <p className="mt-1 text-xl font-semibold">
                            {a.reddit_accounts?.reddit_username ? `u/${a.reddit_accounts.reddit_username}` : '-'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Deadline</p>
                          <p className="mt-1 text-xl font-semibold">{formatDeadline(a)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Status</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {getStatusBadge(a.status, a.payment_status)}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Payout</p>
                          <div className="mt-2 flex flex-wrap gap-2 items-center">
                            <Badge variant="outline">Rs {a.amount || a.tasks?.amount || 0}</Badge>
                            {remaining && (
                              <Badge className="bg-blue-500/10 text-blue-400">
                                <Clock className="h-3 w-3 mr-1" />
                                {remaining}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      {a.tasks?.subreddit_flair && (
                        <div>
                          <p className="text-sm font-medium mb-2">Subreddit Flair</p>
                          <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
                            {a.tasks.subreddit_flair}
                          </div>
                        </div>
                      )}

                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2 justify-between">
                          <p className="text-sm font-medium">Title</p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => copyTaskLink(a.tasks?.id)}
                          >
                            <Copy className="h-4 w-4 mr-1" />
                            Copy Link
                          </Button>
                        </div>
                        <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-base font-medium">
                          {a.tasks?.title}
                        </div>
                      </div>

                      {a.tasks?.instruction && (
                        <div>
                          <p className="text-sm font-medium mb-2">Instruction</p>
                          <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm whitespace-pre-wrap">
                            {a.tasks.instruction}
                          </div>
                        </div>
                      )}

                      {a.tasks?.content && (
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <p className="text-sm font-medium">Content</p>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copyToClipboard(a.tasks.content)}
                            >
                              <Copy className="h-4 w-4 mr-1" />
                              Copy
                            </Button>
                          </div>
                          <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm whitespace-pre-wrap">
                            {a.tasks.content}
                          </div>
                        </div>
                      )}

                      {a.tasks?.target_link && (
                        <a
                          href={a.tasks.target_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-500 text-sm"
                        >
                          Open Target Link
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}

                      {a.status === 'in_progress' && (
                        <div className="flex flex-wrap gap-3">
                          <Button
                            onClick={() => {
                              setSelectedTask(a);
                              setDialogOpen(true);
                            }}
                            className="bg-green-600 hover:bg-green-700 text-white"
                          >
                            Submit Task
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="border-red-500/30 text-red-500 hover:bg-red-500/10"
                            disabled={cancelTaskMutation.isPending}
                            onClick={() => {
                              if (window.confirm('Cancel this task and return it to the available pool?')) {
                                cancelTaskMutation.mutate(a);
                              }
                            }}
                          >
                            {cancelTaskMutation.isPending ? 'Cancelling...' : 'Cancel Task'}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="rounded-[28px] border border-primary/30 bg-primary/[0.04] p-6">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-xl font-semibold">Timeline Progress</h3>
                        {a.status === 'cancelled' ? (
                          <Badge className="bg-red-500/15 text-red-400">Failed</Badge>
                        ) : (
                          <Badge className="bg-primary/15 text-primary">
                            {TIMELINE_STEPS[Math.max(timelineStepIndex, 0)]}
                          </Badge>
                        )}
                      </div>

                      <div className="mt-6 space-y-4">
                        {TIMELINE_STEPS.map((step, index) => {
                          const complete =
                            a.status !== 'cancelled' &&
                            (index < timelineStepIndex || (isPaid && index === timelineStepIndex));
                          const current =
                            a.status !== 'cancelled' &&
                            !isPaid &&
                            index === timelineStepIndex;

                          return (
                            <div key={step} className="flex items-start gap-4">
                              <div className="flex flex-col items-center">
                                <div
                                  className={[
                                    'flex h-8 w-8 items-center justify-center rounded-full border text-xs',
                                    complete
                                      ? 'border-primary bg-primary/15 text-primary'
                                      : 'border-border text-muted-foreground',
                                  ].join(' ')}
                                >
                                  {complete ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                                </div>
                                {index < TIMELINE_STEPS.length - 1 && (
                                  <div
                                    className={[
                                      'mt-2 h-7 w-px',
                                      a.status !== 'cancelled' && index < progressCount - 1
                                        ? 'bg-primary/60'
                                        : 'bg-border',
                                    ].join(' ')}
                                  />
                                )}
                              </div>
                              <div className="pt-1">
                                <p className={current ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                                  {step}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-6 border-t border-border pt-5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Progress</span>
                          <span className="font-semibold">
                            {a.status === 'cancelled' ? '0' : progressCount} of {TIMELINE_STEPS.length}
                          </span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className={[
                              'h-full rounded-full',
                              a.status === 'cancelled' ? 'bg-red-500/70' : 'bg-primary',
                            ].join(' ')}
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            <ClipboardList className="mx-auto h-12 w-12 text-gray-400" />
            <p className="text-muted-foreground mt-2">
              You have not started any tasks yet.
            </p>
          </div>
        )}
      </div>

      {/* Submit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Task</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              placeholder="Comment link"
              value={commentLink}
              onChange={(e) => setCommentLink(e.target.value)}
            />

            <Input
              type="file"
              accept="image/*"
              onChange={(e) =>
                setScreenshot(e.target.files?.[0] || null)
              }
            />

            <Button
              onClick={() => submitMutation.mutate()}
              className="w-full"
              disabled={submitMutation.isPending}
            >
              <Upload className="h-4 w-4 mr-2" />
              {submitMutation.isPending ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default MyTasksPage;
