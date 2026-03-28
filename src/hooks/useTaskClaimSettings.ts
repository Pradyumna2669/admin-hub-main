import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES = 10;

export function useTaskClaimSettings() {
  return useQuery({
    queryKey: ['task-claim-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_claim_settings')
        .select('claim_cooldown_minutes')
        .eq('id', 'global')
        .maybeSingle();

      if (error) {
        return {
          claim_cooldown_minutes: DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES,
        };
      }

      const minutes = Number(data?.claim_cooldown_minutes);
      return {
        claim_cooldown_minutes:
          Number.isFinite(minutes) && minutes >= 0
            ? minutes
            : DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES,
      };
    },
    staleTime: 60_000,
  });
}
