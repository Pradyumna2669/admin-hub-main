import { clamp, isCoarsePointer, randInt } from "@/pages/arcade/lib/canvas";
import type { ArcadeGameOverReason, ArcadeGameStatus } from "@/pages/arcade/types";

type Options = {
  onScore?: (score: number) => void;
  onStatus?: (status: ArcadeGameStatus) => void;
  onGameOver?: (payload: { score: number; reason: ArcadeGameOverReason }) => void;
  onSfx?: (name: "eat" | "hit") => void;
};

export type SnakeController = {
  start: () => void;
  pause: () => void;
  reset: () => void;
  destroy: () => void;
  getScore: () => number;
  getStartedAt: () => number | null;
  getStatus: () => ArcadeGameStatus;
};

type Dir = "up" | "down" | "left" | "right";
type Cell = { x: number; y: number };

export const createSnake = (canvas: HTMLCanvasElement, opts: Options = {}): SnakeController => {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  const touchMode = isCoarsePointer();
  const baseSpeed = touchMode ? 8.5 : 7;
  const maxSpeed = touchMode ? 15 : 13;
  let status: ArcadeGameStatus = "idle";
  let startedAt: number | null = null;
  let score = 3;

  const gridW = 22;
  const gridH = 22;

  let snake: Cell[] = [];
  let dir: Dir = "right";
  let nextDir: Dir = "right";
  let food: Cell = { x: 10, y: 10 };

  let acc = 0;
  let speed = baseSpeed;
  let raf = 0;
  let lastT = 0;

  const setStatus = (s: ArcadeGameStatus) => {
    status = s;
    opts.onStatus?.(s);
  };

  const isOpposite = (a: Dir, b: Dir) =>
    (a === "up" && b === "down") ||
    (a === "down" && b === "up") ||
    (a === "left" && b === "right") ||
    (a === "right" && b === "left");

  const cellSize = () => {
    const cw = canvas.clientWidth || 360;
    const ch = canvas.clientHeight || 360;
    return Math.floor(Math.min(cw / gridW, ch / gridH));
  };

  const origin = () => {
    const size = cellSize();
    const cw = canvas.clientWidth || 360;
    const ch = canvas.clientHeight || 360;
    const bw = gridW * size;
    const bh = gridH * size;
    return { ox: Math.floor((cw - bw) / 2), oy: Math.floor((ch - bh) / 2), size };
  };

  const spawnFood = () => {
    for (let i = 0; i < 500; i++) {
      const c = { x: randInt(0, gridW - 1), y: randInt(0, gridH - 1) };
      if (!snake.some((s) => s.x === c.x && s.y === c.y)) {
        food = c;
        return;
      }
    }
  };

  const resetWorld = () => {
    snake = [
      { x: 6, y: 11 },
      { x: 5, y: 11 },
      { x: 4, y: 11 },
    ];
    dir = "right";
    nextDir = "right";
    score = snake.length;
    startedAt = null;
    acc = 0;
    speed = baseSpeed;
    spawnFood();
    opts.onScore?.(score);
    setStatus("idle");
    draw();
  };

  const gameOver = (reason: ArcadeGameOverReason) => {
    if (status === "over") return;
    setStatus("over");
    opts.onSfx?.("hit");
    opts.onGameOver?.({ score, reason });
  };

  const step = () => {
    if (status !== "running") return;
    if (!isOpposite(dir, nextDir)) dir = nextDir;

    const head = snake[0];
    const next: Cell = { x: head.x, y: head.y };
    if (dir === "up") next.y -= 1;
    if (dir === "down") next.y += 1;
    if (dir === "left") next.x -= 1;
    if (dir === "right") next.x += 1;

    if (next.x < 0 || next.x >= gridW || next.y < 0 || next.y >= gridH) return gameOver("wall_hit");
    if (snake.some((s) => s.x === next.x && s.y === next.y)) return gameOver("self_hit");

    snake.unshift(next);

    const ate = next.x === food.x && next.y === food.y;
    if (ate) {
      spawnFood();
      score = snake.length;
      speed = clamp(baseSpeed + (score - 3) * 0.18, baseSpeed, maxSpeed);
      opts.onScore?.(score);
      opts.onSfx?.("eat");
    } else {
      snake.pop();
    }
  };

  const update = (dt: number) => {
    if (status !== "running") return;
    acc += dt;
    const interval = 1 / speed;
    while (acc >= interval) {
      acc -= interval;
      step();
    }
  };

  const draw = () => {
    const { ox, oy, size } = origin();
    const cw = canvas.clientWidth || 360;
    const ch = canvas.clientHeight || 360;

    ctx.clearRect(0, 0, cw, ch);
    const bg = ctx.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, "#081426");
    bg.addColorStop(1, "#07101c");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);

    // subtle grid texture
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(ox, oy, gridW * size, gridH * size);
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= gridW; x++) {
      ctx.beginPath();
      ctx.moveTo(ox + x * size, oy);
      ctx.lineTo(ox + x * size, oy + gridH * size);
      ctx.stroke();
    }
    for (let y = 0; y <= gridH; y++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + y * size);
      ctx.lineTo(ox + gridW * size, oy + y * size);
      ctx.stroke();
    }

    // food (apple-like)
    const fx = ox + food.x * size;
    const fy = oy + food.y * size;
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.ellipse(fx + size / 2, fy + size / 2 + 1, size * 0.38, size * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.ellipse(fx + size / 2 - 4, fy + size / 2 - 3, size * 0.12, size * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#14532d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fx + size / 2, fy + size / 2 - 6);
    ctx.lineTo(fx + size / 2 + 2, fy + size / 2 - 12);
    ctx.stroke();

    const snakeGrad = ctx.createLinearGradient(ox, 0, ox + gridW * size, 0);
    snakeGrad.addColorStop(0, "#16a34a");
    snakeGrad.addColorStop(1, "#22c55e");
    ctx.fillStyle = snakeGrad;
    for (let i = 0; i < snake.length; i++) {
      const s = snake[i];
      ctx.globalAlpha = i === 0 ? 1 : 0.9;
      const x = ox + s.x * size + 1;
      const y = oy + s.y * size + 1;
      const r = Math.max(3, Math.floor(size * 0.2));
      ctx.beginPath();
      ctx.roundRect(x, y, size - 2, size - 2, r);
      ctx.fill();
      if (i === 0) {
        // eyes
        ctx.fillStyle = "#0b1220";
        ctx.beginPath();
        ctx.arc(x + (size - 2) * 0.35, y + (size - 2) * 0.35, 1.8, 0, Math.PI * 2);
        ctx.arc(x + (size - 2) * 0.65, y + (size - 2) * 0.35, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = snakeGrad;
      }
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "600 18px ui-sans-serif, system-ui";
    ctx.fillText(`Length: ${score}`, 14, 26);

    if (status === "idle") {
      ctx.font = "600 16px ui-sans-serif, system-ui";
      ctx.fillText("Swipe / Arrows to start", 14, 54);
    }
    if (status === "over") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, cw, ch);
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

  const setDir = (d: Dir) => {
    if (status === "over") return;
    if (status === "idle") start();
    if (isOpposite(dir, d)) return;
    nextDir = d;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "ArrowUp" || e.code === "KeyW") setDir("up");
    if (e.code === "ArrowDown" || e.code === "KeyS") setDir("down");
    if (e.code === "ArrowLeft" || e.code === "KeyA") setDir("left");
    if (e.code === "ArrowRight" || e.code === "KeyD") setDir("right");
    if (e.code === "KeyP") {
      if (status === "running") pause();
      else if (status === "paused") start();
    }
    if (e.code === "KeyR") reset();
  };

  let swipeStart: { x: number; y: number; t: number } | null = null;
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    swipeStart = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onPointerUp = (e: PointerEvent) => {
    e.preventDefault();
    if (!swipeStart) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    const dist = Math.hypot(dx, dy);
    const dt = Date.now() - swipeStart.t;
    swipeStart = null;
    if (dist < 18 || dt > 900) return;
    if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? "right" : "left");
    else setDir(dy > 0 ? "down" : "up");
  };

  const destroy = () => {
    window.cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
  };

  window.addEventListener("keydown", onKeyDown, { passive: true });
  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointerup", onPointerUp, { passive: false });
  canvas.style.touchAction = "none";

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
