import { supabase } from '@/integrations/supabase/client';

export async function sendNewTaskPushes(taskIds: string[]) {
  const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)));
  if (uniqueTaskIds.length === 0) {
    return;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  const { error } = await supabase.functions.invoke('send-task-push', {
    body: { task_ids: uniqueTaskIds },
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (error) {
    console.error('Failed to trigger task push notifications', error);
  }
}
