import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

type ForecastCounts = {
  posts: number;
  replies: number;
  comments: number;
};

type TaskHistoryRow = {
  created_at: string;
  task_type: string | null;
};

export type ForecastPoint = ForecastCounts & {
  iso: string;
  label: string;
  tooltipLabel: string;
  total: number;
};

type ForecastBucket = {
  date: Date;
  counts: ForecastCounts;
};

export type TaskForecastData = {
  daily: ForecastPoint[];
  hourly: ForecastPoint[];
  tasksAnalyzed: number;
  historyWindowDays: number;
};

const HISTORY_WINDOW_DAYS = 45;
const DAILY_HISTORY_DAYS = 14;
const HOURLY_HISTORY_HOURS = 48;

const dailyLabelFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

const dailyTooltipFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const hourlyLabelFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
});

const hourlyTooltipFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  year: 'numeric',
});

const emptyCounts = (): ForecastCounts => ({
  posts: 0,
  replies: 0,
  comments: 0,
});

const pad = (value: number) => String(value).padStart(2, '0');

const toLocalDayKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const toLocalHourKey = (date: Date) => `${toLocalDayKey(date)}T${pad(date.getHours())}`;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const startOfHour = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours());

const addDays = (date: Date, amount: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);

const addHours = (date: Date, amount: number) =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours() + amount,
  );

const classifyTaskType = (taskType: string | null) => {
  if (!taskType) return 'comments' as const;
  if (taskType.includes('post')) return 'posts' as const;
  if (taskType === 'support_comment') return 'replies' as const;
  return 'comments' as const;
};

const roundCounts = (counts: ForecastCounts): ForecastCounts => ({
  posts: Math.max(0, Math.round(counts.posts)),
  replies: Math.max(0, Math.round(counts.replies)),
  comments: Math.max(0, Math.round(counts.comments)),
});

const toPoint = (
  date: Date,
  counts: ForecastCounts,
  mode: 'daily' | 'hourly',
): ForecastPoint => {
  const rounded = roundCounts(counts);
  return {
    iso: date.toISOString(),
    label:
      mode === 'daily'
        ? dailyLabelFormatter.format(date)
        : hourlyLabelFormatter.format(date),
    tooltipLabel:
      mode === 'daily'
        ? dailyTooltipFormatter.format(date)
        : hourlyTooltipFormatter.format(date),
    total: rounded.posts + rounded.replies + rounded.comments,
    ...rounded,
  };
};

const getBucketCounts = (
  bucket: ForecastBucket | undefined,
): ForecastCounts => bucket?.counts || emptyCounts();

const buildForecast = (rows: TaskHistoryRow[]): TaskForecastData => {
  const dailyMap = new Map<string, ForecastBucket>();
  const hourlyMap = new Map<string, ForecastBucket>();

  for (const row of rows) {
    if (!row.created_at) continue;

    const createdAt = new Date(row.created_at);
    if (Number.isNaN(createdAt.getTime())) continue;

    const group = classifyTaskType(row.task_type);

    const dayDate = startOfDay(createdAt);
    const dayKey = toLocalDayKey(dayDate);
    const dayBucket = dailyMap.get(dayKey) || {
      date: dayDate,
      counts: emptyCounts(),
    };
    dayBucket.counts[group] += 1;
    dailyMap.set(dayKey, dayBucket);

    const hourDate = startOfHour(createdAt);
    const hourKey = toLocalHourKey(hourDate);
    const hourBucket = hourlyMap.get(hourKey) || {
      date: hourDate,
      counts: emptyCounts(),
    };
    hourBucket.counts[group] += 1;
    hourlyMap.set(hourKey, hourBucket);
  }

  const historicalDaily = [...dailyMap.values()].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const historicalHourly = [...hourlyMap.values()].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  if (historicalDaily.length === 0) {
    return {
      daily: [],
      hourly: [],
      tasksAnalyzed: 0,
      historyWindowDays: HISTORY_WINDOW_DAYS,
    };
  }

  const now = new Date();
  const currentDay = startOfDay(now);
  const currentHour = startOfHour(now);

  const daily = Array.from({ length: DAILY_HISTORY_DAYS }, (_, index) => {
    const offset = index - (DAILY_HISTORY_DAYS - 1);
    const target = addDays(currentDay, offset);
    return toPoint(
      target,
      getBucketCounts(dailyMap.get(toLocalDayKey(target))),
      'daily',
    );
  });

  const hourly = Array.from({ length: HOURLY_HISTORY_HOURS }, (_, index) => {
    const offset = index - (HOURLY_HISTORY_HOURS - 1);
    const target = addHours(currentHour, offset);
    return toPoint(
      target,
      getBucketCounts(hourlyMap.get(toLocalHourKey(target))),
      'hourly',
    );
  });

  return {
    daily,
    hourly,
    tasksAnalyzed: rows.length,
    historyWindowDays: HISTORY_WINDOW_DAYS,
  };
};

export const useTaskForecast = () =>
  useQuery({
    queryKey: ['task-forecast', HISTORY_WINDOW_DAYS],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        'get_task_forecast_history',
        {
          p_history_window_days: HISTORY_WINDOW_DAYS,
        }
      );

      if (error) {
        throw error;
      }

      return buildForecast((data || []) as TaskHistoryRow[]);
    },
  });
