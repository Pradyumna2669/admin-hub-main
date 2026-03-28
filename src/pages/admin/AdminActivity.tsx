import React, { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Activity,
  Clock,
  CheckCircle2,
  FileCheck,
  ListTodo,
  XCircle,
  Search,
  Shield,
  FolderPlus,
  Link2,
  Ban,
  Trash2,
} from 'lucide-react';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';

const ACTIVITY_PAGE_SIZE = 30;

interface ActivityLog {
  id: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  details?: any;
  created_at: string;
  user_id?: string;
  user_email?: string;
  user_name?: string;
}

const resolveActorName = (log: ActivityLog) =>
  log.user_name || log.user_email || 'Unknown';

const renderRemainingDetails = (
  details: Record<string, unknown>,
  hiddenKeys: string[] = []
) =>
  Object.entries(details).map(([key, value]) => {
    if (hiddenKeys.includes(key) || value === null || value === undefined || value === '') {
      return null;
    }

    return (
      <p key={key}>
        <strong>{key}:</strong> {String(value).slice(0, 100)}
      </p>
    );
  });

const actionIcons: Record<string, any> = {
  task_created: ListTodo,
  submission_verified: CheckCircle2,
  submission_rejected: XCircle,
  task_submitted: FileCheck,
  user_role_updated: Shield,
  category_created: FolderPlus,
  link_created: Link2,
  user_banned: Ban,
  user_unbanned: Shield,
  chat_message_deleted: Trash2,
};

