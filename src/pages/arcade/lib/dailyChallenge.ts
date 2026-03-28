import type { ArcadeGameName } from "@/pages/arcade/types";

type DailyChallenge = {
  game: ArcadeGameName;
  targetScore: number;
  title: string;
  hint: string;
};

const dayKeyUTC = (d: Date) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const getDailyChallenge = (now = new Date()): DailyChallenge => {
  const key = dayKeyUTC(now);
  const h = hashStr(`arcade:${key}`);
  const pick = h % 3;

  if (pick === 0) {
    return {
      game: "flappy",
      targetScore: 15 + (h % 6),
      title: "Flappy Sprint",
      hint: "Focus on consistent taps; don't chase altitude.",
    };
  }
  if (pick === 1) {
    return {
      game: "snake",
      targetScore: 18 + (h % 8),
      title: "Snake Growth",
      hint: "Plan two moves ahead; avoid hugging walls.",
    };
  }
  return {
    game: "stack",
    targetScore: 10 + (h % 8),
    title: "Stack Precision",
    hint: "Aim for small overlaps to keep blocks wide.",
  };
};

