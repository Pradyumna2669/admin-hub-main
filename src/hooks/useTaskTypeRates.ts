import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ALL_TASK_TYPES, DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE, TaskType, normalizeTaskType } from '@/lib/taskTypes';
import { League, normalizeLeague } from '@/lib/workerLeagues';

type TaskTypeRateMap = Record<TaskType, number>;

export function useTaskTypeRates(league?: League | string | null) {
  const normalizedLeague = normalizeLeague(league) ?? 'bronze';
  const defaultMap: TaskTypeRateMap = {
    ...DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE[normalizedLeague],
  };

  return useQuery({
    queryKey: ['task-type-rates', normalizedLeague],
    queryFn: async (): Promise<TaskTypeRateMap> => {
      const { data, error } = await supabase
        .from('task_type_rates')
        .select('task_type, amount')
        .eq('league', normalizedLeague);

      if (error) {
        // If table/migrations aren't applied yet, keep UI functional.
        return defaultMap;
      }

      const map: TaskTypeRateMap = { ...defaultMap };
      for (const row of data || []) {
        const normalized = normalizeTaskType((row as any).task_type);
        if (!normalized) continue;
        const amount = Number((row as any).amount);
        if (!Number.isFinite(amount)) continue;
        map[normalized] = amount;
      }

      // Ensure all keys exist.
      for (const t of ALL_TASK_TYPES) {
        if (!Number.isFinite(map[t])) map[t] = defaultMap[t];
      }

      return map;
    },
    staleTime: 60_000,
  });
}