const actionColors: Record<string, string> = {
  task_created: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  submission_verified: 'bg-green-500/20 text-green-400 border-green-500/30',
  submission_rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  task_submitted: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  user_role_updated: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  category_created: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  link_created: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  user_banned: 'bg-red-500/20 text-red-400 border-red-500/30',
  user_unbanned: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  chat_message_deleted: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

const AdminActivity: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');

  const {
    data: logPages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['admin-activity-logs', actionFilter, dateFilter],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * ACTIVITY_PAGE_SIZE;
      const to = from + ACTIVITY_PAGE_SIZE - 1;
      let query = supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (actionFilter !== 'all') {
        query = query.eq('action', actionFilter);
      }

      if (dateFilter !== 'all') {
        const now = new Date();
        let startDate = new Date();

        if (dateFilter === '24h') {
          startDate.setHours(now.getHours() - 24);
        } else if (dateFilter === '7d') {
          startDate.setDate(now.getDate() - 7);
        } else if (dateFilter === '30d') {
          startDate.setDate(now.getDate() - 30);
        }

        query = query.gte('created_at', startDate.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;

      const logs = (data || []) as ActivityLog[];
      const userIds = Array.from(
        new Set(
          logs
            .map((log) => log.user_id)
            .filter((userId): userId is string => Boolean(userId))
        )
      );

      if (!userIds.length) {
        return logs;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', userIds);

      if (profilesError) throw profilesError;

      const profileByUserId = new Map(
        (profiles || []).map((profile: any) => [
          profile.user_id,
          {
            user_name: profile.full_name || null,
            user_email: profile.email || null,
          },
        ])
      );

      return logs.map((log) => ({
        ...log,
        user_name: profileByUserId.get(log.user_id || '')?.user_name || undefined,
        user_email: profileByUserId.get(log.user_id || '')?.user_email || undefined,
      }));
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < ACTIVITY_PAGE_SIZE ? undefined : allPages.length,
  });

  const logs = logPages?.pages.flat() || [];

  // Search filter
  const filteredLogs =
    logs?.filter((log: any) => {
      const detailsText = JSON.stringify(log.details || {}).toLowerCase();
      return (
        log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.entity_type?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        detailsText.includes(searchQuery.toLowerCase())
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

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      task_created: 'Task Created',
      submission_verified: 'Submission Verified',
      submission_rejected: 'Submission Rejected',
      task_submitted: 'Task Submitted',
      user_role_updated: 'User Role Updated',
      category_created: 'Category Created',
      link_created: 'Link Created',
      user_banned: 'User Banned',
      user_unbanned: 'User Unbanned',
      chat_message_deleted: 'Chat Message Deleted',
    };
    return labels[action] || action.replace(/_/g, ' ').toUpperCase();
  };

  const ActionIcon = (action: string) => {
    const Icon = actionIcons[action] || Activity;
    return <Icon className="h-4 w-4" />;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Activity Log
          </h1>
          <p className="text-muted-foreground mt-1">
            Track all actions and changes in the system
          </p>
        </div>

        {/* Filters */}
        <div className="flex gap-4 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search activities..."
              className="bg-input border-border pl-10"
            />
          </div>

          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[180px] bg-input border-border">
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="task_created">Task Created</SelectItem>
              <SelectItem value="task_submitted">Task Submitted</SelectItem>
              <SelectItem value="submission_verified">Verified</SelectItem>
              <SelectItem value="submission_rejected">Rejected</SelectItem>
              <SelectItem value="user_role_updated">
                Role Updated
              </SelectItem>
            </SelectContent>
          </Select>

          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-[180px] bg-input border-border">
              <SelectValue placeholder="Filter by date" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="24h">Last 24 Hours</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Activity List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredLogs.length > 0 ? (
          <div className="space-y-3">
            {filteredLogs.map((log: any) => (
              <Card
                key={log.id}
                className="bg-card border-border p-4 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-primary/10 mt-1">
                    {ActionIcon(log.action)}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge
                        className={`border ${
                          actionColors[log.action] ||
                          'bg-gray-500/20 text-gray-400 border-gray-500/30'
                        }`}
                      >
                        {getActionLabel(log.action)}
                      </Badge>

                      {log.entity_type && (
                        <Badge variant="outline" className="text-xs">
                          {log.entity_type}
                        </Badge>
                      )}
                    </div>

                    {/* Details section */}
                    {log.details && (
                      <div className="bg-background/50 border border-border/50 rounded p-2 mt-2 text-xs space-y-1">
                        {log.action === 'user_role_updated' ? (
                          <>
                            <p>
                              <strong>Changed by:</strong>{' '}
                              {log.details.changed_by_name || log.details.changed_by_email || 'Unknown'}
                            </p>
                            <p>
                              <strong>Target:</strong>{' '}
                              {log.details.target_user_name || log.details.target_user_email}
                            </p>
                            <p>
                              <strong>Old Role:</strong>{' '}
                              {log.details.old_role}
                            </p>
                            <p>
                              <strong>New Role:</strong>{' '}
                              {log.details.new_role}
                            </p>
                          </>
                        ) : log.action === 'category_created' ? (
                          <>
                            <p><strong>Category Name:</strong> {log.details.category_name}</p>
                            {log.details.category_description && (
                              <p><strong>Description:</strong> {log.details.category_description}</p>
                            )}
                            <p><strong>Created By:</strong> {log.details.created_by}</p>
                            <p><strong>Created At:</strong> {log.details.created_at && new Date(log.details.created_at).toLocaleString()}</p>
                          </>
                        ) : log.action === 'link_created' ? (
                          <>
                            <p><strong>Website Name:</strong> {log.details.website_name}</p>
                            <p><strong>URL:</strong> {log.details.url}</p>
                            {log.details.promotion_content && (
                              <p><strong>Promotion Content:</strong> {log.details.promotion_content}</p>
                            )}
                            <p><strong>Created By:</strong> {log.details.created_by}</p>
                            <p><strong>Created At:</strong> {log.details.created_at && new Date(log.details.created_at).toLocaleString()}</p>
                          </>
                        ) : log.action === 'task_created' || log.action === 'task_updated' ? (
                          <>
                            <p>
                              <strong>Task Title:</strong>{' '}
                              {log.details.title || 'Untitled task'}
                            </p>
                            {renderRemainingDetails(log.details, ['title'])}
                          </>
                        ) : log.action === 'submission_verified' || log.action === 'submission_rejected' ? (
                          <>
                            <p>
                              <strong>{log.action === 'submission_verified' ? 'Verified By:' : 'Rejected By:'}</strong>{' '}
                              {resolveActorName(log)}
                            </p>
                            <p>
                              <strong>Task Title:</strong>{' '}
                              {log.details.task_title || 'Untitled task'}
                            </p>
                            {renderRemainingDetails(log.details, ['task_title'])}
                          </>
                        ) : (
                          renderRemainingDetails(log.details)
                        )}
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-2">
                      <Clock className="h-3 w-3" />
                      {new Date(log.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="bg-card border-border p-12 text-center">
            <Activity className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-heading text-xl font-semibold text-foreground mb-2">
              No activity found
            </h3>
            <p className="text-muted-foreground">
              Actions will be logged here as they happen
            </p>
          </Card>
        )}

        {logs.length > 0 && (
          <div ref={sentinelRef} className="py-4 text-center text-sm text-muted-foreground">
            {isFetchingNextPage
              ? 'Loading more activity...'
              : hasNextPage
                ? 'Scroll to load more'
                : 'You have reached the oldest activity'}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminActivity;
