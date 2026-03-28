import * as THREE from "three";

export type MatchmakingState = {
  statusLabel: string;
  subtitle: string;
  spectating: boolean;
};

type SnapshotRound = {
  phase: "waiting" | "starting" | "active" | "ended";
  playerCount: number;
  aliveCount: number;
  phaseEndsAt: number;
};

type SnapshotEntity = {
  id: string;
  alive: boolean;
};

export const SERVER_WORLD_SIZE = 2200;
export const WORLD_CENTER = SERVER_WORLD_SIZE / 2;
export const WORLD_SCALE = 0.1;

export const getMatchmakingState = (round: SnapshotRound | null, selfId: string, entities: SnapshotEntity[]) => {
  if (!round) {
    return {
      statusLabel: "Connecting",
      subtitle: "Waiting for server snapshot",
      spectating: true,
    } satisfies MatchmakingState;
  }

  const self = entities.find((entity) => entity.id === selfId);
  const spectating = round.phase === "active" && !self?.alive;

  if (round.phase === "waiting") {
    return {
      statusLabel: "Waiting Lobby",
      subtitle: `${round.playerCount}/2 players ready`,
      spectating: false,
    } satisfies MatchmakingState;
  }

  if (round.phase === "starting") {
    return {
      statusLabel: "Match Starting",
      subtitle: `${Math.max(0, Math.ceil((round.phaseEndsAt - Date.now()) / 1000))}s countdown`,
      spectating: false,
    } satisfies MatchmakingState;
  }

  if (spectating) {
    return {
      statusLabel: "Spectating",
      subtitle: `Join next round. ${round.aliveCount} alive now`,
      spectating: true,
    } satisfies MatchmakingState;
  }

  if (round.phase === "ended") {
    return {
      statusLabel: "Round Over",
      subtitle: "Rewards updating",
      spectating: true,
    } satisfies MatchmakingState;
  }

  return {
    statusLabel: "Fight",
    subtitle: `${round.aliveCount} players alive`,
    spectating: false,
  } satisfies MatchmakingState;
};

export const worldToScene = (x: number, y: number, height = 0) =>
  new THREE.Vector3((x - WORLD_CENTER) * WORLD_SCALE, height, (y - WORLD_CENTER) * WORLD_SCALE);

export const worldDistanceToScene = (distance: number) => distance * WORLD_SCALE;
