import { supabase } from '@/integrations/supabase/client';

type ChatPushScope = 'group' | 'direct';

export async function sendChatPush(messageId: string, scope: ChatPushScope) {
  if (!messageId) return;

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  const { error } = await supabase.functions.invoke('send-chat-push', {
    body: { message_id: messageId, scope },
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (error) {
    console.error('Failed to trigger chat push notifications', error);
  }
}
