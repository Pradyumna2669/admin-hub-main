import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  ALL_TASK_TYPES,
  DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE,
  DEFAULT_TASK_TYPE_REMOVAL_RATES_INR_BY_LEAGUE,
  TaskType,
  normalizeTaskType,
} from '@/lib/taskTypes';
import { League, normalizeLeague } from '@/lib/workerLeagues';

type TaskTypeRateSettings = Record<
  TaskType,
  { amount: number; removal_amount: number }
>;

const buildDefaultMap = (league: League): TaskTypeRateSettings =>
  Object.fromEntries(
    ALL_TASK_TYPES.map((t) => [
      t,
      {
        amount: DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE[league][t],
        removal_amount: DEFAULT_TASK_TYPE_REMOVAL_RATES_INR_BY_LEAGUE[league][t],
      },
    ])
  ) as TaskTypeRateSettings;

async function fetchWithOptionalRemovalAmount(league: League) {
  const primary = await supabase
    .from('task_type_rates')
    .select('task_type, amount, removal_amount')
    .eq('league', league);

  if (!primary.error) return primary;

  // Backward compatibility: older DBs may not have `removal_amount` yet.
  const msg = (primary.error as any)?.message?.toLowerCase?.() || '';
  const details = (primary.error as any)?.details?.toLowerCase?.() || '';
  const mentionsRemoval = msg.includes('removal_amount') || details.includes('removal_amount');
  const mentionsMissing = msg.includes('column') || msg.includes('does not exist');
  if (mentionsRemoval && mentionsMissing) {
    return supabase
      .from('task_type_rates')
      .select('task_type, amount')
      .eq('league', league);
  }

  return primary;
}

export function useTaskTypeRateSettings(league?: League | string | null) {
  const normalizedLeague = normalizeLeague(league) ?? 'bronze';
  const defaultMap = buildDefaultMap(normalizedLeague);

  return useQuery({
    queryKey: ['task-type-rate-settings', normalizedLeague],
    queryFn: async (): Promise<TaskTypeRateSettings> => {
      const { data, error } = await fetchWithOptionalRemovalAmount(normalizedLeague);
      if (error) return defaultMap;

      const map: TaskTypeRateSettings = { ...defaultMap };
      for (const row of data || []) {
        const normalized = normalizeTaskType((row as any).task_type);
        if (!normalized) continue;

        const amount = Number((row as any).amount);
        if (Number.isFinite(amount)) map[normalized].amount = amount;

        const removal = Number((row as any).removal_amount);
        if (Number.isFinite(removal)) map[normalized].removal_amount = removal;
      }

      // Ensure all keys exist.
      for (const t of ALL_TASK_TYPES) {
        if (!Number.isFinite(map[t]?.amount)) map[t].amount = defaultMap[t].amount;
        if (!Number.isFinite(map[t]?.removal_amount)) map[t].removal_amount = defaultMap[t].removal_amount;
      }

      return map;
    },
    staleTime: 60_000,
  });
}
