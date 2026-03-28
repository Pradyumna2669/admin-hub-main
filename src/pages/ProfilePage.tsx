import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  canUsePush,
  ensurePushSubscription,
  fetchPushSubscriptionCount,
  getPushSubscriptionErrorMessage,
  getPushSupportDetails,
  requestNotificationPermission,
  resetPushAutoSyncAttempt,
  sendTestPush,
} from '@/lib/pushNotifications';
import { getUserUploadsObjectPath } from '@/lib/storagePaths';
import {
  ExternalLink,
  Globe2,
  ImageIcon,
  Link as LinkIcon,
  MessageSquare,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LeagueBadge } from '@/components/badges/LeagueBadge';
import { LEAGUE_LABELS, normalizeLeague } from '@/lib/workerLeagues';
import { WorkerProfileForm } from '@/components/auth/WorkerProfileForm';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getAccountLeague, getSortedRedditAccounts } from '@/lib/redditAccounts';
import { DiscordVerificationCard } from '@/components/DiscordVerificationCard';
import {
  compressImageForUpload,
  getUploadFileExtension,
  IMAGE_UPLOAD_PRESETS,
} from '@/lib/imageUpload';

type ProfileRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  reddit_username?: string | null;
  reddit_profile?: string | null;
  reddit_data?: unknown;
  upi_id?: string | null;
  timezone?: string | null;
  karma?: number | null;
  cqs?: string | null;
  league?: string | null;
  is_verified?: boolean | null;
  created_at?: string;
  updated_at?: string;
  avatar_url?: string | null;
};

type RedditAccountRow = {
  id: string;
  reddit_username: string | null;
  reddit_profile: string | null;
  is_verified: boolean | null;
  karma: number | null;
  karma_range: string | null;
  cqs: string | null;
  cqs_proof?: string | null;
  reddit_data?: unknown;
  avatar_url?: string | null;
  created_at?: string | null;
};

type RedditData = {
  cqsLink?: string;
  timezone?: string;
  referredBy?: string;
  discordUsername?: string;
  redditScreenshot?: string;
};

const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};

const parseRedditData = (value: unknown): RedditData => {
  if (!value) return {};

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as RedditData) : {};
    } catch {
      return {};
    }
  }

  return typeof value === 'object' ? (value as RedditData) : {};
};

