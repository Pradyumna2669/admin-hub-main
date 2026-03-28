import React, { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { getStorageObjectRef } from '@/lib/storagePaths';
import { ExternalLink, Search } from 'lucide-react';
import {
  DEFAULT_TASK_TYPE_REMOVAL_RATES_INR_BY_LEAGUE,
  DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE,
  normalizeTaskType,
} from '@/lib/taskTypes';
import { computeLeagueFromProfile, normalizeLeague } from '@/lib/workerLeagues';
import { sendTaskStatusDiscord } from '@/lib/taskDiscord';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';

const SUBMISSIONS_PAGE_SIZE = 20;

interface TaskSubmission {
  id: string;
  task_id: string;
  user_id: string;
  reddit_account_id?: string | null;
  submission_links: string[];
  screenshot_urls: string[];
  submission_notes?: string;
  submitted_at: string;
  status: 'pending' | 'verified' | 'rejected';
  admin_notes?: string;
  task?: {
    id: string;
    title: string;
    created_by?: string | null;
    task_type?: string;
    amount?: number;
    instruction?: string | null;
    content?: string | null;
    target_link?: string | null;
    subreddit_flair?: string | null;
    category_id?: string | null;
  };
  worker?: {
    id: string;
    email?: string;
    full_name?: string;
    karma?: number | null;
    karma_range?: string | null;
    cqs?: string | null;
    league?: string | null;
  };
  redditAccount?: {
    id: string;
    reddit_username?: string | null;
    karma?: number | null;
    karma_range?: string | null;
    cqs?: string | null;
  };
}

type StaffOption = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

const AdminVerification: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedSubmission, setSelectedSubmission] =
    useState<TaskSubmission | null>(null);
  const [verificationDialogOpen, setVerificationDialogOpen] = useState(false);
  const [verificationNotes, setVerificationNotes] = useState('');
  const [verificationAction, setVerificationAction] =
    useState<'verified' | 'rejected' | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewImageTitle, setPreviewImageTitle] = useState('');
  const [previewImageOpen, setPreviewImageOpen] = useState(false);
  const [previewImageLoading, setPreviewImageLoading] = useState(false);

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: categories } = useQuery({
    queryKey: ['admin-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name')
        .order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: staffOptions } = useQuery({
    queryKey: ['admin-staff-options'],
    queryFn: async () => {
      const { data: roleRows, error: roleError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', ['owner', 'admin', 'moderator']);

      if (roleError) throw roleError;

      const uniqueStaffIds = Array.from(
        new Set((roleRows || []).map((row) => row.user_id).filter(Boolean))
      );

      if (uniqueStaffIds.length === 0) {
        return [] as StaffOption[];
      }

      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', uniqueStaffIds);

      if (profileError) throw profileError;

      return ((profileRows || []) as StaffOption[]).sort((a, b) => {
        const aLabel = a.full_name?.trim() || a.email || '';
        const bLabel = b.full_name?.trim() || b.email || '';
        return aLabel.localeCompare(bLabel);
      });
    },
  });

  const {
    data: submissionPages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['admin-submissions', statusFilter, categoryFilter, staffFilter, startDate, endDate],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * SUBMISSIONS_PAGE_SIZE;
      const to = from + SUBMISSIONS_PAGE_SIZE - 1;
      let query = supabase
        .from('task_submissions')
        .select(`
          *,
          tasks!inner(id, title, created_by, task_type, amount, instruction, content, target_link, subreddit_flair, category_id),
          profiles(id, email, full_name, karma, karma_range, cqs, league),
          reddit_accounts(id, reddit_username, karma, karma_range, cqs)
        `)
        .order('submitted_at', { ascending: false })
        .range(from, to);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (categoryFilter !== 'all') {
        query = query.eq('tasks.category_id', categoryFilter);
      }
      if (staffFilter !== 'all') {
        query = query.eq('tasks.created_by', staffFilter);
      }
      if (startDate) {
        const startIso = new Date(`${startDate}T00:00:00`).toISOString();
        query = query.gte('submitted_at', startIso);
      }
      if (endDate) {
        const endIso = new Date(`${endDate}T23:59:59`).toISOString();
        query = query.lte('submitted_at', endIso);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (
        data?.map((submission: any) => ({
          ...submission,
          task: submission.tasks,
          worker: submission.profiles,
          redditAccount: submission.reddit_accounts,
        })) || []
      );
    },
    enabled: !!user?.id,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < SUBMISSIONS_PAGE_SIZE ? undefined : allPages.length,
    initialPageParam: 0,
    refetchOnWindowFocus: true,
  });

  const submissions = submissionPages?.pages.flat() || [];
  const categoryById = new Map(
    (categories || []).map((category: any) => [category.id, category.name])
  );

  const getSignedScreenshotUrl = async (value: string) => {
    if (signedUrls[value]) {
      return signedUrls[value];
    }

    const ref = getStorageObjectRef(value);
    if (!ref) {
      return value;
    }

    const { data } = await supabase.storage
      .from(ref.bucket)
      .createSignedUrl(ref.path, 60 * 60);

    const resolvedUrl = data?.signedUrl || value;
    setSignedUrls((current) => ({
      ...current,
      [value]: resolvedUrl,
    }));

    return resolvedUrl;
  };

  const openScreenshotPreview = async (
    submission: TaskSubmission,
    value: string,
    index: number
  ) => {
    setPreviewImageTitle(
      `${submission.task?.title || 'Submission'} - Screenshot ${index + 1}`
    );
    setPreviewImageUrl(null);
    setPreviewImageOpen(true);
    setPreviewImageLoading(true);

    try {
      const resolvedUrl = await getSignedScreenshotUrl(value);
      setPreviewImageUrl(resolvedUrl);
    } finally {
      setPreviewImageLoading(false);
    }
  };

  const verifyMutation = useMutation({
    mutationFn: async (action: 'verified' | 'rejected') => {
      if (!selectedSubmission) throw new Error('No submission selected');

      const { error } = await supabase
        .from('task_submissions')
        .update({
          status: action,
          admin_notes: verificationNotes,
          verified_at: new Date().toISOString(),
          verified_by: user?.id,
        })
        .eq('id', selectedSubmission.id);

      if (error) throw error;

      if (action === 'verified') {
        const normalizedType = normalizeTaskType(selectedSubmission.task?.task_type);
        const league = normalizeLeague(selectedSubmission.worker?.league) ||
          computeLeagueFromProfile({
            karma: selectedSubmission.redditAccount?.karma ?? selectedSubmission.worker?.karma ?? null,
            karmaRange: selectedSubmission.redditAccount?.karma_range ?? selectedSubmission.worker?.karma_range ?? null,
            cqs: selectedSubmission.redditAccount?.cqs ?? selectedSubmission.worker?.cqs ?? null,
          });
        const fallbackAmount = normalizedType
          ? DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE[league]?.[normalizedType] ?? 0
          : 0;
        let amount = fallbackAmount;

        if (normalizedType) {
          const { data: rateRow } = await supabase
            .from('task_type_rates')
            .select('amount')
            .eq('task_type', normalizedType as any)
            .eq('league', league as any)
            .maybeSingle();

          const amountFromDb = Number((rateRow as any)?.amount);
          amount = Number.isFinite(amountFromDb) ? amountFromDb : fallbackAmount;
        }

        await supabase
          .from('task_assignments')
          .update({
            status: 'completed',
            payment_status: 'pending',
          })
          .eq('task_id', selectedSubmission.task_id)
          .eq('user_id', selectedSubmission.user_id);

        await supabase
          .from('task_assignments')
          .update({ amount })
          .eq('task_id', selectedSubmission.task_id)
          .eq('user_id', selectedSubmission.user_id)
          .is('amount', null);
      }

      if (action === 'rejected') {
        const normalizedType = normalizeTaskType(selectedSubmission.task?.task_type);
        const league =
          normalizeLeague(selectedSubmission.worker?.league) ||
          computeLeagueFromProfile({
            karma: selectedSubmission.redditAccount?.karma ?? selectedSubmission.worker?.karma ?? null,
            karmaRange: selectedSubmission.redditAccount?.karma_range ?? selectedSubmission.worker?.karma_range ?? null,
            cqs: selectedSubmission.redditAccount?.cqs ?? selectedSubmission.worker?.cqs ?? null,
          });
        const fallbackRemovalAmount = normalizedType
          ? DEFAULT_TASK_TYPE_REMOVAL_RATES_INR_BY_LEAGUE[league]?.[normalizedType] ?? 0
          : 0;

        let removalAmount = fallbackRemovalAmount;
        const rawType = selectedSubmission.task?.task_type;
        const typeForLookup = normalizedType || rawType;
        if (typeForLookup) {
          const { data: rateRow } = await supabase
            .from('task_type_rates')
            .select('removal_amount, amount')
            .eq('task_type', typeForLookup as any)
            .eq('league', league as any)
            .maybeSingle();

          const removalAmountFromDb = Number((rateRow as any)?.removal_amount);
          const amountFromDb = Number((rateRow as any)?.amount);
          removalAmount = Number.isFinite(removalAmountFromDb)
            ? removalAmountFromDb
            : Number.isFinite(amountFromDb)
              ? amountFromDb
              : fallbackRemovalAmount;
        }

        await supabase
          .from('task_assignments')
          .update({
            status: 'cancelled',
            payment_status: 'pending',
            amount: removalAmount,
            is_removal: true,
          })
          .eq('task_id', selectedSubmission.task_id)
          .eq('user_id', selectedSubmission.user_id);
      }

      const { data: assignmentRow } = await supabase
        .from('task_assignments')
        .select('id')
        .eq('task_id', selectedSubmission.task_id)
        .eq('user_id', selectedSubmission.user_id)
        .maybeSingle();

      if (assignmentRow?.id) {
        await sendTaskStatusDiscord(assignmentRow.id);
      }

      await supabase.from('activity_logs').insert({
        user_id: user?.id,
        action:
          action === 'verified'
            ? 'submission_verified'
            : 'submission_rejected',
        entity_type: 'task_submission',
        entity_id: selectedSubmission.id,
        details: {
          task_title: selectedSubmission.task?.title,
          worker_id: selectedSubmission.user_id,
          admin_notes: verificationNotes,
        },
      });
    },
    onSuccess: (_, action) => {
      queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
      toast({
        title: `Submission ${action}`,
        description: `Submission marked as ${action}.`,
      });
      setVerificationDialogOpen(false);
      setSelectedSubmission(null);
      setVerificationNotes('');
      setVerificationAction(null);
    },
  });

  const filteredSubmissions =
    submissions?.filter((submission) => {
      const q = searchQuery.toLowerCase();
      return (
        submission.task?.title?.toLowerCase().includes(q) ||
        submission.worker?.email?.toLowerCase().includes(q) ||
        submission.worker?.full_name?.toLowerCase().includes(q)
      );
    }) || [];

  const sentinelRef = useInfiniteScroll({
    enabled: true,
    hasMore: !!hasNextPage,
    isLoading: isLoading || isFetchingNextPage,
    onLoadMore: () => {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
  });

  const getStatusColor = (status: string) => {
    if (status === 'pending')
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    if (status === 'verified')
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (status === 'rejected')
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    return '';
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Task Verification</h1>

        <div className="flex gap-4 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="pl-10"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {(categories || []).map((category: any) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={staffFilter} onValueChange={setStaffFilter}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="All Staff" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Staff</SelectItem>
              {(staffOptions || []).map((staff) => (
                <SelectItem key={staff.user_id} value={staff.user_id}>
                  {staff.full_name?.trim() || staff.email || staff.user_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-44"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-44"
          />
        </div>

        {isLoading ? (
          <p>Loading...</p>
        ) : filteredSubmissions.length > 0 ? (
          <div className="space-y-4">
            {filteredSubmissions.map((submission) => (
              <Card key={submission.id} className="p-6 space-y-4">
                <div className="flex justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-lg font-semibold">
                      {submission.task?.title}
                    </h3>
                    {submission.task?.category_id && (
                      <p className="text-xs text-muted-foreground">
                        Category: {categoryById.get(submission.task.category_id) || submission.task.category_id}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Tasker:{' '}
                      {submission.worker?.full_name ||
                        submission.worker?.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Submitted:{' '}
                      {new Date(
                        submission.submitted_at
                      ).toLocaleString()}
                    </p>
                  </div>

                  <Badge className={getStatusColor(submission.status)}>
                    {submission.status}
                  </Badge>
                </div>

                {(submission.task?.instruction || submission.task?.content || submission.task?.target_link) && (
                  <div className="space-y-3 rounded-lg border p-4">
                    <p className="text-sm font-medium">Task Details</p>
                    {submission.task?.instruction && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Instruction</p>
                        <p className="text-sm whitespace-pre-wrap">{submission.task.instruction}</p>
                      </div>
                    )}
                    {submission.task?.content && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Content</p>
                        <p className="text-sm whitespace-pre-wrap">{submission.task.content}</p>
                      </div>
                    )}
                    {(submission.task?.subreddit_flair || submission.task?.target_link) && (
                      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                        {submission.task?.subreddit_flair && (
                          <span>r/{submission.task.subreddit_flair}</span>
                        )}
                        {submission.task?.target_link && (
                          <a
                            href={submission.task.target_link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-500 underline"
                          >
                            Open target link
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {submission.submission_links?.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Links:</p>
                    {submission.submission_links.map((link, i) => (
                      <a
                        key={i}
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-500 underline flex items-center gap-1"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {link}
                      </a>
                    ))}
                  </div>
                )}

                {submission.screenshot_urls?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Screenshots</p>
                    <div className="flex flex-wrap gap-2">
                      {submission.screenshot_urls.map((url, i) => (
                        <Button
                          key={`${submission.id}-${i}`}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void openScreenshotPreview(submission, url, i)
                          }
                        >
                          View Screenshot {i + 1}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Proof images load only when opened.
                    </p>
                  </div>
                )}

                {submission.status === 'pending' && (
                  <div className="flex gap-2">
                    <Button
                      className="bg-green-600"
                      onClick={() => {
                        setSelectedSubmission(submission);
                        setVerificationAction('verified');
                        setVerificationDialogOpen(true);
                      }}
                    >
                      Verify
                    </Button>
                    <Button
                      variant="outline"
                      className="text-red-600"
                      onClick={() => {
                        setSelectedSubmission(submission);
                        setVerificationAction('rejected');
                        setVerificationDialogOpen(true);
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <p>No submissions found.</p>
        )}

        {submissions.length > 0 && (
          <div ref={sentinelRef} className="py-4 text-center text-sm text-muted-foreground">
            {isFetchingNextPage
              ? 'Loading more submissions...'
              : hasNextPage
                ? 'Scroll to load more'
                : 'You have reached the oldest submissions'}
          </div>
        )}

        <Dialog
          open={verificationDialogOpen}
          onOpenChange={setVerificationDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {verificationAction === 'verified'
                  ? 'Verify Submission'
                  : 'Reject Submission'}
              </DialogTitle>
            </DialogHeader>

            <Textarea
              placeholder="Admin notes (optional)"
              value={verificationNotes}
              onChange={(e) =>
                setVerificationNotes(e.target.value)
              }
            />

            <Button
              className="mt-3"
              onClick={() =>
                verificationAction &&
                verifyMutation.mutate(verificationAction)
              }
            >
              Confirm
            </Button>
          </DialogContent>
        </Dialog>

        <Dialog
          open={previewImageOpen}
          onOpenChange={(open) => {
            setPreviewImageOpen(open);
            if (!open) {
              setPreviewImageUrl(null);
              setPreviewImageTitle('');
              setPreviewImageLoading(false);
            }
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{previewImageTitle || 'Screenshot Preview'}</DialogTitle>
            </DialogHeader>

            {previewImageLoading ? (
              <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                Loading screenshot...
              </div>
            ) : previewImageUrl ? (
              <div className="space-y-3">
                <img
                  src={previewImageUrl}
                  alt={previewImageTitle || 'Submission screenshot'}
                  className="max-h-[70vh] w-full rounded-lg border object-contain"
                />
                <Button asChild variant="outline">
                  <a href={previewImageUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open full image
                  </a>
                </Button>
              </div>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                Screenshot unavailable.
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default AdminVerification;
