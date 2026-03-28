import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ToastAction } from '@/components/ui/toast';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { isAccountEligibleForTask, RedditAccount } from '@/lib/redditAccounts';

type TaskRow = {
  id: string;
  title?: string | null;
  minimum_karma?: number | null;
  cqs_levels?: string[] | null;
};

const WEB_PUSH_PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY;

const matchesEligibility = (task: TaskRow, accounts: RedditAccount[] | null) => {
  return (accounts || []).some((account) => isAccountEligibleForTask(account, task));
};

const WorkerTaskNotifications = () => {
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const shownTaskIdsRef = useRef<Set<string>>(new Set());
  const permissionPromptedRef = useRef(false);
  const pushSyncInFlightRef = useRef(false);

  useEffect(() => {
    if (!user || userRole !== 'worker') {
      shownTaskIdsRef.current.clear();
      permissionPromptedRef.current = false;
      return;
    }

    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const syncPushSubscription = async () => {
      if (
        pushSyncInFlightRef.current ||
        !WEB_PUSH_PUBLIC_KEY ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        return;
      }

      pushSyncInFlightRef.current = true;

      try {
        const registration = await navigator.serviceWorker.register('/task-push-sw.js');
        const readyRegistration = await navigator.serviceWorker.ready;
        const existingSubscription = await readyRegistration.pushManager.getSubscription();
        const subscription =
          existingSubscription ||
          (await readyRegistration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(WEB_PUSH_PUBLIC_KEY),
          }));

        const keys = subscription.toJSON().keys;
        if (!keys?.p256dh || !keys?.auth) {
          throw new Error('Push subscription keys are missing.');
        }

        const { error } = await supabase.rpc('upsert_push_subscription', {
          p_endpoint: subscription.endpoint,
          p_p256dh: keys.p256dh,
          p_auth: keys.auth,
          p_user_agent: navigator.userAgent,
        });

        if (error) {
          throw error;
        }

        void registration;
      } catch (error) {
        console.error('Failed to sync push subscription', error);
      } finally {
        pushSyncInFlightRef.current = false;
      }
    };

    const maybePromptPermission = () => {
      if (!('Notification' in window)) {
        return;
      }

      if (Notification.permission === 'granted') {
        void syncPushSubscription();
        return;
      }

      if (
        Notification.permission !== 'default' ||
        permissionPromptedRef.current ||
        !WEB_PUSH_PUBLIC_KEY
      ) {
        return;
      }

      permissionPromptedRef.current = true;

      toast({
        title: 'Enable task alerts',
        description: 'Allow browser notifications to hear about newly posted tasks.',
        action: (
          <ToastAction
            altText="Enable notifications"
            onClick={async () => {
              try {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                  await syncPushSubscription();
                }
              } catch (error) {
                console.error('Failed to request notification permission', error);
              }
            }}
          >
            Enable
          </ToastAction>
        ),
      });
    };

    const showNewTaskAlert = (task: TaskRow) => {
      if (shownTaskIdsRef.current.has(task.id)) {
        return;
      }
      shownTaskIdsRef.current.add(task.id);

      const title = task.title?.trim() || 'New task available';

      toast({
        title: 'New task available',
        description: title,
        action: (
          <ToastAction altText="Open tasks" onClick={() => navigate('/worker/tasks')}>
            View tasks
          </ToastAction>
        ),
      });

    };

    const setup = async () => {
      maybePromptPermission();

      const { data: accounts, error } = await supabase
        .from('reddit_accounts')
        .select('id, user_id, reddit_username, is_verified, karma, karma_range, cqs')
        .eq('user_id', user.id);

      if (!active) {
        return;
      }

      if (error) {
        console.error('Failed to load worker notification accounts', error);
        return;
      }

      channel = supabase
        .channel(`worker-task-alerts:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'tasks',
          },
          (payload) => {
            const task = payload.new as TaskRow;
            if (matchesEligibility(task, (accounts || []) as RedditAccount[])) {
              showNewTaskAlert(task);
            }
          }
        )
        .subscribe();

      if (!active && channel) {
        supabase.removeChannel(channel);
      }
    };

    setup();

    return () => {
      active = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [navigate, toast, user, userRole]);

  return null;
};

export default WorkerTaskNotifications;

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(normalized);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}
