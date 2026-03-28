import { clamp, isCoarsePointer, randInt } from "@/pages/arcade/lib/canvas";
import type { ArcadeGameOverReason, ArcadeGameStatus } from "@/pages/arcade/types";

type Options = {
  onScore?: (score: number) => void;
  onStatus?: (status: ArcadeGameStatus) => void;
  onGameOver?: (payload: { score: number; reason: ArcadeGameOverReason }) => void;
  onSfx?: (name: "flap" | "point" | "hit") => void;
};

export type FlappyController = {
  start: () => void;
  pause: () => void;
  reset: () => void;
  destroy: () => void;
  getScore: () => number;
  getStartedAt: () => number | null;
  getStatus: () => ArcadeGameStatus;
};

export const createFlappy = (canvas: HTMLCanvasElement, opts: Options = {}): FlappyController => {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  const touchMode = isCoarsePointer();
  let status: ArcadeGameStatus = "idle";
  let startedAt: number | null = null;

  const w = () => canvas.clientWidth || 320;
  const h = () => canvas.clientHeight || 480;

  const bird = { x: touchMode ? 84 : 90, y: 200, vy: 0, r: 12 };
  const gravity = touchMode ? 980 : 900;
  const jumpV = touchMode ? -305 : -320;

  type Pipe = { x: number; gapY: number; passed: boolean };
  let pipes: Pipe[] = [];
  const pipeW = 58;
  const gap = touchMode ? 126 : 140;
  const baseSpeed = touchMode ? 180 : 160;
  let spawnAcc = 0;
  const spawnEvery = touchMode ? 1.1 : 1.25;

  let score = 0;
  let raf = 0;
  let lastT = 0;
  let bgX = 0;
  let groundX = 0;

  const setStatus = (s: ArcadeGameStatus) => {
    status = s;
    opts.onStatus?.(s);
  };

  const resetWorld = () => {
    bird.y = h() * 0.45;
    bird.vy = 0;
    pipes = [];
    spawnAcc = 0;
    score = 0;
    startedAt = null;
    opts.onScore?.(0);
    setStatus("idle");
    draw(0);
  };

  const addPipe = () => {
    const minY = 90;
    const maxY = Math.max(minY + 20, h() - 90);
    pipes.push({ x: w() + 40, gapY: randInt(minY, maxY), passed: false });
  };

  const flap = () => {
    if (status === "over") return;
    if (status === "idle") start();
    bird.vy = jumpV;
    opts.onSfx?.("flap");
  };

  const collide = (p: Pipe) => {
    const topH = p.gapY - gap / 2;
    const botY = p.gapY + gap / 2;
    const bx = bird.x;
    const by = bird.y;
    const withinX = bx + bird.r > p.x && bx - bird.r < p.x + pipeW;
    if (!withinX) return false;
    if (by - bird.r < topH) return true;
    if (by + bird.r > botY) return true;
    return false;
  };

  const gameOver = (reason: ArcadeGameOverReason) => {
    if (status === "over") return;
    setStatus("over");
    opts.onSfx?.("hit");
    opts.onGameOver?.({ score, reason });
  };

  const update = (dt: number) => {
    if (status !== "running") return;

    bird.vy += gravity * dt;
    bird.y += bird.vy * dt;

    if (bird.y - bird.r < 0) {
      bird.y = bird.r;
      bird.vy = 0;
    }
    if (bird.y + bird.r > h()) return gameOver("out_of_bounds");

    spawnAcc += dt;
    if (spawnAcc >= spawnEvery) {
      spawnAcc -= spawnEvery;
      addPipe();
    }

    for (const p of pipes) {
      p.x -= baseSpeed * dt;
      if (!p.passed && p.x + pipeW < bird.x - bird.r) {
        p.passed = true;
        score += 1;
        opts.onScore?.(score);
        opts.onSfx?.("point");
      }
      if (collide(p)) return gameOver("collision");
    }
    pipes = pipes.filter((p) => p.x + pipeW > -40);
  };

  const draw = (_dt: number) => {
    const width = w();
    const height = h();

    ctx.clearRect(0, 0, width, height);
    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#79c2ff");
    sky.addColorStop(1, "#d8f3ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // Parallax clouds
    bgX = (bgX + (_dt || 0) * 12) % (width + 220);
    const cloud = (x: number, y: number, s: number) => {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.ellipse(x, y, 22 * s, 14 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 18 * s, y + 6 * s, 18 * s, 12 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x - 18 * s, y + 6 * s, 18 * s, 12 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    for (let i = 0; i < 5; i++) {
      const x = ((i * 220 - bgX) % (width + 220)) - 40;
      cloud(x, 70 + i * 22, 1.0 - i * 0.08);
      cloud(x + 120, 110 + i * 18, 0.9 - i * 0.06);
    }

    ctx.fillStyle = "#1f9d55";
    for (const p of pipes) {
      const topH = p.gapY - gap / 2;
      const botY = p.gapY + gap / 2;
      const grad = ctx.createLinearGradient(p.x, 0, p.x + pipeW, 0);
      grad.addColorStop(0, "#178f49");
      grad.addColorStop(0.5, "#22c55e");
      grad.addColorStop(1, "#126b38");
      ctx.fillStyle = grad;
      ctx.fillRect(p.x, 0, pipeW, Math.max(0, topH));
      ctx.fillRect(p.x, botY, pipeW, Math.max(0, height - botY));
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(p.x + pipeW - 6, 0, 6, Math.max(0, topH));
      ctx.fillRect(p.x + pipeW - 6, botY, 6, Math.max(0, height - botY));
    }

    // Ground
    const groundH = 72;
    groundX = (groundX + (_dt || 0) * 120) % 48;
    const gy = height - groundH;
    const dirt = ctx.createLinearGradient(0, gy, 0, height);
    dirt.addColorStop(0, "#caa56a");
    dirt.addColorStop(1, "#9b6b3d");
    ctx.fillStyle = dirt;
    ctx.fillRect(0, gy, width, groundH);
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(0, gy, width, 6);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    for (let x = -48; x < width + 48; x += 48) {
      ctx.fillRect(x - groundX, gy + 18, 28, 6);
      ctx.fillRect(x - groundX + 14, gy + 36, 22, 6);
    }

    // Bird (simple 2D sprite drawing)
    const wingPhase = (performance.now() / 120) % (Math.PI * 2);
    const wing = Math.sin(wingPhase) * 6;
    const tilt = Math.max(-0.7, Math.min(0.7, bird.vy / 420));
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(tilt);
    // body
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    // belly
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-3, 3, 10, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // wing
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.ellipse(-4, 2 + wing * 0.25, 9, 6, 0.25, 0, Math.PI * 2);
    ctx.fill();
    // beak
    ctx.fillStyle = "#fb7185";
    ctx.beginPath();
    ctx.moveTo(14, -1);
    ctx.lineTo(22, 2);
    ctx.lineTo(14, 4);
    ctx.closePath();
    ctx.fill();
    // eye
    ctx.fillStyle = "#0b1220";
    ctx.beginPath();
    ctx.arc(6, -4, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(6.7, -4.7, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "600 18px ui-sans-serif, system-ui";
    ctx.fillText(`Score: ${score}`, 14, 26);

    if (status === "idle") {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "600 16px ui-sans-serif, system-ui";
      ctx.fillText("Tap / Space to start & flap", 14, 54);
    }
    if (status === "over") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, width, height);
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
    draw(dt);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      flap();
    }
    if (e.code === "KeyP") {
      if (status === "running") pause();
      else if (status === "paused") start();
    }
    if (e.code === "KeyR") reset();
  };

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    flap();
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

  const reset = () => {
    setStatus("idle");
    resetWorld();
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
