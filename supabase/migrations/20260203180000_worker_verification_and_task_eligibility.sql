-- Migration: Add is_verified, karma, cqs, karma_range, cqs_proof to profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS karma integer,
ADD COLUMN IF NOT EXISTS karma_range text,
ADD COLUMN IF NOT EXISTS cqs text,
ADD COLUMN IF NOT EXISTS cqs_proof text;

-- Migration: Add minimum_karma and cqs_levels to tasks
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS minimum_karma integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS cqs_levels text[];
