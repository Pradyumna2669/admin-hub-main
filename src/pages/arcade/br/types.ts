export type SurvivorProfile = {
  user_id: string;
  display_name: string;
  credits: number;
  wins: number;
  kills: number;
  matches_played: number;
};

export type SurvivorResult = {
  room_id: string;
  display_name: string;
  placement: number;
  kills: number;
  credits_awarded: number;
  created_at: string;
};

export type SurvivorLeaderboardRow = SurvivorProfile;

export type SurvivorObstacle = {
  x: number;
  y: number;
  r: number;
};

export type SurvivorTrail = {
  id: string;
  ownerId: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  createdAt: number;
};

export type SurvivorSnapshotPlayer = {
  userId: string;
  displayName: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  ammo: number;
  alive: boolean;
  angle: number;
  kills: number;
  placement: number;
  recentlyHit: boolean;
};

export type SurvivorSnapshot = {
  serverTime: number;
  roomId: string;
  status: "waiting" | "live" | "finished";
  countdownMs: number;
  world: {
    width: number;
    height: number;
    obstacles: SurvivorObstacle[];
    zone: {
      center: { x: number; y: number };
      radius: number;
      currentPhase: number;
      phaseStartedAt: number | null;
      phaseFromRadius: number;
      phaseToRadius: number;
      phaseDelayUntil: number | null;
    };
  };
  aliveCount: number;
  players: SurvivorSnapshotPlayer[];
  trails: SurvivorTrail[];
  standings: Array<{
    rank: number;
    userId: string;
    displayName: string;
    kills: number;
    alive: boolean;
    placement: number;
  }>;
};
