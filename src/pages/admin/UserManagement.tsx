import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Search } from 'lucide-react';
import { FaDiscord, FaGoogle } from 'react-icons/fa';
import { MdEmail } from 'react-icons/md';

const ROLE_PRIORITY: Record<'owner' | 'admin' | 'moderator' | 'worker' | 'client', number> = {
  owner: 5,
  admin: 4,
  moderator: 3,
  worker: 2,
  client: 1,
};

const normalizeRole = (value: unknown) => {
  return value === 'owner' ||
    value === 'admin' ||
    value === 'moderator' ||
    value === 'worker' ||
    value === 'client'
    ? value
    : null;
};

const pickHighestPriorityRole = (roles: unknown[]) => {
  let bestRole: ReturnType<typeof normalizeRole> = null;

  roles.forEach((role) => {
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole) return;

    if (!bestRole || ROLE_PRIORITY[normalizedRole] > ROLE_PRIORITY[bestRole]) {
      bestRole = normalizedRole;
    }
  });

  return bestRole;
};

const UserManagement: React.FC = () => {
  const { userRole, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: users, isLoading } = useQuery({
    queryKey: ['user-management-users'],
    queryFn: async () => {
      const profilesPromise = supabase
        .from('profiles')
        .select('user_id, full_name, email, reddit_username, auth_provider')
        .then(async ({ data, error }) => {
          if (!error) return { data, error: null };

          // Backward compatibility: if the DB doesn't have `auth_provider` yet,
          // PostgREST returns 400 "column does not exist". Retry without it.
          const msg = (error as any)?.message?.toLowerCase?.() || '';
          const details = (error as any)?.details?.toLowerCase?.() || '';
          const hints = (error as any)?.hint?.toLowerCase?.() || '';
          const mentionsAuthProvider =
            msg.includes('auth_provider') ||
            details.includes('auth_provider') ||
            hints.includes('auth_provider');
          const mentionsMissingColumn = msg.includes('column') || msg.includes('does not exist');

          if (mentionsAuthProvider && mentionsMissingColumn) {
            return supabase
              .from('profiles')
              .select('user_id, full_name, email, reddit_username');
          }

          return { data: null, error };
        });

      const rolesPromise = supabase.from('user_roles').select('user_id, role');

      const providersPromise = supabase
        .rpc('list_user_auth_providers')
        .then(({ data, error }) => {
          if (error) return { data: null, error };
          return { data, error: null };
        })
        .catch((error) => ({ data: null, error }));

      const [
        { data: profiles, error: profilesError },
        { data: roles, error: rolesError },
        { data: providers, error: providersError },
      ] = await Promise.all([profilesPromise, rolesPromise, providersPromise]);

      if (profilesError) throw profilesError;
      if (rolesError) throw rolesError;
      // Providers RPC is optional (migration may not be applied yet)
      if (providersError) {
        const code = (providersError as any)?.code;
        // PGRST202 = function not found in schema cache (migration not applied yet / cache not refreshed)
        if (code !== 'PGRST202') {
          console.warn(
            'Provider lookup failed:',
            (providersError as any)?.message || providersError
          );
        }
      }

      const providerByUserId = new Map<string, string>();
      (providers || []).forEach((p: any) => {
        if (p?.user_id && p?.provider && !providerByUserId.has(p.user_id)) {
          providerByUserId.set(p.user_id, p.provider);
        }
      });

      const rolesByUserId = new Map<string, string[]>();
      (roles || []).forEach((r: any) => {
        if (!r?.user_id || !r?.role) return;
        const existingRoles = rolesByUserId.get(r.user_id) || [];
        existingRoles.push(r.role);
        rolesByUserId.set(r.user_id, existingRoles);
      });

      const usersFromProfiles =
        (profiles || []).map((p: any) => ({
          user_id: p.user_id,
          role: pickHighestPriorityRole(rolesByUserId.get(p.user_id) || []),
          profiles: {
            ...p,
            auth_provider: providerByUserId.get(p.user_id) || p.auth_provider,
          },
        })) || [];

      // If any rows exist in user_roles without a profiles row, still show them.
      const profileByUserId = new Set((profiles || []).map((p: any) => p.user_id));
      const usersFromRolesOnly =
        (roles || [])
          .filter((r: any) => r?.user_id && !profileByUserId.has(r.user_id))
          .reduce((acc: Map<string, any>, r: any) => {
            const existing = acc.get(r.user_id);
            if (!existing) {
              acc.set(r.user_id, {
                user_id: r.user_id,
                role: r.role,
                profiles: null,
              });
              return acc;
            }

            existing.role = pickHighestPriorityRole([existing.role, r.role]);
            return acc;
          }, new Map<string, any>())
          .values();
      const usersFromRolesOnlyList = Array.from(usersFromRolesOnly);

      return [...usersFromProfiles, ...usersFromRolesOnlyList];
    },
  });

  const formatAuthProvider = (provider?: string | null) => {
    const normalized = (provider || '').trim().toLowerCase();
    if (!normalized) return 'Email';

    if (normalized === 'discord') return 'Discord';
    if (normalized === 'google') return 'Google';
    if (normalized === 'email') return 'Email';

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

  const authProviderIcon = (provider?: string | null) => {
    const normalized = (provider || '').trim().toLowerCase();
    if (normalized === 'discord') return <FaDiscord className="h-4 w-4 text-[#5865F2]" />;
    if (normalized === 'google') return <FaGoogle className="h-4 w-4 text-[#DB4437]" />;
    return <MdEmail className="h-4 w-4 text-muted-foreground" />;
  };

  const roleMutation = useMutation({
    mutationFn: async ({
      userId,
      newRole,
      oldRole,
      email,
      fullName,
    }: any) => {
      if (userRole !== 'owner') {
        throw new Error('Only owner can change roles');
      }

      // Replace any existing rows so each user ends up with one canonical role.
      const { error: deleteError } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase.from('user_roles').insert({
        user_id: userId,
        role: newRole,
      });
      if (insertError) throw insertError;

      // 2. Get acting admin/owner profile
      const { data: actorProfile } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('user_id', user?.id)
        .single();

      // 3. Insert activity log
      const { error: logError } = await supabase
        .from('activity_logs')
        .insert({
          user_id: user?.id,
          action: 'user_role_updated',
          entity_type: 'user',
          entity_id: userId,
          details: {
            target_user_id: userId,
            target_user_name: fullName || 'Unknown',
            target_user_email: email || 'Unknown',
            old_role: oldRole || 'unknown',
            new_role: newRole,
            changed_by_name: actorProfile?.full_name || 'Admin',
            changed_by_email: actorProfile?.email || user?.email,
          },
        });

      if (logError) {
        console.warn('Activity log failed:', logError.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-management-users'] });
      toast({
        title: 'Role updated',
        description: 'User role updated successfully.',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const filteredUsers =
    users?.filter((u: any) => {
      const name = u.profiles?.full_name?.toLowerCase() || '';
      const email = u.profiles?.email?.toLowerCase() || '';
      const reddit = u.profiles?.reddit_username?.toLowerCase() || '';
      const query = searchQuery.toLowerCase();

      return (
        name.includes(query) ||
        email.includes(query) ||
        reddit.includes(query)
      );
    }) || [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">User Management</h1>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by email, name, or Reddit ID..."
            className="pl-10"
          />
        </div>

        {isLoading ? (
          <p>Loading...</p>
        ) : filteredUsers.length > 0 ? (
          <div className="space-y-3">
            {filteredUsers.map((u: any) => (
              <Card
                key={u.user_id}
                className="p-4 flex justify-between items-center"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center"
                      title={`Login: ${formatAuthProvider(u.profiles?.auth_provider)}`}
                    >
                      {authProviderIcon(u.profiles?.auth_provider)}
                    </span>
                    <p className="font-semibold">
                      {u.profiles?.full_name || 'No name'}
                    </p>
                    <span className="text-[11px] px-2 py-0.5 rounded-full border bg-muted text-muted-foreground">
                      {formatAuthProvider(u.profiles?.auth_provider)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {u.profiles?.email || u.user_id}
                  </p>
                  {u.profiles?.reddit_username && (
                    <p className="text-xs text-muted-foreground">
                      Reddit: {u.profiles.reddit_username}
                    </p>
                  )}
                  {!u.profiles && (
                    <p className="text-xs text-muted-foreground">
                      Profile missing
                    </p>
                  )}
                </div>

                {userRole === 'owner' ? (
                  <Select
                    value={u.role || undefined}
                    onValueChange={(value) =>
                      roleMutation.mutate({
                        userId: u.user_id,
                        newRole: value,
                        oldRole: u.role,
                        email: u.profiles?.email,
                        fullName: u.profiles?.full_name,
                      })
                    }
                    disabled={u.role === 'owner'}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="Set role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="worker">Tasker</SelectItem>
                      <SelectItem value="client">Client</SelectItem>
                      <SelectItem value="moderator">Moderator</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="owner">Owner</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="font-semibold capitalize">
                    {u.role || '—'}
                  </span>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <p>No users found.</p>
        )}
      </div>
    </DashboardLayout>
  );
};

export default UserManagement;
