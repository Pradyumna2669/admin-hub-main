import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  canUsePush,
  ensurePushSubscription,
  getPushSubscriptionErrorMessage,
  requestNotificationPermission,
  resetPushAutoSyncAttempt,
} from '@/lib/pushNotifications';

const PushSubscriptionManager = () => {
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  const permissionPromptedRef = useRef(false);
  const pushSyncInFlightRef = useRef(false);

  useEffect(() => {
    if (!user) {
      permissionPromptedRef.current = false;
      pushSyncInFlightRef.current = false;
      return;
    }

    const maybePromptPermission = () => {
      if (!('Notification' in window)) {
        return;
      }

      if (Notification.permission === 'granted') {
        void ensurePushSubscription(user.id).catch((error) => {
          console.warn('Push subscription auto-sync skipped:', getPushSubscriptionErrorMessage(error));
        });
        return;
      }

      if (
        Notification.permission !== 'default' ||
        permissionPromptedRef.current ||
        !canUsePush()
      ) {
        return;
      }

      permissionPromptedRef.current = true;

      toast({
        title: 'Enable notifications',
        description: 'Allow browser notifications for live chat and task alerts.',
        action: (
          <button
            className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
            onClick={async () => {
              if (pushSyncInFlightRef.current) return;
              pushSyncInFlightRef.current = true;
              try {
                const permission = await requestNotificationPermission();
                if (permission === 'granted') {
                  resetPushAutoSyncAttempt(user.id);
                  await ensurePushSubscription(user.id, { force: true });
                }
              } catch (error) {
                console.error('Failed to request notification permission', error);
              } finally {
                pushSyncInFlightRef.current = false;
              }
            }}
          >
            Enable
          </button>
        ),
      });
    };

    maybePromptPermission();
  }, [toast, user, userRole]);

  return null;
};

export default PushSubscriptionManager;
