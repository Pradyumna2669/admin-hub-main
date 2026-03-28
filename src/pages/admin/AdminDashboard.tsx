import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { StatCard } from '@/components/ui/stat-card';
import { TaskCard } from '@/components/tasks/TaskCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { APP_SETTINGS_QUERY_KEY, useAppSettings } from '@/hooks/useAppSettings';
import {
  ClipboardList,
  Users,
  CheckCircle2,
  Clock,
  Link2,
  Activity,
  ShieldAlert,
} from 'lucide-react';
import { motion } from 'framer-motion';

const AdminDashboard: React.FC = () => {
  const { userRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canViewActivity = userRole === 'admin' || userRole === 'owner';
  const { data: appSettings } = useAppSettings();

  const updateMaintenanceModeMutation = useMutation({
    mutationFn: async (maintenanceMode: boolean) => {
      const { error } = await supabase
        .from('app_settings')
        .upsert({
          id: 'global',
          maintenance_mode: maintenanceMode,
        });

      if (error) {
        throw error;
      }
    },
    onSuccess: (_, maintenanceMode) => {
      queryClient.invalidateQueries({ queryKey: APP_SETTINGS_QUERY_KEY });
      toast({
        title: maintenanceMode ? 'Maintenance mode enabled' : 'Maintenance mode disabled',
        description: maintenanceMode
          ? 'Clients, workers, and guests now see the maintenance page.'
          : 'The app is available to everyone again.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to update maintenance mode',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

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
    staleTime: 60_000,
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
    staleTime: 30_000,
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
    enabled: canViewActivity,
    staleTime: 15_000,
  });

  return (
    <DashboardLayout>
      {/* IMPORTANT: min-w-0 prevents overflow expansion */}
      <div className="w-full min-w-0 space-y-10">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-2xl sm:text-3xl font-bold break-words">
            Admin Dashboard
          </h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base break-words">
            Overview of your StoicOps operations
          </p>
        </motion.div>

        {/* Stats Grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="
            grid
            grid-cols-1
            sm:grid-cols-2
            lg:grid-cols-3
            xl:grid-cols-4
            2xl:grid-cols-6
            gap-6
            w-full
          "
        >
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <ShieldAlert className="h-5 w-5 text-primary" />
                  Maintenance Mode
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Turn this on to show the maintenance page to everyone except admins and owners.
                </p>
              </div>
              <Switch
                checked={!!appSettings?.maintenance_mode}
                disabled={updateMaintenanceModeMutation.isPending}
                onCheckedChange={(checked) => updateMaintenanceModeMutation.mutate(checked)}
                aria-label="Toggle maintenance mode"
              />
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Status: <span className="font-medium text-foreground">{appSettings?.maintenance_mode ? 'Enabled' : 'Disabled'}</span>
              </p>
            </CardContent>
          </Card>

          <StatCard title="Total Tasks" value={stats?.totalTasks || 0} icon={ClipboardList} />
          <StatCard title="Completed" value={stats?.completedTasks || 0} icon={CheckCircle2} />
          <StatCard title="In Progress" value={stats?.inProgressTasks || 0} icon={Activity} />
          <StatCard title="Pending" value={stats?.pendingTasks || 0} icon={Clock} />
          <StatCard title="Clients" value={stats?.totalClients || 0} icon={Users} />
          <StatCard title="Links" value={stats?.totalLinks || 0} icon={Link2} />
        </motion.div>

        {/* Recent Tasks */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="w-full min-w-0"
        >
          <h2 className="text-lg sm:text-xl font-semibold mb-4">
            Recent Tasks
          </h2>

          <div className="grid gap-4 w-full">
            {recentTasks && recentTasks.length > 0 ? (
              recentTasks.map((task) => (
                <TaskCard key={task.id} task={task} showActions={false} />
              ))
            ) : (
              <div className="stoic-card p-8 text-center rounded-xl">
                <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground text-sm sm:text-base">
                  No tasks yet. Create your first task!
                </p>
              </div>
            )}
          </div>
        </motion.div>

        {/* Recent Activity */}
        {canViewActivity && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="w-full min-w-0"
          >
            <h2 className="text-lg sm:text-xl font-semibold mb-4">
              Recent Activity
            </h2>

            <div className="stoic-card divide-y divide-border rounded-xl overflow-hidden w-full">
              {recentActivity && recentActivity.length > 0 ? (
                recentActivity.map((log) => (
                  <div
                    key={log.id}
                    className="p-4 flex items-start sm:items-center gap-4 flex-col sm:flex-row w-full min-w-0"
                  >
                    <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                      <Activity className="h-4 w-4 text-primary" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-foreground text-sm sm:text-base break-words">
                        {log.action}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center">
                  <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground text-sm sm:text-base">
                    No activity logged yet.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}

      </div>
    </DashboardLayout>
  );
};

export default AdminDashboard;
