import React, { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { BadgeCheck, Link2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { FaDiscord } from 'react-icons/fa';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  DiscordVerificationStatus,
  getDiscordAuthCallbackError,
  startDiscordIdentityLink,
  syncDiscordVerification,
} from '@/lib/discordVerification';
import { DISCORD_INVITE_URL } from '@/lib/communityLinks';

interface DiscordVerificationCardProps {
  className?: string;
}

export const DiscordVerificationCard: React.FC<DiscordVerificationCardProps> = ({
  className,
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const autoSyncTriggeredRef = useRef(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ['discord-verification', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'discord_user_id, discord_username, discord_in_server, discord_verified, discord_last_checked_at, discord_verified_at',
        )
        .eq('user_id', user?.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return (data || null) as DiscordVerificationStatus | null;
    },
    enabled: !!user?.id,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const redirectPath = `${location.pathname}?discord=linked`;
      await startDiscordIdentityLink(redirectPath);
    },
    onError: (error: Error) => {
      toast({
        title: 'Discord connect failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: syncDiscordVerification,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['discord-verification', user?.id] }),
        queryClient.invalidateQueries({ queryKey: ['my-profile', user?.id] }),
      ]);

      toast({
        title: result?.verified ? 'Discord verified' : 'Discord not verified yet',
        description: result?.verified
          ? 'Your Discord account is linked and your server role is active.'
          : result?.in_server
            ? 'Discord is linked, but the verified role is still pending.'
            : 'Join the Discord server and try verification again.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Discord verification failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  useEffect(() => {
    const callbackError = getDiscordAuthCallbackError(location.search);
    if (!callbackError) {
      return;
    }

    toast({
      title: 'Discord connect failed',
      description: callbackError.message,
      variant: 'destructive',
    });

    const params = new URLSearchParams(location.search);
    params.delete('error');
    params.delete('error_code');
    params.delete('error_description');
    params.delete('error_uri');
    const nextSearch = params.toString();

    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate, toast]);


  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const justLinked = params.get('discord') === 'linked';
    const isLinked = !!status?.discord_user_id;
    const shouldAutoSync = isLinked && !status?.discord_verified;
    const shouldSyncAfterLink = justLinked && isLinked;

    if (!user?.id || autoSyncTriggeredRef.current || isLoading) {
      return;
    }

    if (!shouldSyncAfterLink && !shouldAutoSync) {
      return;
    }

    autoSyncTriggeredRef.current = true;
    syncMutation.mutate();

    if (justLinked) {
      params.delete('discord');
      const nextSearch = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : '',
        },
        { replace: true },
      );
    }
  }, [
    isLoading,
    location.pathname,
    location.search,
    navigate,
    status?.discord_verified,
    status?.discord_user_id,
    syncMutation,
    user?.id,
  ]);

  const isLinked = !!status?.discord_user_id;
  const isInServer = !!status?.discord_in_server;
  const isVerified = !!status?.discord_verified;
  const lastChecked = status?.discord_last_checked_at
    ? new Date(status.discord_last_checked_at).toLocaleString()
    : null;

  return (
    <Card className={`space-y-5 p-6 ${className || ''}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-[#5865F2]">
            <FaDiscord className="h-4 w-4" />
            Discord Verification
          </div>
          <div>
            <h3 className="text-xl font-semibold">Connect to our Discord</h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Link your Discord identity, join our server, and then sync your profile so the
              verified server role is applied automatically.
            </p>
          </div>
        </div>

        <Badge variant={isVerified ? 'default' : 'outline'}>
          {isVerified ? 'Verified' : 'Unverified'}
        </Badge>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading Discord status...</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Link2 className="h-4 w-4 text-primary" />
              Website Link
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {isLinked
                ? `Connected${status?.discord_username ? ` as ${status.discord_username}` : ''}`
                : 'Not connected'}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldAlert className="h-4 w-4 text-primary" />
              Server Membership
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {isInServer ? 'Joined the server' : 'Not detected in the server yet'}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <BadgeCheck className="h-4 w-4 text-primary" />
              Server Role
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {isVerified ? 'Verified role is active' : 'Verified role is not active yet'}
            </div>
          </div>
        </div>
      )}

      {lastChecked ? (
        <div className="text-xs text-muted-foreground">Last checked: {lastChecked}</div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {!isLinked ? (
          <Button
            type="button"
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
            className="bg-[#5865F2] text-white hover:bg-[#4752C4]"
          >
            <FaDiscord className="mr-2 h-4 w-4" />
            {connectMutation.isPending ? 'Connecting...' : 'Connect to our Discord'}
          </Button>
        ) : null}

        <Button type="button" variant="outline" asChild>
          <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
            Join Discord Server
          </a>
        </Button>

        <Button
          type="button"
          variant={isVerified ? 'outline' : 'default'}
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending || !isLinked}
          className={!isVerified ? 'stoic-button-primary' : undefined}
        >
          <ShieldCheck className="mr-2 h-4 w-4" />
          {syncMutation.isPending
            ? 'Checking...'
            : isVerified
              ? 'Refresh Discord Status'
              : "I've joined, verify me"}
        </Button>
      </div>

      {!isVerified ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          Your profile stays marked unverified until your Discord account is linked and your server
          membership can be confirmed.
        </div>
      ) : null}
    </Card>
  );
};


