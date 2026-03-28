import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { StatCard } from '@/components/ui/stat-card';
import { TaskCard } from '@/components/tasks/TaskCard';
import { ClipboardList, CheckCircle2, Clock, PlayCircle } from 'lucide-react';

type ClientDashboardTask = {
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

const emptyStats = {
  total: 0,
  completed: 0,
  pending: 0,
  inProgress: 0,
};

const ClientDashboard: React.FC = () => {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ['client-dashboard', user?.id],
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
        return {
          stats: emptyStats,
          recentTasks: [] as ClientDashboardTask[],
        };
      }

      const { data: tasks, error: taskError } = await supabase
        .from('tasks')
        .select('id, public_order_code, title, instruction, content, task_type, status, subreddit_flair, target_link, ai_generated, created_at')
        .in('category_id', categoryIds)
        .order('created_at', { ascending: false });

      if (taskError) throw taskError;

      const allTasks = (tasks || []) as ClientDashboardTask[];

      return {
        stats: {
          total: allTasks.length,
          completed: allTasks.filter((task) => task.status === 'completed').length,
          pending: allTasks.filter((task) => task.status === 'pending').length,
          inProgress: allTasks.filter((task) => task.status === 'in_progress').length,
        },
        recentTasks: allTasks.slice(0, 5),
      };
    },
    enabled: !!user?.id,
  });

  const stats = data?.stats || emptyStats;
  const recentTasks = data?.recentTasks || [];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            My Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Track the tasks available in your assigned categories.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Tasks"
            value={stats.total}
            icon={ClipboardList}
          />
          <StatCard
            title="Completed"
            value={stats.completed}
            icon={CheckCircle2}
          />
          <StatCard
            title="In Progress"
            value={stats.inProgress}
            icon={PlayCircle}
          />
          <StatCard
            title="Pending"
            value={stats.pending}
            icon={Clock}
          />
        </div>

        <div>
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            Recent Tasks
          </h2>
          <div className="grid gap-4">
            {recentTasks.length > 0 ? (
              recentTasks.map((task) => (
                <TaskCard key={task.id} task={task} showActions={false} />
              ))
            ) : (
              <div className="stoic-card p-8 text-center">
                <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  No category tasks are available yet.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ClientDashboard;
