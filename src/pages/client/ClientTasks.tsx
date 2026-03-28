import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TaskCard } from '@/components/tasks/TaskCard';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClipboardList, Search } from 'lucide-react';

type ClientTask = {
  id: string;
  public_order_code?: string | null;
  title: string;
  instruction?: string | null;
  content: string | null;
  task_type: string;
  status: 'pending' | 'in_progress' | 'submitted' | 'completed' | 'cancelled';
  subreddit_flair: string | null;
  target_link: string | null;
  ai_generated: boolean | null;
  created_at: string;
};

const ClientTasks: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { user } = useAuth();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['client-tasks', user?.id],
    queryFn: async () => {
      const { data: categoryAssignments, error: assignmentError } = await supabase
        .from('category_assignments')
        .select('category_id')
        .eq('client_user_id', user?.id);

      if (assignmentError) throw assignmentError;

      const categoryIds = Array.from(
        new Set(
          (categoryAssignments || [])
            .map((row) => row.category_id)
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
        )
      );

      if (categoryIds.length === 0) {
        return [] as ClientTask[];
      }

      const { data, error } = await supabase
        .from('tasks')
        .select('id, public_order_code, title, instruction, content, task_type, status, subreddit_flair, target_link, ai_generated, created_at')
        .in('category_id', categoryIds)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []) as ClientTask[];
    },
    enabled: !!user?.id,
  });

  const filteredTasks = useMemo(
    () =>
      (tasks || []).filter((task) => {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          task.title.toLowerCase().includes(query) ||
          task.content?.toLowerCase().includes(query);
        const matchesStatus =
          statusFilter === 'all' || task.status === statusFilter;
        return matchesSearch && matchesStatus;
      }),
    [searchQuery, statusFilter, tasks]
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Category Tasks
          </h1>
          <p className="text-muted-foreground mt-1">
            Browse all tasks available in your assigned categories.
          </p>
        </div>

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
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredTasks.length > 0 ? (
          <div className="grid gap-4">
            {filteredTasks.map((task) => (
              <TaskCard key={task.id} task={task} showActions={false} />
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
                : 'No tasks are available in your assigned categories yet'}
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ClientTasks;
