import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Users, Mail, FolderOpen, MessageCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

type ClientWhatsappDraft = {
  whatsapp_phone_e164: string;
  whatsapp_opt_in: boolean;
};

const AdminClients: React.FC = () => {
  const { userRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [whatsappDrafts, setWhatsappDrafts] = useState<Record<string, ClientWhatsappDraft>>({});

  const normalizeWhatsappPhone = (value: string) => {
    const digits = value.replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  };

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

      return profiles;
    },
  });

  React.useEffect(() => {
    if (!clients) return;

    setWhatsappDrafts((current) => {
      const next = { ...current };
      for (const client of clients) {
        next[client.user_id] = next[client.user_id] || {
          whatsapp_phone_e164: client.whatsapp_phone_e164 || '',
          whatsapp_opt_in: client.whatsapp_opt_in || false,
        };
      }
      return next;
    });
  }, [clients]);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: assignedCategories } = useQuery({
    queryKey: ['client-categories', selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data, error } = await supabase
        .from('category_assignments')
        .select('category_id')
        .eq('user_id', selectedClientId);
      if (error) throw error;
      return data.map((d) => d.category_id);
    },
    enabled: !!selectedClientId,
  });

  React.useEffect(() => {
    if (assignedCategories) {
      setSelectedCategories(assignedCategories);
    }
  }, [assignedCategories]);

  const updateCategoriesMutation = useMutation({
    mutationFn: async (categoryIds: string[]) => {
      if (!selectedClientId) throw new Error('No client selected');

      // Delete existing assignments
      await supabase
        .from('category_assignments')
        .delete()
        .eq('user_id', selectedClientId);

      // Insert new assignments
      if (categoryIds.length > 0) {
        const { error } = await supabase.from('category_assignments').insert(
          categoryIds.map((catId) => ({
            user_id: selectedClientId,
            category_id: catId,
          }))
        );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Categories updated for client' });
      queryClient.invalidateQueries({ queryKey: ['client-categories'] });
    },
    onError: (error) => {
      toast({ title: 'Error', description: 'Failed to update categories', variant: 'destructive' });
      console.error(error);
    },
  });

  const banMutation = useMutation({
    mutationFn: async ({
      userId,
      isBanned,
    }: {
      userId: string;
      isBanned: boolean;
    }) => {
      const reason = isBanned
        ? window.prompt('Reason for banning this client?') || ''
        : '';

      const { error } = await supabase.rpc('set_user_ban_status', {
        p_target_user_id: userId,
        p_is_banned: isBanned,
        p_reason: reason.trim() || null,
      });

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-clients'] });
      toast({
        title: variables.isBanned ? 'Client banned' : 'Client unbanned',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Ban update failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateWhatsappMutation = useMutation({
    mutationFn: async ({
      userId,
      whatsapp_phone_e164,
      whatsapp_opt_in,
    }: {
      userId: string;
      whatsapp_phone_e164: string;
      whatsapp_opt_in: boolean;
    }) => {
      const normalizedPhone = normalizeWhatsappPhone(whatsapp_phone_e164);
      const { error } = await supabase
        .from('profiles')
        .update({
          whatsapp_phone_e164: normalizedPhone || null,
          whatsapp_opt_in: normalizedPhone ? whatsapp_opt_in : false,
        })
        .eq('user_id', userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-clients'] });
      toast({
        title: 'WhatsApp settings saved',
        description: 'The client can now use the order bot once the number is verified in Meta.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'WhatsApp settings failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return (
    <DashboardLayout>
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
              <div key={client.id} className="stoic-card p-6 hover:border-primary/30 transition-all duration-200">
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

                <div className="flex items-center justify-between gap-2 mt-4">
                  <p className="text-xs text-muted-foreground">
                    Joined {new Date(client.created_at).toLocaleDateString()}
                  </p>
                  {client.is_banned ? (
                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                      Banned
                    </Badge>
                  ) : null}
                </div>

                {client.banned_reason ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Ban reason: {client.banned_reason}
                  </p>
                ) : null}

                <div className="mt-4 rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <MessageCircle className="h-4 w-4 text-green-500" />
                    WhatsApp Bot
                  </div>
                  <Input
                    value={whatsappDrafts[client.user_id]?.whatsapp_phone_e164 ?? client.whatsapp_phone_e164 ?? ''}
                    onChange={(e) =>
                      setWhatsappDrafts((current) => ({
                        ...current,
                        [client.user_id]: {
                          whatsapp_phone_e164: e.target.value,
                          whatsapp_opt_in:
                            current[client.user_id]?.whatsapp_opt_in ?? client.whatsapp_opt_in ?? false,
                        },
                      }))
                    }
                    placeholder="+919876543210"
                    className="bg-input border-border"
                  />
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={whatsappDrafts[client.user_id]?.whatsapp_opt_in ?? client.whatsapp_opt_in ?? false}
                      onCheckedChange={(checked) =>
                        setWhatsappDrafts((current) => ({
                          ...current,
                          [client.user_id]: {
                            whatsapp_phone_e164:
                              current[client.user_id]?.whatsapp_phone_e164 ?? client.whatsapp_phone_e164 ?? '',
                            whatsapp_opt_in: checked === true,
                          },
                        }))
                      }
                    />
                    Enable order replies for this number
                  </label>
                  {client.whatsapp_phone_e164 ? (
                    <p className="text-xs text-muted-foreground">
                      Linked number: {client.whatsapp_phone_e164}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Save an E.164 number to let this client query order details over WhatsApp.
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      updateWhatsappMutation.mutate({
                        userId: client.user_id,
                        whatsapp_phone_e164:
                          whatsappDrafts[client.user_id]?.whatsapp_phone_e164 ?? client.whatsapp_phone_e164 ?? '',
                        whatsapp_opt_in:
                          whatsappDrafts[client.user_id]?.whatsapp_opt_in ?? client.whatsapp_opt_in ?? false,
                      })
                    }
                    disabled={updateWhatsappMutation.isPending}
                  >
                    {updateWhatsappMutation.isPending ? 'Saving...' : 'Save WhatsApp'}
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-2 mt-4">
                  <Dialog open={selectedClientId === client.user_id} onOpenChange={(open) => {
                    if (open) {
                      setSelectedClientId(client.user_id);
                    } else {
                      setSelectedClientId(null);
                    }
                  }}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        <FolderOpen className="h-4 w-4 mr-1" />
                        Assign Categories
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-card border-border">
                      <DialogHeader>
                        <DialogTitle className="font-heading">
                          Assign Categories to {client.full_name || client.email}
                        </DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        {categories?.map((cat: any) => (
                          <div key={cat.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={cat.id}
                              checked={selectedCategories.includes(cat.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedCategories([...selectedCategories, cat.id]);
                                } else {
                                  setSelectedCategories(selectedCategories.filter((c) => c !== cat.id));
                                }
                              }}
                            />
                            <label htmlFor={cat.id} className="text-sm cursor-pointer">
                              {cat.name}
                            </label>
                          </div>
                        ))}
                        <Button
                          onClick={() => updateCategoriesMutation.mutate(selectedCategories)}
                          disabled={updateCategoriesMutation.isPending}
                          className="w-full"
                        >
                          {updateCategoriesMutation.isPending ? 'Saving...' : 'Save Categories'}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  {(userRole === 'admin' || userRole === 'owner') && (
                    <Button
                      size="sm"
                      variant={client.is_banned ? 'outline' : 'destructive'}
                      onClick={() =>
                        banMutation.mutate({
                          userId: client.user_id,
                          isBanned: !client.is_banned,
                        })
                      }
                      disabled={banMutation.isPending}
                    >
                      {client.is_banned ? 'Unban' : 'Ban'}
                    </Button>
                  )}
                </div>
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