const ProfilePage: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<RedditAccountRow | null>(null);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['my-profile', user?.id],
    queryFn: async (): Promise<ProfileRow> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user?.id)
        .single();

      if (error) throw error;
      return data as ProfileRow;
    },
    enabled: !!user?.id,
  });

  const { data: redditAccounts } = useQuery({
    queryKey: ['my-reddit-accounts', user?.id],
    queryFn: async (): Promise<RedditAccountRow[]> => {
      const { data, error } = await supabase
        .from('reddit_accounts')
        .select('id, reddit_username, reddit_profile, is_verified, karma, karma_range, cqs, cqs_proof, reddit_data, avatar_url, created_at')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as RedditAccountRow[];
    },
    enabled: !!user?.id,
  });

  const deleteRedditAccountMutation = useMutation({
    mutationFn: async (account: RedditAccountRow) => {
      if (!user?.id) throw new Error('Not logged in');

      const { data: deletedRow, error: deleteError } = await supabase
        .from('reddit_accounts')
        .delete()
        .select('id')
        .eq('id', account.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (deleteError) throw deleteError;
      if (!deletedRow?.id) {
        throw new Error('Delete was blocked or no Reddit account matched this user.');
      }

      return {
        deletedAccountId: account.id,
      };
    },
    onSuccess: ({ deletedAccountId }) => {
      queryClient.setQueryData<RedditAccountRow[] | undefined>(
        ['my-reddit-accounts', user?.id],
        (current) => (current || []).filter((item) => item.id !== deletedAccountId)
      );
      setAccountToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['my-reddit-accounts', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['my-profile', user?.id] });
      toast({
        title: 'Reddit account deleted',
        description: 'All removable data linked to that Reddit account has been cleared.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Delete failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const initialName = useMemo(() => profile?.full_name || '', [profile?.full_name]);
  const redditData = useMemo(() => parseRedditData(profile?.reddit_data), [profile?.reddit_data]);
  const sortedRedditAccounts = useMemo(
    () => getSortedRedditAccounts(redditAccounts || []),
    [redditAccounts]
  );
  const [fullName, setFullName] = useState(initialName);
  const [upiId, setUpiId] = useState(profile?.upi_id || '');
  const [timezone, setTimezone] = useState(profile?.timezone || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installReady, setInstallReady] = useState(false);
  const [pushSupport, setPushSupport] = useState(() => getPushSupportDetails());
  const [subscriptionCount, setSubscriptionCount] = useState<number | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [redditScreenshotUrl, setRedditScreenshotUrl] = useState<string | null>(null);

  React.useEffect(() => {
    setFullName(initialName);
    setUpiId(profile?.upi_id || '');
    setTimezone(profile?.timezone || '');
  }, [initialName, profile?.upi_id, profile?.timezone]);

  React.useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }

    setPushSupport(getPushSupportDetails());

    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallReady(true);
    };

    window.addEventListener('beforeinstallprompt', handler as EventListener);
    return () => window.removeEventListener('beforeinstallprompt', handler as EventListener);
  }, []);

  React.useEffect(() => {
    if (!user?.id) return;
    let active = true;
    setSubscriptionLoading(true);
    fetchPushSubscriptionCount(user.id)
      .then((count) => {
        if (active) setSubscriptionCount(count);
      })
      .catch(() => {
        if (active) setSubscriptionCount(null);
      })
      .finally(() => {
        if (active) setSubscriptionLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  React.useEffect(() => {
    let active = true;

    const loadRedditScreenshot = async () => {
      const rawScreenshot = redditData.redditScreenshot || null;
      if (!rawScreenshot) {
        setRedditScreenshotUrl(null);
        return;
      }

      const path = getUserUploadsObjectPath(rawScreenshot);
      if (!path) {
        setRedditScreenshotUrl(rawScreenshot);
        return;
      }

      const { data } = await supabase.storage
        .from('user_uploads')
        .createSignedUrl(path, 60 * 60);

      if (active) {
        setRedditScreenshotUrl(data?.signedUrl || null);
      }
    };

    void loadRedditScreenshot();

    return () => {
      active = false;
    };
  }, [redditData.redditScreenshot]);

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Not logged in');

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim() || null,
          upi_id: upiId.trim() || null,
          timezone: timezone.trim() || null,
        })
        .eq('user_id', user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      toast({ title: 'Updated', description: 'Name updated successfully.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  return (
    <DashboardLayout>
      <div className="max-w-5xl space-y-6">
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Profile
          </h1>
          <p className="mt-1 text-muted-foreground">
            View your account details. You can update your name, UPI ID, and timezone.
          </p>
          <div className="mt-2">
            <LeagueBadge league={profile?.league} showLabel />
          </div>
        </div>

        <Card className="space-y-6 p-6">
          {isLoading ? (
            <p>Loading...</p>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16 border border-border/60 bg-muted/20">
                  {profile?.avatar_url ? (
                    <AvatarImage src={profile.avatar_url} alt={profile?.full_name || profile?.email} />
                  ) : null}
                  <AvatarFallback className="font-semibold">
                    {(fullName || profile?.email || 'U').trim().charAt(0).toUpperCase() + '.'}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-2">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      if (!file) {
                        setAvatarFile(null);
                        setAvatarError(null);
                        return;
                      }
                      if (!file.type.startsWith('image/')) {
                        setAvatarError('Only image files are allowed.');
                        setAvatarFile(null);
                        return;
                      }
                      if (file.size > 3 * 1024 * 1024) {
                        setAvatarError('Max size 3MB.');
                        setAvatarFile(null);
                        return;
                      }
                      setAvatarError(null);
                      setAvatarFile(file);
                    }}
                  />
                  {avatarError ? <div className="text-xs text-destructive">{avatarError}</div> : null}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!avatarFile || !!avatarError}
                    onClick={async () => {
                      if (!avatarFile || !user?.id) return;
                      const optimizedAvatar = await compressImageForUpload(
                        avatarFile,
                        IMAGE_UPLOAD_PRESETS.avatar
                      );
                      const ext = getUploadFileExtension(optimizedAvatar);
                      const path = `avatars/${user.id}.${ext}`;
                      const { error: uploadErr } = await supabase.storage
                        .from('user_avatars')
                        .upload(path, optimizedAvatar, { upsert: true });
                      if (uploadErr) {
                        toast({ title: 'Avatar upload failed', description: uploadErr.message, variant: 'destructive' });
                        return;
                      }
                      const { data: publicUrl } = supabase.storage.from('user_avatars').getPublicUrl(path);
                      const url = publicUrl.publicUrl;
                      const { error: updateErr } = await supabase
                        .from('profiles')
                        .update({ avatar_url: url })
                        .eq('user_id', user.id);
                      if (updateErr) {
                        toast({ title: 'Failed to save avatar', description: updateErr.message, variant: 'destructive' });
                        return;
                      }
                      setAvatarFile(null);
                      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
                      toast({ title: 'Avatar updated' });
                    }}
                  >
                    Save Avatar
                  </Button>
                </div>
              </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input value={profile?.email || user?.email || ''} readOnly className="border-border bg-input" />
                  </div>

                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your name"
                      className="border-border bg-input"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>UPI ID</Label>
                    <Input
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                      placeholder="example@upi"
                      className="border-border bg-input"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Timezone</Label>
                    <Input
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="IST"
                      className="border-border bg-input"
                    />
                  </div>
                </div>

              <div className="flex justify-end">
                <Button
                  className="stoic-button-primary"
                  onClick={() => updateProfileMutation.mutate()}
                  disabled={updateProfileMutation.isPending}
                >
                  {updateProfileMutation.isPending ? 'Saving...' : 'Save Profile'}
                </Button>
              </div>

              <div className="space-y-6 border-t border-border pt-6">
                <h2 className="font-heading text-lg font-semibold">Details</h2>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="text-sm font-medium">Primary Reddit Username</div>
                    <div className="mt-1 break-words text-sm text-muted-foreground">
                      {formatValue(profile?.reddit_username)}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="text-sm font-medium">UPI ID</div>
                    <div className="mt-1 break-words text-sm text-muted-foreground">
                      {formatValue(profile?.upi_id)}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="text-sm font-medium">Timezone</div>
                    <div className="mt-1 break-words text-sm text-muted-foreground">
                      {formatValue(profile?.timezone || redditData.timezone)}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="text-sm font-medium">League</div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <LeagueBadge league={profile?.league} />
                      <span>{LEAGUE_LABELS[normalizeLeague(profile?.league) || 'bronze']}</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="text-sm font-medium">Reddit Profile</div>
                    {profile?.reddit_profile ? (
                      <a
                        href={profile.reddit_profile}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-2 break-all text-sm text-primary hover:underline"
                      >
                        <span>Open profile</span>
                        <ExternalLink className="h-4 w-4 shrink-0" />
                      </a>
                    ) : (
                      <div className="mt-1 break-words text-sm text-muted-foreground">
                        {formatValue(profile?.reddit_profile)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4 border-t border-border pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">Reddit Accounts</div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Add and verify multiple Reddit accounts. You will choose an account when claiming tasks.
                      </p>
                    </div>
                    <Button onClick={() => setAddAccountOpen(true)}>Add Reddit Account</Button>
                  </div>

                  {sortedRedditAccounts.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {sortedRedditAccounts.map((account) => (
                          <div key={account.id} className="rounded-xl border border-border bg-muted/20 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <div className="font-semibold">u/{account.reddit_username}</div>
                                {account.reddit_username === profile?.reddit_username ? (
                                  <Badge variant="secondary">Primary</Badge>
                                ) : null}
                              </div>
                              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                <LeagueBadge league={getAccountLeague(account)} />
                                <span>{LEAGUE_LABELS[getAccountLeague(account)]}</span>
                              </div>
                            </div>
                            <Badge variant="outline">
                              {account.is_verified ? 'Verified' : 'Pending'}
                            </Badge>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            Karma: {account.karma ?? account.karma_range ?? '-'} | CQS: {account.cqs ?? '-'}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {account.reddit_profile ? (
                              <a
                                href={account.reddit_profile}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-xs text-primary hover:underline"
                              >
                                <span>Open profile</span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-destructive hover:text-destructive"
                              onClick={() => setAccountToDelete(account)}
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-muted/10 p-4 text-sm text-muted-foreground">
                      No Reddit accounts added yet.
                    </div>
                  )}
                </div>

                <div className="space-y-4 border-t border-border pt-6">
                  <div>
                    <div className="text-lg font-semibold">Discord Status</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Your profile remains unverified until Discord linking, server join, and role
                      sync are complete.
                    </p>
                  </div>

                  <DiscordVerificationCard />
                </div>

                <div className="space-y-4 border-t border-border pt-6">
                  <div>
                    <div className="text-lg font-semibold">Notifications</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Enable push notifications for instant task and chat alerts.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        if (!user?.id) return;
                        if (!canUsePush()) {
                          toast({
                            title: 'Push not supported',
                            description: 'This device or browser does not support Web Push.',
                            variant: 'destructive',
                          });
                          return;
                        }
                        const permission = await requestNotificationPermission();
                        setNotificationPermission(permission);
                        if (permission === 'granted') {
                          try {
                            resetPushAutoSyncAttempt(user.id);
                            const synced = await ensurePushSubscription(user.id, { force: true });
                            const count = await fetchPushSubscriptionCount(user.id);
                            setSubscriptionCount(count);
                            if (synced || count > 0) {
                              toast({ title: 'Notifications enabled' });
                            } else {
                              toast({
                                title: 'Permission granted',
                                description: 'Notification permission was granted, but the device subscription could not be confirmed yet.',
                              });
                            }
                          } catch (error) {
                            toast({
                              title: 'Subscription failed',
                              description: getPushSubscriptionErrorMessage(error),
                              variant: 'destructive',
                            });
                          }
                        }
                      }}
                    >
                      Enable Notifications
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      disabled={subscriptionLoading || !user?.id}
                      onClick={async () => {
                        if (!user?.id) return;
                        setSubscriptionLoading(true);
                        try {
                          const count = await fetchPushSubscriptionCount(user.id);
                          setSubscriptionCount(count);
                          toast({ title: 'Subscription checked' });
                        } catch (error) {
                          toast({
                            title: 'Check failed',
                            description: error instanceof Error ? error.message : 'Failed to check subscription.',
                            variant: 'destructive',
                          });
                        } finally {
                          setSubscriptionLoading(false);
                        }
                      }}
                    >
                      {subscriptionLoading ? 'Checking...' : 'Check Subscription'}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        try {
                          if (!user?.id) return;
                          const result = await sendTestPush(user.id);
                          toast({
                            title: 'Test sent',
                            description: `Sent to ${result?.sent ?? 0} device(s).`,
                          });
                        } catch (error) {
                          toast({
                            title: 'Test failed',
                            description: error instanceof Error ? error.message : 'Failed to send test push.',
                            variant: 'destructive',
                          });
                        }
                      }}
                    >
                      Send Test Push
                    </Button>

                    {installReady ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={async () => {
                          if (!installPrompt) return;
                          await installPrompt.prompt();
                          const result = await installPrompt.userChoice;
                          if (result.outcome === 'accepted') {
                            setInstallReady(false);
                            setInstallPrompt(null);
                          }
                        }}
                      >
                        Install App
                      </Button>
                    ) : null}

                    <div className="text-xs text-muted-foreground">
                      Permission: {notificationPermission || 'unknown'}
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Support: key {pushSupport.hasKey ? 'ok' : 'missing'}, notification{' '}
                    {pushSupport.hasNotification ? 'ok' : 'no'}, service worker{' '}
                    {pushSupport.hasServiceWorker ? 'ok' : 'no'}, push manager{' '}
                    {pushSupport.hasPushManager ? 'ok' : 'no'}, secure context{' '}
                    {pushSupport.isSecureContext ? 'ok' : 'no'}. Subscription:{' '}
                    {subscriptionCount === null ? 'unknown' : subscriptionCount}.
                  </div>

                  <div className="text-xs text-muted-foreground">
                    iOS Safari requires installing the app to receive push notifications.
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-lg font-semibold">Reddit Details</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Your Reddit verification information is shown in a structured format.
                    </p>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                    <div className="rounded-2xl border border-border bg-card/60 p-5">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-xl border border-border bg-muted/20 p-4">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Globe2 className="h-4 w-4 text-primary" />
                            Timezone
                          </div>
                          <div className="mt-2 break-words text-sm text-muted-foreground">
                            {formatValue(profile?.timezone || redditData.timezone)}
                          </div>
                        </div>

                        <div className="rounded-xl border border-border bg-muted/20 p-4">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <MessageSquare className="h-4 w-4 text-primary" />
                            Discord Username
                          </div>
                          <div className="mt-2 break-words text-sm text-muted-foreground">
                            {formatValue(redditData.discordUsername)}
                          </div>
                        </div>

                        <div className="rounded-xl border border-border bg-muted/20 p-4">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <UserPlus className="h-4 w-4 text-primary" />
                            Referral Code Used
                          </div>
                          <div className="mt-2 break-words text-sm text-muted-foreground">
                            {formatValue(redditData.referredBy)}
                          </div>
                        </div>

                        <div className="rounded-xl border border-border bg-muted/20 p-4">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <LinkIcon className="h-4 w-4 text-primary" />
                            CQS Link
                          </div>
                          {redditData.cqsLink ? (
                            <a
                              href={redditData.cqsLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-start gap-2 break-all text-sm text-primary hover:underline"
                            >
                              <span>Open CQS post</span>
                              <ExternalLink className="mt-0.5 h-4 w-4 shrink-0" />
                            </a>
                          ) : (
                            <div className="mt-2 break-words text-sm text-muted-foreground">
                              {formatValue(redditData.cqsLink)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-card/60 p-5">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <ImageIcon className="h-4 w-4 text-primary" />
                        Reddit Screenshot
                      </div>

                      {redditScreenshotUrl ? (
                        <a
                          href={redditScreenshotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-4 block overflow-hidden rounded-xl border border-border bg-muted/20"
                        >
                          <img
                            src={redditScreenshotUrl}
                            alt="Reddit verification screenshot"
                            className="h-64 w-full object-cover object-top"
                          />
                        </a>
                      ) : (
                        <div className="mt-4 flex h-64 items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 text-sm text-muted-foreground">
                          No screenshot uploaded
                        </div>
                      )}

                      {redditScreenshotUrl && (
                        <a
                          href={redditScreenshotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-2 break-all text-sm text-primary hover:underline"
                        >
                          <span>Open full screenshot</span>
                          <ExternalLink className="h-4 w-4 shrink-0" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      <Dialog open={addAccountOpen} onOpenChange={setAddAccountOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Reddit Account</DialogTitle>
          </DialogHeader>
          {user?.id ? (
            <WorkerProfileForm
              userId={user.id}
              existingUpiId={profile?.upi_id || null}
              onComplete={() => {
                setAddAccountOpen(false);
                queryClient.invalidateQueries({ queryKey: ['my-reddit-accounts'] });
                queryClient.invalidateQueries({ queryKey: ['my-profile'] });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!accountToDelete}
        onOpenChange={(open) => {
          if (!open && !deleteRedditAccountMutation.isPending) {
            setAccountToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Reddit Account</AlertDialogTitle>
            <AlertDialogDescription>
              {accountToDelete?.reddit_username
                ? `This will delete u/${accountToDelete.reddit_username} from your profile and remove related saved Reddit data for that account.`
                : 'This will delete the selected Reddit account from your profile and remove related saved Reddit data for that account.'}
            </AlertDialogDescription>
            <AlertDialogDescription>
              If this account is currently your primary Reddit account, the profile will switch to your oldest remaining Reddit account. This action cannot be undone. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRedditAccountMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!accountToDelete || deleteRedditAccountMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!accountToDelete) return;
                deleteRedditAccountMutation.mutate(accountToDelete);
              }}
            >
              {deleteRedditAccountMutation.isPending ? 'Deleting...' : 'Yes, delete account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default ProfilePage;

