const CQS_RANKS = {
  low: 0,
  moderate: 1,
  high: 2,
  highest: 3,
} as const;

const CQS_LABELS = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  highest: 'Highest',
} as const;

type CqsRankKey = keyof typeof CQS_RANKS;

export function normalizeCqsLevel(value?: string | null): CqsRankKey | null {
  const normalized = value?.trim().toLowerCase() || '';
  if (!normalized) {
    return null;
  }

  if (normalized in CQS_RANKS) {
    return normalized as CqsRankKey;
  }

  return null;
}

export function meetsMinimumCqs(
  workerCqs?: string | null,
  taskCqsLevels?: string[] | null
) {
  const validTaskLevels = (taskCqsLevels || [])
    .map((value) => normalizeCqsLevel(value))
    .filter((value): value is CqsRankKey => value !== null);

  if (validTaskLevels.length === 0) {
    return true;
  }

  const workerLevel = normalizeCqsLevel(workerCqs);
  if (!workerLevel) {
    return false;
  }

  const minimumRequiredRank = Math.min(...validTaskLevels.map((value) => CQS_RANKS[value]));
  return CQS_RANKS[workerLevel] >= minimumRequiredRank;
}

export function formatMinimumCqsRequirement(taskCqsLevels?: string[] | null) {
  const validTaskLevels = (taskCqsLevels || [])
    .map((value) => normalizeCqsLevel(value))
    .filter((value): value is CqsRankKey => value !== null);

  if (validTaskLevels.length === 0) {
    return null;
  }

  const minimumRequiredLevel = validTaskLevels.reduce((lowest, current) =>
    CQS_RANKS[current] < CQS_RANKS[lowest] ? current : lowest
  );

  return `${CQS_LABELS[minimumRequiredLevel]}+`;
}
