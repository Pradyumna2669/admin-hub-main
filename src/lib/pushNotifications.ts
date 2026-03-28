import { supabase } from '@/integrations/supabase/client';

const WEB_PUSH_PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined;
let pushSubscriptionSyncPromise: Promise<boolean> | null = null;
const autoSyncAttemptedUsers = new Set<string>();

const normalizeErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

const isIgnorablePushSubscriptionError = (error: unknown) => {
  const status = Number((error as any)?.status);
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();

  return (
    code === '23505' ||
    status === 409 ||
    (status === 400 &&
      (message.includes('duplicate') ||
        message.includes('already exists') ||
        message.includes('push_subscriptions') ||
        message.includes('upsert_push_subscription')))
  );
};

export const getPushSubscriptionErrorMessage = (error: unknown) => {
  const name = String((error as any)?.name || '');
  const message = normalizeErrorMessage(error);
  const normalizedMessage = message.toLowerCase();

  if (
    name === 'AbortError' &&
    (normalizedMessage.includes('push service error') ||
      normalizedMessage.includes('registration failed'))
  ) {
    return 'The browser push service rejected registration. This usually comes from the browser, OS, private browsing mode, or an extension blocking push.';
  }

  if (name === 'NotAllowedError') {
    return 'The browser blocked push registration. Check notification permission, browser privacy settings, and whether the app is installed if you are on iOS Safari.';
  }

  if (!window.isSecureContext) {
    return 'Push notifications require a secure context (HTTPS or localhost).';
  }

  return message;
};

export const canUsePush = () =>
  !!WEB_PUSH_PUBLIC_KEY && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

export const getPushSupportDetails = () => ({
  hasKey: !!WEB_PUSH_PUBLIC_KEY,
  hasNotification: 'Notification' in window,
  hasServiceWorker: 'serviceWorker' in navigator,
  hasPushManager: 'PushManager' in window,
  isSecureContext: window.isSecureContext,
});

export const requestNotificationPermission = async (): Promise<NotificationPermission> => {
  if (!('Notification' in window)) return 'denied';
  return Notification.requestPermission();
};

export const ensurePushSubscription = async (
  userId: string,
  options?: { force?: boolean }
): Promise<boolean> => {
  if (!WEB_PUSH_PUBLIC_KEY || !userId) return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (!window.isSecureContext) return false;
  if (!options?.force && autoSyncAttemptedUsers.has(userId)) {
    return false;
  }
  if (pushSubscriptionSyncPromise) {
    return pushSubscriptionSyncPromise;
  }
  autoSyncAttemptedUsers.add(userId);

  pushSubscriptionSyncPromise = (async () => {
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
      if (isIgnorablePushSubscriptionError(error)) {
        return false;
      }
      throw error;
    }

    void registration;
    return true;
  })();

  try {
    return await pushSubscriptionSyncPromise;
  } finally {
    pushSubscriptionSyncPromise = null;
  }
};

export const fetchPushSubscriptionCount = async (userId: string) => {
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  return count || 0;
};

export const resetPushAutoSyncAttempt = (userId?: string) => {
  if (!userId) return;
  autoSyncAttemptedUsers.delete(userId);
};

export const sendTestPush = async (userId: string) => {
  const { data, error } = await supabase.functions.invoke('send-test-push', {
    body: { user_id: userId },
  });

  if (error) {
    throw error;
  }

  return data as { ok?: boolean; sent?: number };
};

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
