export type ArcadeGameName = "flappy" | "snake" | "stack" | "blaster";

export type ArcadeGameStatus = "idle" | "running" | "paused" | "over";

export type ArcadeGameOverReason =
  | "collision"
  | "out_of_bounds"
  | "timeout"
  | "miss"
  | "self_hit"
  | "wall_hit"
  | "no_overlap"
  | "unknown";

export type ArcadeLeaderboardRow = {
  id: number;
  user_id: string;
  game_name: string;
  score: number;
  created_at: string;
  display_name?: string;
};

export type ArcadeSubmitScoreResult =
  | {
      accepted: true;
      credits_awarded: number;
      credits_total: number;
      best_today_score: number;
      message?: string;
    }
  | {
      accepted: false;
      reason: string;
      message?: string;
    };

export type ArcadeStartRunResult =
  | {
      accepted: true;
      run_id: string;
      started_at: string;
    }
  | {
      accepted: false;
      reason: string;
      message?: string;
    };
