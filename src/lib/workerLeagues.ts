export const LEAGUE_LABELS = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
} as const;

export type League = keyof typeof LEAGUE_LABELS;

export const ALL_LEAGUES: League[] = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
];

const HIGH_CQS_LEVELS = new Set(['high', 'highest']);

export function normalizeLeague(input?: string | null): League | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed in LEAGUE_LABELS) return trimmed as League;
  return null;
}

export function isHighCqs(cqs?: string | null): boolean {
  if (!cqs) return false;
  return HIGH_CQS_LEVELS.has(cqs.trim().toLowerCase());
}

export function baseLeagueForKarma(karma?: number | null): League {
  const value = typeof karma === 'number' && Number.isFinite(karma) ? karma : 0;
  if (value >= 50_000) return 'diamond';
  if (value >= 25_000) return 'platinum';
  if (value >= 5_000) return 'gold';
  if (value >= 1_000) return 'silver';
  return 'bronze';
}

export function promoteLeague(league: League): League {
  switch (league) {
    case 'bronze':
      return 'silver';
    case 'silver':
      return 'gold';
    case 'gold':
      return 'platinum';
    case 'platinum':
      return 'diamond';
    default:
      return 'diamond';
  }
}

export function computeLeagueFromKarmaAndCqs(
  karma?: number | null,
  cqs?: string | null
): League {
  const base = baseLeagueForKarma(karma);
  return isHighCqs(cqs) ? promoteLeague(base) : base;
}

export function deriveKarmaFromRange(range?: string | null): number | null {
  if (!range) return null;
  const normalized = range.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.includes('200') && normalized.includes('1k')) return 200;
  if (normalized.startsWith('1k')) return 1_000;
  if (normalized.startsWith('5k')) return 5_000;
  if (normalized.startsWith('25k')) return 25_000;
  if (normalized.startsWith('50k')) return 50_000;
  if (normalized.startsWith('100k')) return 100_000;
  if (normalized.startsWith('100k')) return 100_000;
  if (normalized.startsWith('<1k')) return 0;

  return null;
}

export function computeLeagueFromProfile(params: {
  karma?: number | null;
  karmaRange?: string | null;
  cqs?: string | null;
}): League {
  const { karma, karmaRange, cqs } = params;
  if (typeof karma === 'number' && Number.isFinite(karma)) {
    return computeLeagueFromKarmaAndCqs(karma, cqs);
  }
  const derived = deriveKarmaFromRange(karmaRange);
  return computeLeagueFromKarmaAndCqs(derived, cqs);
}
