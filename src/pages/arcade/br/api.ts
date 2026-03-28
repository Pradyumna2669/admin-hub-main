import type { SurvivorLeaderboardRow, SurvivorProfile, SurvivorResult } from "@/pages/arcade/br/types";

const getServerBaseUrl = () => {
  const fromEnv = (import.meta.env.VITE_ARCADE_SURVIVOR_SERVER_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3101";
};

export const getArcadeSurvivorServerBaseUrl = getServerBaseUrl;

const fetchJson = async <T,>(path: string): Promise<T> => {
  const res = await fetch(`${getServerBaseUrl()}${path}`);
  if (!res.ok) {
    throw new Error(`Arcade service request failed (${res.status})`);
  }
  return (await res.json()) as T;
};

export const fetchSurvivorProfile = async (
  userId: string,
): Promise<{ profile: SurvivorProfile; recentResults: SurvivorResult[] }> =>
  fetchJson(`/api/arcade-survivor/profile/${encodeURIComponent(userId)}`);

export const fetchSurvivorLeaderboard = async (limit = 10): Promise<SurvivorLeaderboardRow[]> => {
  const data = await fetchJson<{ leaderboard: SurvivorLeaderboardRow[] }>(`/api/arcade-survivor/leaderboard?limit=${limit}`);
  return data.leaderboard;
};
