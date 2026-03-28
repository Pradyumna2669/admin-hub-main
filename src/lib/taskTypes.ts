import { League } from './workerLeagues';

export const TASK_TYPE_LABELS = {
  normal_comment: 'Non Linked Comment',
  support_comment: 'Support Comment',
  linked_comments: 'Linked Comment',
  non_linked_crosspost: 'Non Linked Crosspost',
  linked_post_crosspost: 'Linked Crosspost',
  non_linked_post: 'Non Linked Post',
  linked_post: 'Linked Post',
} as const;

export type TaskType = keyof typeof TASK_TYPE_LABELS;

const buildRateMap = (
  support: number,
  normal: number,
  linked: number,
  crosspost: number,
  nonLinkedPost: number,
  linkedPost: number
): Record<TaskType, number> => ({
  normal_comment: normal,
  support_comment: support,
  linked_comments: linked,
  non_linked_crosspost: crosspost,
  linked_post_crosspost: crosspost,
  non_linked_post: nonLinkedPost,
  linked_post: linkedPost,
});

export const DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE: Record<League, Record<TaskType, number>> = {
  bronze: buildRateMap(10, 15, 20, 30, 40, 50),
  silver: buildRateMap(15, 20, 25, 30, 50, 70),
  gold: buildRateMap(15, 20, 25, 35, 60, 80),
  platinum: buildRateMap(18, 25, 30, 40, 100, 150),
  diamond: buildRateMap(20, 30, 35, 50, 150, 200),
};

export const DEFAULT_TASK_TYPE_REMOVAL_RATES_INR_BY_LEAGUE: Record<League, Record<TaskType, number>> = {
  bronze: buildRateMap(5, 5, 5, 10, 10, 10),
  silver: buildRateMap(5, 5, 5, 10, 10, 10),
  gold: buildRateMap(5, 10, 10, 15, 20, 20),
  platinum: buildRateMap(8, 15, 15, 15, 20, 25),
  diamond: buildRateMap(10, 15, 15, 20, 30, 40),
};

export const DEFAULT_TASK_TYPE_RATES_INR: Record<TaskType, number> =
  DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE.bronze;

// Used when a submission is rejected/removed but we still compensate the worker.
export const DEFAULT_TASK_TYPE_REMOVAL_RATES_INR: Record<TaskType, number> =
  DEFAULT_TASK_TYPE_REMOVAL_RATES_INR_BY_LEAGUE.bronze;

export const ALL_TASK_TYPES = Object.keys(TASK_TYPE_LABELS) as TaskType[];

export const TASK_TYPES_REQUIRE_SUBREDDIT_FLAIR: TaskType[] = [
  'non_linked_crosspost',
  'linked_post_crosspost',
  'non_linked_post',
  'linked_post',
];

export function requiresSubredditFlair(taskType: string | null | undefined): boolean {
  const normalized = normalizeTaskType(taskType);
  if (!normalized) return false;
  return TASK_TYPES_REQUIRE_SUBREDDIT_FLAIR.includes(normalized);
}

const LEGACY_TASK_TYPE_MAP: Record<string, TaskType> = {
  comment: 'normal_comment',
  linked_comment: 'linked_comments',
  normal_post: 'non_linked_post',
  linked_post: 'linked_post',
};

export function normalizeTaskType(taskType: string | null | undefined): TaskType | null {
  if (!taskType) return null;
  if (taskType in TASK_TYPE_LABELS) return taskType as TaskType;
  return LEGACY_TASK_TYPE_MAP[taskType] ?? null;
}

export function getTaskTypeLabel(taskType: string | null | undefined): string {
  const normalized = normalizeTaskType(taskType);
  if (!normalized) return taskType || 'Unknown';
  return TASK_TYPE_LABELS[normalized];
}

const LABEL_LOOKUP: Record<string, TaskType> = Object.fromEntries(
  (Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((t) => [
    TASK_TYPE_LABELS[t].toLowerCase(),
    t,
  ])
) as any;

export function parseTaskType(input: string | null | undefined): TaskType | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalized = normalizeTaskType(trimmed);
  if (normalized) return normalized;

  const lower = trimmed.toLowerCase();
  if (lower in LABEL_LOOKUP) return LABEL_LOOKUP[lower];

  const snake = lower.replace(/\s+/g, '_');
  if (snake in TASK_TYPE_LABELS) return snake as TaskType;

  return null;
}
