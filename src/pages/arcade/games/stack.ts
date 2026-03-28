import { clamp, isCoarsePointer } from "@/pages/arcade/lib/canvas";
import type { ArcadeGameOverReason, ArcadeGameStatus } from "@/pages/arcade/types";

type Options = {
  onScore?: (score: number) => void;
  onStatus?: (status: ArcadeGameStatus) => void;
  onGameOver?: (payload: { score: number; reason: ArcadeGameOverReason }) => void;
  onSfx?: (name: "drop" | "perfect" | "hit") => void;
};

export type StackController = {
  start: () => void;
  pause: () => void;
  reset: () => void;
  destroy: () => void;
  getScore: () => number;
  getStartedAt: () => number | null;
  getStatus: () => ArcadeGameStatus;
};

type Block = { x: number; y: number; w: number; h: number; vx: number };

export const createStack = (canvas: HTMLCanvasElement, opts: Options = {}): StackController => {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  const touchMode = isCoarsePointer();
  let status: ArcadeGameStatus = "idle";
  let startedAt: number | null = null;
  let score = 0;
  let combo = 0;

  const height = () => canvas.clientHeight || 420;
  const width = () => canvas.clientWidth || 360;

  const blockH = 26;
  const minDropDelayMs = touchMode ? 420 : 350;
  const stack: Block[] = [];
  let moving: Block | null = null;
  let movingSpawnedAt = 0;

  let raf = 0;
  let lastT = 0;

  const setStatus = (s: ArcadeGameStatus) => {
    status = s;
    opts.onStatus?.(s);
  };

  const lanePadding = () => (touchMode ? 10 : 12);

  const initialFloorWidth = () => {
    if (!touchMode) return Math.min(260, width() - 40);
    const maxFloor = Math.min(240, width() - 56);
    const scaled = Math.floor(width() * 0.72);
    return clamp(scaled, 180, maxFloor);
  };

  const resetWorld = () => {
    stack.length = 0;
    score = 0;
    combo = 0;
    startedAt = null;
    opts.onScore?.(0);

    const floorW = initialFloorWidth();
    stack.push({ x: (width() - floorW) / 2, y: height() - blockH - 24, w: floorW, h: blockH, vx: 0 });
    moving = { x: 20, y: height() - blockH - 24 - blockH, w: floorW, h: blockH, vx: touchMode ? 190 : 170 };
    movingSpawnedAt = performance.now();
    setStatus("idle");
    draw();
  };

  const gameOver = (reason: ArcadeGameOverReason) => {
    if (status === "over") return;
    setStatus("over");
    opts.onSfx?.("hit");
    opts.onGameOver?.({ score, reason });
  };

  const drop = () => {
    if (status === "over") return;
    if (status === "idle") start();
    if (status !== "running") return;
    if (!moving) return;
    if (score > 0 && performance.now() - movingSpawnedAt < minDropDelayMs) return;

    const prev = stack[stack.length - 1];
    const a1 = moving.x;
    const a2 = moving.x + moving.w;
    const b1 = prev.x;
    const b2 = prev.x + prev.w;
    const overlap = Math.min(a2, b2) - Math.max(a1, b1);
    if (overlap <= 6) return gameOver("no_overlap");

    const perfect = Math.abs((a1 + a2) / 2 - (b1 + b2) / 2) <= 4;
    combo = perfect ? combo + 1 : 0;
    opts.onSfx?.(perfect ? "perfect" : "drop");

    const newX = Math.max(a1, b1);
    const placed: Block = { x: newX, y: moving.y, w: overlap, h: moving.h, vx: 0 };
    stack.push(placed);

    score += 1;
    opts.onScore?.(score);

    const nextW = overlap;
    const nextY = placed.y - blockH;
    if (nextY < 40) {
      const dy = 40 - nextY;
      for (const b of stack) b.y += dy;
      placed.y += dy;
    }

    const nextBaseSpeed = touchMode ? 190 : 170;
    const nextMaxSpeed = touchMode ? 300 : 260;
    const speed = clamp(nextBaseSpeed + score * (touchMode ? 8 : 6), nextBaseSpeed, nextMaxSpeed);
    moving = { x: 20, y: placed.y - blockH, w: nextW, h: blockH, vx: speed };
    movingSpawnedAt = performance.now();
  };

  const update = (dt: number) => {
    if (status !== "running") return;
    if (!moving) return;
    moving.x += moving.vx * dt;
    const pad = lanePadding();
    if (moving.x <= pad) {
      moving.x = pad;
      moving.vx = Math.abs(moving.vx);
    }
    if (moving.x + moving.w >= width() - pad) {
      moving.x = width() - pad - moving.w;
      moving.vx = -Math.abs(moving.vx);
    }
  };

  const draw = () => {
    const w = width();
    const h = height();
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0b1220");
    bg.addColorStop(1, "#050913");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // subtle stars
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i < 30; i++) {
      const x = (i * 97) % w;
      const y = (i * 53) % Math.floor(h * 0.6);
      ctx.fillRect(x, y, 2, 2);
    }

    for (let i = 0; i < stack.length; i++) {
      const b = stack[i];
      const shade = 210 - Math.min(140, i * 6);
      ctx.fillStyle = `rgb(${shade}, ${Math.min(220, shade + 15)}, 255)`;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(b.x + b.w - 6, b.y, 6, b.h);
    }

    if (moving) {
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(moving.x, moving.y, moving.w, moving.h);
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(moving.x + 4, moving.y + 4, Math.max(0, moving.w - 10), 4);
    }

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "600 18px ui-sans-serif, system-ui";
    ctx.fillText(`Stack: ${score}`, 14, 26);
    ctx.font = "600 14px ui-sans-serif, system-ui";
    ctx.fillText(`Combo: x${Math.max(1, combo + 1)}`, 14, 46);

    if (status === "idle") {
      ctx.font = "600 16px ui-sans-serif, system-ui";
      ctx.fillText("Tap / Space to start & drop", 14, 74);
    }
    if (status === "over") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      ctx.font = "700 22px ui-sans-serif, system-ui";
      ctx.fillText("Game Over", 14, 62);
      ctx.font = "600 16px ui-sans-serif, system-ui";
      ctx.fillText("Press R to retry", 14, 90);
    }
  };

  const loop = (t: number) => {
    raf = window.requestAnimationFrame(loop);
    const now = t / 1000;
    const dt = clamp(now - lastT, 0, 0.05);
    lastT = now;
    update(dt);
    draw();
  };

  const start = () => {
    if (status === "over") return;
    if (!startedAt) startedAt = Date.now();
    setStatus("running");
  };

  const pause = () => {
    if (status !== "running") return;
    setStatus("paused");
  };

  const reset = () => resetWorld();

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      e.preventDefault();
      drop();
    }
    if (e.code === "KeyP") {
      if (status === "running") pause();
      else if (status === "paused") start();
    }
    if (e.code === "KeyR") reset();
  };

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    drop();
  };

  const destroy = () => {
    window.cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("pointerdown", onPointerDown);
  };

  window.addEventListener("keydown", onKeyDown, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.style.touchAction = "manipulation";

  resetWorld();
  lastT = performance.now() / 1000;
  raf = window.requestAnimationFrame(loop);

  return {
    start,
    pause,
    reset,
    destroy,
    getScore: () => score,
    getStartedAt: () => startedAt,
    getStatus: () => status,
  };
};
