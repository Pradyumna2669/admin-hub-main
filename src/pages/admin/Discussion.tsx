import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Video, Copy, RefreshCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

const JITSI_DOMAIN = (import.meta.env.VITE_JITSI_DOMAIN as string | undefined) || '8x8.vc';
const JAAS_APP_ID = (import.meta.env.VITE_JAAS_APP_ID as string | undefined) || '';

const sanitizeRoomName = (raw: string) => {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.length ? cleaned.slice(0, 120) : 'discussion';
};

const defaultRoomSlug = () => {
  return sanitizeRoomName('stoicops-discussion');
};

const displayNameFromUser = (user: { email?: string | null; user_metadata?: unknown } | null) => {
  const metadata = user?.user_metadata;
  const metaName =
    metadata && typeof metadata === 'object' && 'full_name' in metadata
      ? String((metadata as Record<string, unknown>).full_name ?? '')
      : '';
  const email = user?.email || '';
  return (metaName || email || 'Admin').toString();
};

const Discussion: React.FC = () => {
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<JitsiExternalApi | null>(null);

  const [roomSlug, setRoomSlug] = useState(() => defaultRoomSlug());
  const [reloadNonce, setReloadNonce] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'ended'>('connecting');
  const [fixedDisplayName, setFixedDisplayName] = useState<string>(() => displayNameFromUser(user));

  const fullRoomName = useMemo(() => {
    const slug = sanitizeRoomName(roomSlug);
    return JAAS_APP_ID ? `${JAAS_APP_ID}/${slug}` : slug;
  }, [roomSlug]);

  const jitsiScriptSrc = useMemo(() => {
    if (JITSI_DOMAIN === '8x8.vc') {
      return JAAS_APP_ID ? `https://8x8.vc/${JAAS_APP_ID}/external_api.js` : `https://8x8.vc/external_api.js`;
    }
    return `https://${JITSI_DOMAIN}/external_api.js`;
  }, []);
  const displayName = useMemo(() => fixedDisplayName || displayNameFromUser(user), [fixedDisplayName, user]);

  const meetingUrl = useMemo(() => {
    const base = JITSI_DOMAIN === '8x8.vc' ? 'https://8x8.vc' : `https://${JITSI_DOMAIN}`;
    return `${base}/${fullRoomName}`;
  }, [fullRoomName]);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;
    const run = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('reddit_username, full_name')
          .eq('user_id', user.id)
          .maybeSingle();

        const profile = (data ?? null) as { reddit_username?: string | null; full_name?: string | null } | null;
        const fromProfile = (profile?.reddit_username || profile?.full_name || '').trim();
        const name = fromProfile || displayNameFromUser(user);
        if (!cancelled) setFixedDisplayName(name);
      } catch {
        if (!cancelled) setFixedDisplayName(displayNameFromUser(user));
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const dispose = () => {
    try {
      apiRef.current?.dispose?.();
    } catch {
      // ignore
    } finally {
      apiRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const ensureScript = async () => {
      if (window.JitsiMeetExternalAPI) return;

      const existing = document.querySelector<HTMLScriptElement>('script[data-jitsi-external-api="true"]');
      if (existing) {
        const existingSrc = existing.getAttribute('src') || '';
        if (existingSrc && existingSrc !== jitsiScriptSrc) {
          existing.remove();
        } else {
        await new Promise<void>((resolve, reject) => {
          if (existing.dataset.loaded === 'true') return resolve();
          existing.addEventListener('load', () => resolve(), { once: true });
          existing.addEventListener('error', () => reject(new Error('Failed to load Jitsi script')), { once: true });
        });
        return;
        }
      }

      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = jitsiScriptSrc;
        script.async = true;
        script.dataset.jitsiExternalApi = 'true';
        script.addEventListener('load', () => {
          script.dataset.loaded = 'true';
          resolve();
        });
        script.addEventListener('error', () => reject(new Error('Failed to load Jitsi script')));
        document.body.appendChild(script);
      });
    };

    const mount = async () => {
      if (JITSI_DOMAIN === '8x8.vc' && !JAAS_APP_ID) {
        setStatus('ended');
        return;
      }

      setStatus('connecting');
      dispose();

      const parentNode = containerRef.current;
      if (!parentNode) return;

      await ensureScript();
      if (cancelled) return;

      if (!window.JitsiMeetExternalAPI) {
        throw new Error('JitsiMeetExternalAPI not available');
      }

      const api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
        roomName: fullRoomName,
        parentNode,
        width: '100%',
        height: '100%',
        userInfo: { displayName },
        configOverwrite: {
          disableDeepLinking: true,
          prejoinPageEnabled: false,
          startWithAudioMuted: true,
          startWithVideoMuted: true,
          disableInviteFunctions: true,
          disableProfile: true,
          readOnlyName: true,
        },
        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          SHOW_BRAND_WATERMARK: false,
          SHOW_POWERED_BY: false,
          HIDE_DEEP_LINKING_LOGO: true,
          DEFAULT_BACKGROUND: '#0b1220',
          SETTINGS_SECTIONS: ['devices', 'language', 'moderator'],
          TOOLBAR_BUTTONS: [
            'microphone',
            'camera',
            'desktop',
            'tileview',
            'chat',
            'raisehand',
            'fullscreen',
            'hangup',
          ],
        },
      });

      apiRef.current = api;

      api.addListener?.('videoConferenceJoined', () => setStatus('connected'));
      api.addListener?.('readyToClose', () => setStatus('ended'));
      api.addListener?.('videoConferenceLeft', () => setStatus('ended'));
    };

    mount().catch(() => setStatus('ended'));

    return () => {
      cancelled = true;
      dispose();
    };
  }, [fullRoomName, displayName, jitsiScriptSrc, reloadNonce]);

  return (
    <DashboardLayout mainClassName="h-full p-0 overflow-hidden">
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="shrink-0 border-b border-border/80 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex min-h-[4.5rem] items-center gap-3 px-3 py-3 sm:px-4">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Video size={18} />
              </div>
              <div className="min-w-0">
                <div className="font-semibold leading-tight">Discussion</div>
                <div className="text-xs text-muted-foreground truncate">
                  Room: STOICOPS
                </div>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <div
                className={cn(
                  "text-xs px-2 py-1 rounded-full border",
                  status === 'connected' && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
                  status === 'connecting' && "border-amber-500/30 bg-amber-500/10 text-amber-600",
                  status === 'ended' && "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
                )}
              >
                {status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Ended'}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(meetingUrl);
                  } catch {
                    // ignore
                  }
                }}
                className="hidden sm:inline-flex"
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy Invite
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRoomSlug(defaultRoomSlug());
                  setReloadNonce((n) => n + 1);
                }}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Reconnect
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 p-3 sm:p-4 lg:p-5">
          {!JAAS_APP_ID && JITSI_DOMAIN === '8x8.vc' && (
            <div className="h-full w-full flex items-center justify-center p-6">
              <div className="max-w-md w-full rounded-xl border border-border bg-background p-5">
                <div className="font-semibold">Jitsi as a Service is not configured</div>
                <div className="text-sm text-muted-foreground mt-1">
                  Set <span className="font-mono">VITE_JAAS_APP_ID</span> in <span className="font-mono">.env</span> to your vpaas
                  magic cookie (tenant id), then reload.
                </div>
              </div>
            </div>
          )}
          {(JAAS_APP_ID || JITSI_DOMAIN !== '8x8.vc') && (
            <div className="h-full w-full overflow-hidden rounded-[28px] border border-border/70 bg-card/40 shadow-[var(--shadow-lg)] backdrop-blur">
              <div ref={containerRef} className="h-full min-h-[68vh] w-full" />
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Discussion;
