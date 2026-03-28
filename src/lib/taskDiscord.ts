import { supabase } from '@/integrations/supabase/client';

export async function sendNewTaskDiscord(taskIds: string[]) {
  const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)));
  if (uniqueTaskIds.length === 0) {
    return;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    console.warn('Discord notifications missing auth session.');
  }

  const { error } = await supabase.functions.invoke('send-task-discord', {
    body: { event: 'created', task_ids: uniqueTaskIds },
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (error) {
    console.error('Failed to trigger Discord task notifications', error);
  }
}

export async function sendTaskClaimedDiscord(assignmentId: string) {
  if (!assignmentId) return;

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    console.warn('Discord claim notification missing auth session.');
  }

  const { error } = await supabase.functions.invoke('send-task-discord', {
    body: { event: 'claimed', assignment_id: assignmentId },
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (error) {
    console.error('Failed to trigger Discord claim notification', error);
  }
}

export async function refreshTaskClaimedDiscord(assignmentId: string) {
  if (!assignmentId) return false;

  let { data: sessionData } = await supabase.auth.getSession();
  let accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    const refreshed = await supabase.auth.refreshSession();
    sessionData = refreshed.data;
    accessToken = sessionData.session?.access_token;
  }
  if (!accessToken) {
    console.warn('Discord refresh missing auth session.');
    return false;
  }

  const { error } = await supabase.functions.invoke('send-task-discord', {
    body: { event: 'status', assignment_id: assignmentId, force: true },
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (error) {
    if ((error as any)?.status === 401) {
      // Session is invalid or expired; clear local auth so user can log in again.
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // ignore
      }
    }
    console.error('Failed to refresh Discord claim notification', error);
    return false;
  }
  return true;
}

export async function sendTaskStatusDiscord(assignmentId: string) {
  if (!assignmentId) return;

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    console.warn('Discord status update missing auth session.');
    return;
  }

  const { error } = await supabase.functions.invoke('send-task-discord', {
    body: { event: 'status', assignment_id: assignmentId },
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (error) {
    console.error('Failed to trigger Discord status update', error);
  }
}
