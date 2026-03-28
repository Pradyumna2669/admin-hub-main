-- Arcade run sessions: server-issued run ids to reduce trust in client timing/payloads

CREATE TABLE IF NOT EXISTS public.arcade_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_name text NOT NULL CHECK (game_name IN ('flappy', 'snake', 'stack')),
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz NULL,
  submitted_score integer NULL CHECK (submitted_score IS NULL OR submitted_score >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.arcade_runs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS arcade_runs_user_game_started_idx
  ON public.arcade_runs (user_id, game_name, started_at DESC);

CREATE INDEX IF NOT EXISTS arcade_runs_started_open_idx
  ON public.arcade_runs (user_id, submitted_at, started_at DESC);
