import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TaskCard } from '@/components/tasks/TaskCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, ClipboardList, Search, Edit2 } from 'lucide-react';
import { ALL_TASK_TYPES, getTaskTypeLabel, requiresSubredditFlair, TaskType, normalizeTaskType } from '@/lib/taskTypes';
import { useTaskTypeRates } from '@/hooks/useTaskTypeRates';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { sendNewTaskPushes } from '@/lib/taskPush';
import { sendNewTaskDiscord, refreshTaskClaimedDiscord } from '@/lib/taskDiscord';
import { createTaskIdentifiers } from '@/lib/taskIdentifiers';

const TASKS_PAGE_SIZE = 20;
const UUID_SEARCH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StaffOption = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

const AdminTasks: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [editingTask, setEditingTask] = useState<any>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '',
    instruction: '',
    content: '',
    task_type: 'normal_comment' as TaskType,
    subreddit_flair: '',
    target_link: '',
    category_id: '',
    task_completion_time: '60',
    minimum_karma: '',
    cqs_levels: [] as string[],
  });
  // const [workers, setWorkers] = useState<Array<{ user_id: string; email?: string; full_name?: string; karma?: number; cqs?: string; is_verified?: boolean }>>([]);

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: taskTypeRates } = useTaskTypeRates();

  const { data: categories } = useQuery({
    queryKey: ['admin-categories-list'],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('id, name').order('name');
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
    data: taskPages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['admin-tasks', searchQuery, statusFilter, categoryFilter, staffFilter],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * TASKS_PAGE_SIZE;
      const to = from + TASKS_PAGE_SIZE - 1;
      const trimmedSearch = searchQuery.trim();
      let query = supabase
        .from('tasks')
        .select('*, task_items(*), task_assignments(*, profiles:user_id(full_name, email, reddit_username, cqs, league, karma), reddit_accounts:reddit_account_id(reddit_username))')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (trimmedSearch) {
        const searchClauses = [
          `title.ilike.%${trimmedSearch}%`,
          `content.ilike.%${trimmedSearch}%`,
          `public_order_code.ilike.%${trimmedSearch}%`,
        ];
        if (UUID_SEARCH_PATTERN.test(trimmedSearch)) {
          searchClauses.push(`id.eq.${trimmedSearch}`);
        }
        query = query.or(searchClauses.join(','));
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (categoryFilter !== 'all') {
        query = query.eq('category_id', categoryFilter);
      }

      if (staffFilter !== 'all') {
        query = query.eq('created_by', staffFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < TASKS_PAGE_SIZE ? undefined : allPages.length,
  });

  const createTaskMutation = useMutation({
    mutationFn: async (task: typeof newTask) => {
      // Validation
      if (!task.category_id) {
        throw new Error('Category is required');
      }
      if (!task.title.trim()) {
        throw new Error('Task title is required');
      }
      if (!task.task_completion_time || parseInt(task.task_completion_time) <= 0) {
        throw new Error('Task completion time must be greater than 0');
      }
      if (requiresSubredditFlair(task.task_type) && !task.subreddit_flair?.trim()) {
        throw new Error('Subreddit flair is required for this task type');
      }

      const amount = taskTypeRates?.[task.task_type] ?? 0;
      const identifiers = createTaskIdentifiers();

      // create task
      const { data: taskRow, error: taskErr } = await supabase
        .from('tasks')
        .insert({
          id: identifiers.id,
          title: task.title,
          instruction: task.instruction || null,
          content: task.content,
          task_type: task.task_type,
          subreddit_flair: task.subreddit_flair,
          target_link: task.target_link,
          category_id: task.category_id,
          amount,
          task_completion_time: parseInt(task.task_completion_time) || 60,
          minimum_karma: task.minimum_karma ? parseInt(task.minimum_karma) : null,
          cqs_levels: task.cqs_levels,
          created_by: user?.id,
          public_order_code: identifiers.publicOrderCode,
        })
        .select()
        .single();

      if (taskErr || !taskRow) throw taskErr || new Error('Failed to create task');

      await sendNewTaskPushes([taskRow.id]);
      await sendNewTaskDiscord([taskRow.id]);

      // Log activity (ignore if fails)
      supabase.from('activity_logs').insert({
        user_id: user?.id,
        action: 'task_created',
        entity_type: 'task',
        entity_id: taskRow.id,
        details: {
          title: taskRow.title,
          category_id: taskRow.category_id,
          // workers_count: removed, no manual assignment
          amount: taskRow.amount,
        },
      });

      return taskRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tasks'] });
      setIsOpen(false);
      setNewTask({
        title: '',
        instruction: '',
        content: '',
        task_type: 'normal_comment',
        subreddit_flair: '',
        target_link: '',
        category_id: '',
        task_completion_time: '60',
        minimum_karma: '',
        cqs_levels: [],
      });
      toast({
        title: 'Task created',
        description: 'The task has been created successfully.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }) => {
      const { error } = await supabase
        .from('tasks')
        .update({ status })
        .eq('id', taskId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tasks'] });
      toast({
        title: 'Status updated',
        description: 'Task status has been updated.',
      });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tasks'] });
      toast({ title: 'Task deleted', description: 'Task and related data removed.' });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async (updates: any) => {
      if (!editingTask) throw new Error('No task selected');
      
      const { error } = await supabase
        .from('tasks')
        .update({
          title: updates.title,
          instruction: updates.instruction,
          content: updates.content,
          task_type: updates.task_type,
          subreddit_flair: updates.subreddit_flair,
          target_link: updates.target_link,
          category_id: updates.category_id,
          amount: updates.amount,
          task_completion_time: updates.task_completion_time,
        })
        .eq('id', editingTask.id);

      if (error) throw error;

      // Log activity (ignore if fails)
      supabase.from('activity_logs').insert({
        user_id: user?.id,
        action: 'task_updated',
        entity_type: 'task',
        entity_id: editingTask.id,
        details: {
          title: updates.title,
          category_id: updates.category_id,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tasks'] });
      setIsEditOpen(false);
      setEditingTask(null);
      toast({ title: 'Task updated', description: 'Task has been updated successfully.' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createTaskMutation.mutate(newTask);
  };

  // load workers list
  // No need to load workers for assignment anymore

  const tasks = taskPages?.pages.flat() || [];
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

  // No eligibleWorkers logic needed

  const copyWorkerTaskLink = async (taskId: string) => {
    const url = `${window.location.origin}/worker/task/${taskId}`;
    await navigator.clipboard.writeText(url);
    toast({
      title: 'Worker task link copied',
      description: 'Share this link with a tasker. It resolves safely based on task state.',
    });
  };

  const sendDiscordTest = async () => {
    const latestTask = tasks?.[0];
    if (!latestTask?.id) {
      toast({
        title: 'No tasks loaded',
        description: 'Load at least one task to send a test Discord notification.',
        variant: 'destructive',
      });
      return;
    }
    await sendNewTaskDiscord([latestTask.id]);
    toast({
      title: 'Discord test sent',
      description: `Triggered for task ${latestTask.id}.`,
    });
  };

  const refreshDiscordClaimed = useMutation({
    mutationFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error('You are not logged in. Please sign in again and retry.');
      }

      const assignmentIds = tasks
        .flatMap((task: any) => {
          if (!task?.discord_message_id) return [];
          const assignments = (task.task_assignments || []) as Array<any>;
          const claimed = assignments.find((a) =>
            ['in_progress', 'submitted', 'completed'].includes(String(a?.status || '')) &&
            String(a?.payment_status || '') !== 'paid'
          );
          return claimed?.id ? [claimed.id as string] : [];
        });

      const uniqueIds = Array.from(new Set(assignmentIds));
      if (uniqueIds.length === 0) {
        throw new Error('No claimed tasks with Discord messages in the current list.');
      }

      let success = 0;
      let failed = 0;
      for (const id of uniqueIds) {
        const ok = await refreshTaskClaimedDiscord(id);
        if (ok) success += 1;
        else failed += 1;
      }

      return { success, failed, total: uniqueIds.length };
    },
    onSuccess: (result) => {
      toast({
        title: 'Discord messages refreshed',
        description: `Updated ${result.success}/${result.total} messages${result.failed ? `, ${result.failed} failed` : ''}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Refresh failed',
        description: error?.message || 'Could not refresh Discord messages.',
        variant: 'destructive',
      });
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-3xl font-bold text-foreground">
              Tasks
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage all tasks and assignments
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => refreshDiscordClaimed.mutate()}
              disabled={refreshDiscordClaimed.isPending}
            >
              {refreshDiscordClaimed.isPending ? 'Refreshing...' : 'Refresh Discord Messages'}
            </Button>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="stoic-button-primary">
                <Plus className="h-4 w-4 mr-2" />
                New Task
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
              <DialogHeader className="sticky top-0 bg-card z-10">
                <DialogTitle className="font-heading">Create New Task</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pb-4">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    placeholder="Task title"
                    required
                    className="bg-input border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Instruction</Label>
                  <Textarea
                    value={newTask.instruction}
                    onChange={(e) => setNewTask({ ...newTask, instruction: e.target.value })}
                    placeholder="Instructions shown to workers (what to do, format, rules)"
                    className="bg-input border-border min-h-[80px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Content</Label>
                  <Textarea
                    value={newTask.content}
                    onChange={(e) => setNewTask({ ...newTask, content: e.target.value })}
                    placeholder="Task content or description"
                    className="bg-input border-border min-h-[100px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Category *</Label>
                  <Select
                    value={newTask.category_id}
                    onValueChange={(value) => setNewTask({ ...newTask, category_id: value })}
                  >
                    <SelectTrigger className="bg-input border-border">
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {(categories || []).map((cat: any) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Amount (₹)</Label>
                    <Input
                      type="number"
                      value={taskTypeRates?.[newTask.task_type] ?? 0}
                      readOnly
                      className="bg-input border-border"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Task Type</Label>
                    <Select
                      value={newTask.task_type}
                      onValueChange={(value) => setNewTask({ ...newTask, task_type: value as typeof newTask.task_type })}
                    >
                      <SelectTrigger className="bg-input border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        {ALL_TASK_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {getTaskTypeLabel(t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    Subreddit Flair{requiresSubredditFlair(newTask.task_type) ? ' *' : ''}
                  </Label>
                  <Input
                    value={newTask.subreddit_flair}
                    onChange={(e) => setNewTask({ ...newTask, subreddit_flair: e.target.value })}
                    placeholder="e.g. stoicism"
                    required={requiresSubredditFlair(newTask.task_type)}
                    className="bg-input border-border"
                  />
                  {requiresSubredditFlair(newTask.task_type) && (
                    <p className="text-xs text-muted-foreground">
                      Required for this task type.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Minimum Karma</Label>
                    <Select
                      value={newTask.minimum_karma}
                      onValueChange={(value) => setNewTask({ ...newTask, minimum_karma: value })}
                    >
                      <SelectTrigger className="bg-input border-border">
                        <SelectValue placeholder="Select minimum karma" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="0">No Minimum</SelectItem>
                        <SelectItem value="1">&lt;1K</SelectItem>
                        <SelectItem value="1000">1K+</SelectItem>
                        <SelectItem value="5000">5K+</SelectItem>
                        <SelectItem value="10000">10K+</SelectItem>
                        <SelectItem value="50000">50K+</SelectItem>
                        <SelectItem value="100000">100K+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>CQS Level(s)</Label>
                    <Select
                      value={newTask.cqs_levels[0] || ''}
                      onValueChange={(value) => setNewTask({ ...newTask, cqs_levels: value ? [value] : [] })}
                    >
                      <SelectTrigger className="bg-input border-border">
                        <SelectValue placeholder="Select CQS level(s)" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="Highest">Highest</SelectItem>
                        <SelectItem value="High">High</SelectItem>
                        <SelectItem value="Moderate">Moderate</SelectItem>
                        <SelectItem value="Low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Target Link</Label>
                  <Input
                    value={newTask.target_link}
                    onChange={(e) => setNewTask({ ...newTask, target_link: e.target.value })}
                    placeholder="https://..."
                    type="url"
                    className="bg-input border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Task Completion Time (minutes) *</Label>
                  <Input
                    type="number"
                    min="1"
                    value={newTask.task_completion_time}
                    onChange={(e) => setNewTask({ ...newTask, task_completion_time: e.target.value })}
                    placeholder="60"
                    required
                    className="bg-input border-border"
                  />
                  <p className="text-xs text-muted-foreground">Time allowed for worker to complete the task</p>
                </div>

                {/* Removed manual worker assignment section */}

                <Button 
                  type="submit" 
                  className="w-full stoic-button-primary"
                  disabled={createTaskMutation.isPending || !newTask.category_id || !newTask.title.trim()}
                >
                  {createTaskMutation.isPending ? 'Creating...' : 'Create Task'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          </div>

          {/* Edit Task Dialog */}
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border">
              <DialogHeader className="sticky top-0 bg-card z-10 pb-4 border-b border-border">
                <DialogTitle className="text-xl font-bold text-foreground">
                  Edit Task
                </DialogTitle>
              </DialogHeader>

              {editingTask && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    updateTaskMutation.mutate({
                      title: editingTask.title,
                      instruction: editingTask.instruction,
                      content: editingTask.content,
                      task_type: editingTask.task_type,
                      subreddit_flair: editingTask.subreddit_flair,
                      target_link: editingTask.target_link,
                      category_id: editingTask.category_id,
                      amount: taskTypeRates?.[editingTask.task_type as TaskType] ?? parseFloat(editingTask.amount || '0'),
                      task_completion_time: parseInt(editingTask.task_completion_time || '60'),
                    });
                  }}
                  className="space-y-4 pt-4"
                >
                  <div>
                    <Label className="text-foreground font-semibold">Title *</Label>
                    <Input
                      value={editingTask.title}
                      onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                      className="bg-input border-border mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-foreground font-semibold">Category *</Label>
                    <Select value={editingTask.category_id} onValueChange={(val) => setEditingTask({ ...editingTask, category_id: val })}>
                      <SelectTrigger className="bg-input border-border mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        {categories?.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-foreground font-semibold">Instruction</Label>
                    <Textarea
                      value={editingTask.instruction || ''}
                      onChange={(e) => setEditingTask({ ...editingTask, instruction: e.target.value })}
                      className="bg-input border-border mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-foreground font-semibold">Content</Label>
                    <Textarea
                      value={editingTask.content || ''}
                      onChange={(e) => setEditingTask({ ...editingTask, content: e.target.value })}
                      className="bg-input border-border mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-foreground font-semibold">Task Type</Label>
                    <Select value={editingTask.task_type} onValueChange={(val: any) => setEditingTask({ ...editingTask, task_type: val })}>
                      <SelectTrigger className="bg-input border-border mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        {ALL_TASK_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {getTaskTypeLabel(t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-foreground font-semibold">Amount (₹)</Label>
                      <Input
                        type="number"
                        value={taskTypeRates?.[editingTask.task_type as TaskType] ?? editingTask.amount ?? 0}
                        readOnly
                        className="bg-input border-border mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-foreground font-semibold">Completion Time (minutes)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={editingTask.task_completion_time}
                        onChange={(e) => setEditingTask({ ...editingTask, task_completion_time: e.target.value })}
                        className="bg-input border-border mt-1"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-foreground font-semibold">Subreddit Flair</Label>
                    <Input
                      value={editingTask.subreddit_flair || ''}
                      onChange={(e) => setEditingTask({ ...editingTask, subreddit_flair: e.target.value })}
                      required={requiresSubredditFlair(editingTask.task_type)}
                      className="bg-input border-border mt-1"
                    />
                    {requiresSubredditFlair(editingTask.task_type) && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Required for this task type.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label className="text-foreground font-semibold">Target Link</Label>
                    <Input
                      value={editingTask.target_link || ''}
                      onChange={(e) => setEditingTask({ ...editingTask, target_link: e.target.value })}
                      className="bg-input border-border mt-1"
                    />
                  </div>

                  <div className="flex gap-3 pt-4 border-t border-border">
                    <Button
                      variant="outline"
                      onClick={() => setIsEditOpen(false)}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="flex-1 stoic-button-primary"
                      disabled={updateTaskMutation.isPending || !editingTask.title.trim()}
                    >
                      {updateTaskMutation.isPending ? 'Updating...' : 'Update Task'}
                    </Button>
                  </div>
                </form>
              )}
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={sendDiscordTest}>
            Send Discord Test
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-4 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="bg-input border-border pl-10"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] bg-input border-border">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[200px] bg-input border-border">
              <SelectValue placeholder="Filter by category" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">All Categories</SelectItem>
              {categories?.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={staffFilter} onValueChange={setStaffFilter}>
            <SelectTrigger className="w-[220px] bg-input border-border">
              <SelectValue placeholder="Filter by staff" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">All Staff</SelectItem>
              {(staffOptions || []).map((staff) => (
                <SelectItem key={staff.user_id} value={staff.user_id}>
                  {staff.full_name?.trim() || staff.email || staff.user_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tasks Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tasks.length > 0 ? (
          <div className="grid gap-4">
            {tasks.map((task: any) => (
              <TaskCard
                key={task.id}
                task={task}
                onCopyLink={() => copyWorkerTaskLink(task.id)}
                onStatusChange={(id, status) => updateStatusMutation.mutate({ taskId: id, status })}
                onEdit={(task) => {
                  const normalized = normalizeTaskType(task.task_type) || 'normal_comment';
                  setEditingTask({ ...task, task_type: normalized });
                  setIsEditOpen(true);
                }}
                onDelete={(id) => deleteTaskMutation.mutate(id)}
              />
            ))}
          </div>
        ) : (
          <div className="stoic-card p-12 text-center">
            <ClipboardList className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-heading text-xl font-semibold text-foreground mb-2">
              No tasks found
            </h3>
            <p className="text-muted-foreground">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Create your first task to get started'}
            </p>
          </div>
        )}

        {tasks.length > 0 && (
          <div ref={sentinelRef} className="py-4 text-center text-sm text-muted-foreground">
            {isFetchingNextPage
              ? 'Loading more tasks...'
              : hasNextPage
                ? 'Scroll to load more'
                : 'You have reached the oldest tasks'}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminTasks;
