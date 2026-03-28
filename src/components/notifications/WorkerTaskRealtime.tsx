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

const matchesEligibility = (task: TaskRow, accounts: RedditAccount[] | null) => {
  return (accounts || []).some((account) => isAccountEligibleForTask(account, task));
};

const WorkerTaskRealtime = () => {
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const shownTaskIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || userRole !== 'worker') {
      shownTaskIdsRef.current.clear();
      return;
    }

    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

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
      const { data: accounts, error } = await supabase
        .from('reddit_accounts')
        .select('id, user_id, reddit_username, is_verified, karma, karma_range, cqs')
        .eq('user_id', user.id);

      if (!active) {
        return;
      }

      if (error) {
        console.error('Failed to load worker task realtime accounts', error);
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

export default WorkerTaskRealtime;
