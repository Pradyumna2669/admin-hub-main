import { deriveKarmaFromRange, League, computeLeagueFromProfile } from '@/lib/workerLeagues';
import { meetsMinimumCqs } from '@/lib/taskEligibility';

export type RedditAccount = {
  id: string;
  user_id: string;
  reddit_username: string | null;
  reddit_profile?: string | null;
  is_verified?: boolean | null;
  karma?: number | null;
  karma_range?: string | null;
  cqs?: string | null;
  avatar_url?: string | null;
  created_at?: string | null;
};

const LEAGUE_PRIORITY: Record<League, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
  platinum: 3,
  diamond: 4,
};

export const deriveAccountKarma = (account: {
  karma?: number | null;
  karma_range?: string | null;
}) => {
  if (typeof account.karma === 'number' && Number.isFinite(account.karma)) {
    return account.karma;
  }
  const derived = deriveKarmaFromRange(account.karma_range || null);
  return typeof derived === 'number' && Number.isFinite(derived) ? derived : 0;
};

export const isAccountEligibleForTask = (
  account: RedditAccount,
  task: { minimum_karma?: number | null; cqs_levels?: string[] | null }
) => {
  if (!account.is_verified) return false;

  const minKarma =
    typeof task.minimum_karma === 'number' && Number.isFinite(task.minimum_karma)
      ? task.minimum_karma
      : null;

  if (minKarma !== null) {
    const karma = deriveAccountKarma(account);
    if (karma < minKarma) return false;
  }

  if (Array.isArray(task.cqs_levels) && task.cqs_levels.length > 0) {
    if (!meetsMinimumCqs(account.cqs, task.cqs_levels)) return false;
  }

  return true;
};

export const getAccountLeague = (account: RedditAccount): League =>
  computeLeagueFromProfile({
    karma: account.karma ?? null,
    karmaRange: account.karma_range ?? null,
    cqs: account.cqs ?? null,
  });

export const compareRedditAccounts = (a: RedditAccount, b: RedditAccount) => {
  const verificationDelta = Number(!!b.is_verified) - Number(!!a.is_verified);
  if (verificationDelta !== 0) return verificationDelta;

  const leagueDelta = LEAGUE_PRIORITY[getAccountLeague(b)] - LEAGUE_PRIORITY[getAccountLeague(a)];
  if (leagueDelta !== 0) return leagueDelta;

  const karmaDelta = deriveAccountKarma(b) - deriveAccountKarma(a);
  if (karmaDelta !== 0) return karmaDelta;

  const nameA = (a.reddit_username || '').toLowerCase();
  const nameB = (b.reddit_username || '').toLowerCase();
  const nameDelta = nameA.localeCompare(nameB);
  if (nameDelta !== 0) return nameDelta;

  const createdAtA = a.created_at ? new Date(a.created_at).getTime() : 0;
  const createdAtB = b.created_at ? new Date(b.created_at).getTime() : 0;
  return createdAtA - createdAtB;
};

export const getSortedRedditAccounts = <T extends RedditAccount>(accounts: T[]) =>
  [...accounts].sort(compareRedditAccounts);

export const getBestEligibleRedditAccount = <T extends RedditAccount>(
  accounts: T[],
  task: { minimum_karma?: number | null; cqs_levels?: string[] | null }
) => getSortedRedditAccounts(accounts.filter((account) => isAccountEligibleForTask(account, task)))[0] ?? null;
