import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Badge } from '@/components/ui/badge';
import { Users, Mail, Calendar } from 'lucide-react';

const AdminClients: React.FC = () => {
  const { data: clients, isLoading } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: async () => {
      // Get all profiles that have client role
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'client');

      if (rolesError) throw rolesError;

      const userIds = roles.map((r) => r.user_id);

      if (userIds.length === 0) return [];

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .in('user_id', userIds);

      if (profilesError) throw profilesError;

      // Get task counts for each client
      const clientsWithTasks = await Promise.all(
        profiles.map(async (profile) => {
          const { data: tasks } = await supabase
            .from('tasks')
            .select('status')
            .eq('assigned_to', profile.user_id);

          const taskCounts = {
            total: tasks?.length || 0,
            completed: tasks?.filter((t) => t.status === 'completed').length || 0,
            pending: tasks?.filter((t) => t.status === 'pending').length || 0,
          };

          return { ...profile, taskCounts };
        })
      );

      return clientsWithTasks;
    },
  });

  return (
    <DashboardLayout isAdmin>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Clients
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage client accounts and view their progress
          </p>
        </div>

        {/* Clients Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : clients && clients.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {clients.map((client) => (
              <div
                key={client.id}
                className="stoic-card p-6 hover:border-primary/30 transition-all duration-200"
              >
                <div className="flex items-start gap-4 mb-4">
                  <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-primary text-lg font-medium">
                      {client.full_name?.charAt(0) || client.email.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-heading font-medium text-foreground truncate">
                      {client.full_name || 'Unnamed Client'}
                    </h3>
                    <p className="text-sm text-muted-foreground truncate flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {client.email}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="text-center p-2 rounded-lg bg-muted">
                    <p className="text-lg font-semibold text-foreground">
                      {client.taskCounts.total}
                    </p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-green-500/10">
                    <p className="text-lg font-semibold text-green-400">
                      {client.taskCounts.completed}
                    </p>
                    <p className="text-xs text-muted-foreground">Done</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-yellow-500/10">
                    <p className="text-lg font-semibold text-yellow-400">
                      {client.taskCounts.pending}
                    </p>
                    <p className="text-xs text-muted-foreground">Pending</p>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Joined {new Date(client.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="stoic-card p-12 text-center">
            <Users className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-heading text-xl font-semibold text-foreground mb-2">
              No clients yet
            </h3>
            <p className="text-muted-foreground">
              Clients will appear here once they sign up
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminClients;
