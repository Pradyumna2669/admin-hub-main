import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { StatCard } from '@/components/ui/stat-card';
import { TaskCard } from '@/components/tasks/TaskCard';
import { 
  ClipboardList, 
  Users, 
  CheckCircle2, 
  Clock,
  Link2,
  Activity
} from 'lucide-react';

const AdminDashboard: React.FC = () => {
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const [tasksRes, clientsRes, linksRes] = await Promise.all([
        supabase.from('tasks').select('status'),
        supabase.from('user_roles').select('id').eq('role', 'client'),
        supabase.from('links').select('id'),
      ]);

      const tasks = tasksRes.data || [];
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter(t => t.status === 'completed').length;
      const pendingTasks = tasks.filter(t => t.status === 'pending').length;
      const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
      
      return {
        totalTasks,
        completedTasks,
        pendingTasks,
        inProgressTasks,
        totalClients: clientsRes.data?.length || 0,
        totalLinks: linksRes.data?.length || 0,
      };
    },
  });

  const { data: recentTasks } = useQuery({
    queryKey: ['recent-tasks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      return data;
    },
  });

  const { data: recentActivity } = useQuery({
    queryKey: ['recent-activity'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      return data;
    },
  });

  return (
    <DashboardLayout isAdmin>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Admin Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Overview of your StoicOps operations
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
          <StatCard
            title="Total Tasks"
            value={stats?.totalTasks || 0}
            icon={ClipboardList}
          />
          <StatCard
            title="Completed"
            value={stats?.completedTasks || 0}
            icon={CheckCircle2}
          />
          <StatCard
            title="In Progress"
            value={stats?.inProgressTasks || 0}
            icon={Activity}
          />
          <StatCard
            title="Pending"
            value={stats?.pendingTasks || 0}
            icon={Clock}
          />
          <StatCard
            title="Clients"
            value={stats?.totalClients || 0}
            icon={Users}
          />
          <StatCard
            title="Links"
            value={stats?.totalLinks || 0}
            icon={Link2}
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
                <p className="text-muted-foreground">No tasks yet. Create your first task!</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="font-heading text-xl font-semibold text-foreground mb-4">
            Recent Activity
          </h2>
          <div className="stoic-card divide-y divide-border">
            {recentActivity && recentActivity.length > 0 ? (
              recentActivity.map((log) => (
                <div key={log.id} className="p-4 flex items-center gap-4">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Activity className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-foreground">{log.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center">
                <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No activity logged yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminDashboard;
