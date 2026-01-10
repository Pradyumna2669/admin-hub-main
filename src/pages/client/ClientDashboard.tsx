import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { StatCard } from '@/components/ui/stat-card';
import { TaskCard } from '@/components/tasks/TaskCard';
import { ClipboardList, CheckCircle2, Clock, PlayCircle } from 'lucide-react';

const ClientDashboard: React.FC = () => {
  const { user } = useAuth();

  const { data: stats } = useQuery({
    queryKey: ['client-stats', user?.id],
    queryFn: async () => {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('status')
        .eq('assigned_to', user?.id);

      const total = tasks?.length || 0;
      const completed = tasks?.filter((t) => t.status === 'completed').length || 0;
      const pending = tasks?.filter((t) => t.status === 'pending').length || 0;
      const inProgress = tasks?.filter((t) => t.status === 'in_progress').length || 0;

      return { total, completed, pending, inProgress };
    },
    enabled: !!user?.id,
  });

  const { data: recentTasks } = useQuery({
    queryKey: ['client-recent-tasks', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('assigned_to', user?.id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            My Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Track your assigned tasks and progress
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Total Tasks"
            value={stats?.total || 0}
            icon={ClipboardList}
          />
          <StatCard
            title="Completed"
            value={stats?.completed || 0}
            icon={CheckCircle2}
          />
          <StatCard
            title="In Progress"
            value={stats?.inProgress || 0}
            icon={PlayCircle}
          />
          <StatCard
            title="Pending"
            value={stats?.pending || 0}
            icon={Clock}
          />
        </div>

        {/* Recent Tasks */}
        <div>
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            Recent Tasks
          </h2>
          <div className="grid gap-4">
            {recentTasks && recentTasks.length > 0 ? (
              recentTasks.map((task) => (
                <TaskCard key={task.id} task={task} showActions={false} />
              ))
            ) : (
              <div className="stoic-card p-8 text-center">
                <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  No tasks assigned yet. Check back soon!
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
