import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.ARCADE_SURVIVOR_PORT || 3101);
const CLIENT_ORIGIN = process.env.ARCADE_SURVIVOR_CLIENT_ORIGIN || "*";
const DB_DIR = path.join(__dirname, "data");
const DB_PATH = process.env.ARCADE_SURVIVOR_DB_PATH || path.join(DB_DIR, "survivor.sqlite");

const WORLD_WIDTH = 2600;
const WORLD_HEIGHT = 2600;
const ROOM_CAPACITY = 18;
const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;
const STARTING_RADIUS = 1180;
const FINAL_RADIUS = 130;
const MATCH_START_DELAY_MS = 7000;
const BULLET_SPEED = 1300;
const PLAYER_RADIUS = 18;
const PLAYER_HP = 100;
const MOVE_SPEED = 220;
const FIRE_INTERVAL_MS = 125;
const CLIP_SIZE = 24;
const RELOAD_MS = 1450;
const KILL_CREDIT_REWARD = 8;
const PLACEMENT_REWARDS = [140, 90, 55, 25];
const SHRINK_PLAN = [
  { delayMs: 8000, durationMs: 18000, radius: 900 },
  { delayMs: 4000, durationMs: 16000, radius: 650 },
  { delayMs: 3500, durationMs: 14000, radius: 430 },
  { delayMs: 3000, durationMs: 12000, radius: 250 },
  { delayMs: 2500, durationMs: 10000, radius: FINAL_RADIUS },
];

const obstacles = [
  { x: 720, y: 540, r: 52 },
  { x: 1050, y: 910, r: 78 },
  { x: 1450, y: 710, r: 64 },
  { x: 1780, y: 1180, r: 92 },
  { x: 890, y: 1580, r: 86 },
  { x: 1360, y: 1830, r: 70 },
  { x: 1910, y: 1640, r: 60 },
  { x: 540, y: 1970, r: 55 },
];

fs.mkdirSync(DB_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS arcade_survivor_players (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    matches_played INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS arcade_survivor_results (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    placement INTEGER NOT NULL,
    kills INTEGER NOT NULL DEFAULT 0,
    credits_awarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_arcade_survivor_results_created_at
    ON arcade_survivor_results (created_at DESC);
`);

const upsertPlayerStmt = db.prepare(`
  INSERT INTO arcade_survivor_players (user_id, display_name)
  VALUES (?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    display_name = excluded.display_name,
    updated_at = CURRENT_TIMESTAMP
`);

const getPlayerStmt = db.prepare(`
  SELECT user_id, display_name, credits, wins, kills, matches_played
  FROM arcade_survivor_players
  WHERE user_id = ?
`);

const leaderboardStmt = db.prepare(`
  SELECT user_id, display_name, credits, wins, kills, matches_played
  FROM arcade_survivor_players
  ORDER BY wins DESC, kills DESC, credits DESC, updated_at DESC
  LIMIT ?
`);

const recentResultsStmt = db.prepare(`
  SELECT room_id, display_name, placement, kills, credits_awarded, created_at
  FROM arcade_survivor_results
  WHERE user_id = ?
  ORDER BY created_at DESC
  LIMIT 6
`);

const recordResultTxn = db.transaction((entries) => {
  for (const entry of entries) {
    db.prepare(`
      INSERT INTO arcade_survivor_results (id, room_id, user_id, display_name, placement, kills, credits_awarded)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      entry.roomId,
      entry.userId,
      entry.displayName,
      entry.placement,
      entry.kills,
      entry.creditsAwarded,
    );

    db.prepare(`
      INSERT INTO arcade_survivor_players (user_id, display_name, credits, wins, kills, matches_played)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name,
        credits = arcade_survivor_players.credits + excluded.credits,
        wins = arcade_survivor_players.wins + excluded.wins,
        kills = arcade_survivor_players.kills + excluded.kills,
        matches_played = arcade_survivor_players.matches_played + 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      entry.userId,
      entry.displayName,
      entry.creditsAwarded,
      entry.placement === 1 ? 1 : 0,
      entry.kills,
    );
  }
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const normalizeVector = (x, y) => {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
};

const randomSpawn = (room) => {
  for (let i = 0; i < 30; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * (room.zone.radius * 0.65);
    const x = room.zone.center.x + Math.cos(angle) * radius;
    const y = room.zone.center.y + Math.sin(angle) * radius;

    if (obstacles.some((obstacle) => Math.hypot(obstacle.x - x, obstacle.y - y) < obstacle.r + PLAYER_RADIUS + 10)) {
      continue;
    }

    return {
      x: clamp(x, 60, WORLD_WIDTH - 60),
      y: clamp(y, 60, WORLD_HEIGHT - 60),
    };
  }

  return {
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
  };
};

const createRoom = () => {
  const center = {
    x: WORLD_WIDTH * (0.45 + Math.random() * 0.1),
    y: WORLD_HEIGHT * (0.45 + Math.random() * 0.1),
  };

  return {
    id: randomUUID(),
    createdAt: Date.now(),
    status: "waiting",
    countdownStartedAt: null,
    startedAt: null,
    finishedAt: null,
    players: new Map(),
    sockets: new Set(),
    trails: [],
    zone: {
      center,
      radius: STARTING_RADIUS,
      currentPhase: -1,
      phaseStartedAt: null,
      phaseFromRadius: STARTING_RADIUS,
      phaseToRadius: STARTING_RADIUS,
      phaseDelayUntil: null,
    },
  };
};

const rooms = new Map();

const getOrCreateWaitingRoom = () => {
  for (const room of rooms.values()) {
    if (room.status === "waiting" && room.players.size < ROOM_CAPACITY) {
      return room;
    }
  }
  const room = createRoom();
  rooms.set(room.id, room);
  return room;
};

const awardCreditsForRoom = (room) => {
  const placements = [...room.players.values()]
    .filter((player) => player.stats.finished)
    .sort((a, b) => a.stats.placement - b.stats.placement);

  const results = placements.map((player) => ({
    roomId: room.id,
    userId: player.userId,
    displayName: player.displayName,
    placement: player.stats.placement,
    kills: player.stats.kills,
    creditsAwarded: player.stats.creditsAwarded,
  }));

  if (results.length > 0) {
    recordResultTxn(results);
  }
};

const maybeFinishRoom = (room) => {
  const alive = [...room.players.values()].filter((player) => player.alive);
  if (room.status !== "live" || alive.length > 1) return;

  if (alive.length === 1) {
    alive[0].stats.placement = 1;
    alive[0].stats.finished = true;
    alive[0].stats.creditsAwarded += PLACEMENT_REWARDS[0] || 0;
  }

  room.status = "finished";
  room.finishedAt = Date.now();
  awardCreditsForRoom(room);
};

const lineIntersectsObstacle = (start, end) => {
  for (const obstacle of obstacles) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy || 1;
    const t = clamp(((obstacle.x - start.x) * dx + (obstacle.y - start.y) * dy) / lengthSquared, 0, 1);
    const px = start.x + dx * t;
    const py = start.y + dy * t;
    const dist = Math.hypot(px - obstacle.x, py - obstacle.y);
    if (dist <= obstacle.r + 2) return true;
  }
  return false;
};

const applyElimination = (room, victim, killerId = null) => {
  if (!victim.alive) return;

  victim.alive = false;
  victim.hp = 0;
  const eliminatedCount = [...room.players.values()].filter((player) => !player.alive).length;
  const totalPlayers = room.players.size;
  victim.stats.placement = totalPlayers - eliminatedCount + 1;
  victim.stats.finished = true;
  victim.inputs.fire = false;

  const placementRewardIndex = victim.stats.placement - 1;
  if (placementRewardIndex >= 0 && placementRewardIndex < PLACEMENT_REWARDS.length) {
    victim.stats.creditsAwarded += PLACEMENT_REWARDS[placementRewardIndex];
  }

  if (killerId && killerId !== victim.userId) {
    const killer = room.players.get(killerId);
    if (killer) {
      killer.stats.kills += 1;
      killer.stats.creditsAwarded += KILL_CREDIT_REWARD;
      killer.lastHitAt = Date.now();
    }
  }

  maybeFinishRoom(room);
};

const updateZone = (room, now) => {
  if (room.status !== "live" || !room.startedAt) return;

  const zone = room.zone;
  if (zone.currentPhase === -1) {
    zone.currentPhase = 0;
    zone.phaseDelayUntil = room.startedAt + SHRINK_PLAN[0].delayMs;
    zone.phaseStartedAt = null;
    zone.phaseFromRadius = STARTING_RADIUS;
    zone.phaseToRadius = STARTING_RADIUS;
    return;
  }

  const phase = SHRINK_PLAN[zone.currentPhase];
  if (!phase) return;

  if (zone.phaseStartedAt === null) {
    if (now >= zone.phaseDelayUntil) {
      zone.phaseStartedAt = now;
      zone.phaseFromRadius = zone.radius;
      zone.phaseToRadius = phase.radius;
    }
    return;
  }

  const progress = clamp((now - zone.phaseStartedAt) / phase.durationMs, 0, 1);
  zone.radius = zone.phaseFromRadius + (zone.phaseToRadius - zone.phaseFromRadius) * progress;

  if (progress >= 1) {
    zone.currentPhase += 1;
    zone.phaseStartedAt = null;
    zone.phaseFromRadius = zone.radius;
    zone.phaseToRadius = zone.radius;
    const nextPhase = SHRINK_PLAN[zone.currentPhase];
    zone.phaseDelayUntil = nextPhase ? now + nextPhase.delayMs : null;
  }
};

const damageFromZone = (room, now, dtSeconds) => {
  if (room.status !== "live") return;
  const phase = Math.max(room.zone.currentPhase, 0);
  const dps = 3 + phase * 1.8;

  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dist = Math.hypot(player.x - room.zone.center.x, player.y - room.zone.center.y);
    if (dist <= room.zone.radius) continue;
    player.hp = Math.max(0, player.hp - dps * dtSeconds);
    player.lastDamagedAt = now;
    if (player.hp <= 0) {
      applyElimination(room, player, null);
    }
  }
};

const maybeStartRoom = (room, now) => {
  if (room.status !== "waiting") return;
  if (room.players.size === 0) return;

  if (room.countdownStartedAt === null) {
    room.countdownStartedAt = now;
  }

  if (now - room.countdownStartedAt < MATCH_START_DELAY_MS) return;

  room.status = "live";
  room.startedAt = now;
  for (const player of room.players.values()) {
    const spawn = randomSpawn(room);
    Object.assign(player, spawn, {
      vx: 0,
      vy: 0,
      hp: PLAYER_HP,
      ammo: CLIP_SIZE,
      reloadingUntil: 0,
      nextShotAt: 0,
      alive: true,
      angle: 0,
      lastDamagedAt: 0,
      lastHitAt: 0,
      joinedAt: now,
      stats: {
        kills: 0,
        placement: room.players.size,
        finished: false,
        creditsAwarded: 0,
      },
    });
  }
};

const updateMovement = (player, dtSeconds) => {
  if (!player.alive) return;

  const moveX = (player.inputs.right ? 1 : 0) - (player.inputs.left ? 1 : 0);
  const moveY = (player.inputs.down ? 1 : 0) - (player.inputs.up ? 1 : 0);
  const norm = moveX || moveY ? normalizeVector(moveX, moveY) : { x: 0, y: 0 };
  player.vx = norm.x * MOVE_SPEED;
  player.vy = norm.y * MOVE_SPEED;

  const nextX = clamp(player.x + player.vx * dtSeconds, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS);
  const nextY = clamp(player.y + player.vy * dtSeconds, PLAYER_RADIUS, WORLD_HEIGHT - PLAYER_RADIUS);

  const blocked = obstacles.some((obstacle) => Math.hypot(nextX - obstacle.x, nextY - obstacle.y) < obstacle.r + PLAYER_RADIUS);
  if (!blocked) {
    player.x = nextX;
    player.y = nextY;
  }

  if (Number.isFinite(player.inputs.aimX) && Number.isFinite(player.inputs.aimY)) {
    player.angle = Math.atan2(player.inputs.aimY - player.y, player.inputs.aimX - player.x);
  }
};

const tryFire = (room, player, now) => {
  if (!player.alive || !player.inputs.fire) return;
  if (now < player.nextShotAt) return;

  if (player.reloadingUntil > now) return;
  if (player.ammo <= 0) {
    player.reloadingUntil = now + RELOAD_MS;
    return;
  }

  player.nextShotAt = now + FIRE_INTERVAL_MS;
  player.ammo -= 1;

  if (player.ammo <= 0) {
    player.reloadingUntil = now + RELOAD_MS;
  }

  const direction = normalizeVector(Math.cos(player.angle), Math.sin(player.angle));
  const start = {
    x: player.x + direction.x * 26,
    y: player.y + direction.y * 26,
  };
  const end = {
    x: clamp(start.x + direction.x * 720, 0, WORLD_WIDTH),
    y: clamp(start.y + direction.y * 720, 0, WORLD_HEIGHT),
  };

  let closestTarget = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const target of room.players.values()) {
    if (!target.alive || target.userId === player.userId) continue;

    const toTarget = { x: target.x - start.x, y: target.y - start.y };
    const proj = toTarget.x * direction.x + toTarget.y * direction.y;
    if (proj < 0 || proj > 720) continue;

    const point = {
      x: start.x + direction.x * proj,
      y: start.y + direction.y * proj,
    };
    const miss = Math.hypot(point.x - target.x, point.y - target.y);
    if (miss > PLAYER_RADIUS + 4) continue;
    if (lineIntersectsObstacle(start, point)) continue;
    if (proj < closestDistance) {
      closestDistance = proj;
      closestTarget = target;
    }
  }

  const trailEnd = closestTarget
    ? {
        x: start.x + direction.x * closestDistance,
        y: start.y + direction.y * closestDistance,
      }
    : end;

  room.trails.push({
    id: randomUUID(),
    ownerId: player.userId,
    start,
    end: trailEnd,
    createdAt: now,
  });

  if (closestTarget) {
    closestTarget.hp = Math.max(0, closestTarget.hp - 24);
    closestTarget.lastDamagedAt = now;
    if (closestTarget.hp <= 0) {
      applyElimination(room, closestTarget, player.userId);
    }
  }
};

const tickRoom = (room, now) => {
  maybeStartRoom(room, now);
  updateZone(room, now);

  for (const player of room.players.values()) {
    updateMovement(player, TICK_MS / 1000);
    if (player.reloadingUntil && player.reloadingUntil <= now && player.ammo <= 0) {
      player.ammo = CLIP_SIZE;
      player.reloadingUntil = 0;
    }
    tryFire(room, player, now);
  }

  damageFromZone(room, now, TICK_MS / 1000);
  room.trails = room.trails.filter((trail) => now - trail.createdAt < 220);

  if (room.status === "finished" && room.finishedAt && now - room.finishedAt > 12000) {
    rooms.delete(room.id);
  }
};

const serializeRoom = (room, selfId) => {
  const players = [...room.players.values()].map((player) => ({
    userId: player.userId,
    displayName: player.displayName,
    x: Number(player.x.toFixed(2)),
    y: Number(player.y.toFixed(2)),
    vx: Number(player.vx.toFixed(2)),
    vy: Number(player.vy.toFixed(2)),
    hp: Math.round(player.hp),
    ammo: player.ammo,
    alive: player.alive,
    angle: Number(player.angle.toFixed(4)),
    kills: player.stats.kills,
    placement: player.stats.placement,
    recentlyHit: Date.now() - player.lastDamagedAt < 160,
  }));

  const aliveCount = players.filter((player) => player.alive).length;
  const standings = [...players]
    .sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.placement !== b.placement) return a.placement - b.placement;
      return b.kills - a.kills;
    })
    .slice(0, 8)
    .map((player, index) => ({
      rank: index + 1,
      userId: player.userId,
      displayName: player.userId === selfId ? "You" : player.displayName,
      kills: player.kills,
      alive: player.alive,
      placement: player.placement,
    }));

  return {
    serverTime: Date.now(),
    roomId: room.id,
    status: room.status,
    countdownMs:
      room.status === "waiting" && room.countdownStartedAt
        ? Math.max(0, MATCH_START_DELAY_MS - (Date.now() - room.countdownStartedAt))
        : 0,
    world: {
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      obstacles,
      zone: room.zone,
    },
    aliveCount,
    players,
    trails: room.trails,
    standings,
  };
};

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CLIENT_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.get("/api/arcade-survivor/health", (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    uptimeSec: Math.round(process.uptime()),
  });
});

app.get("/api/arcade-survivor/profile/:userId", (req, res) => {
  const userId = String(req.params.userId || "").trim();
  if (!userId) {
    res.status(400).json({ error: "missing_user_id" });
    return;
  }

  const row = getPlayerStmt.get(userId);
  res.json({
    profile: row || {
      user_id: userId,
      display_name: "Player",
      credits: 0,
      wins: 0,
      kills: 0,
      matches_played: 0,
    },
    recentResults: recentResultsStmt.all(userId),
  });
});

app.get("/api/arcade-survivor/leaderboard", (req, res) => {
  const limit = clamp(Number(req.query.limit || 10) || 10, 1, 25);
  res.json({
    leaderboard: leaderboardStmt.all(limit),
  });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
  path: "/socket.io/arcade-survivor",
});

io.on("connection", (socket) => {
  let room = null;
  let player = null;

  socket.on("arcade:join", (payload = {}) => {
    const userId = String(payload.userId || "").trim();
    const displayName = String(payload.displayName || "Player")
      .trim()
      .slice(0, 24) || "Player";

    if (!userId) {
      socket.emit("arcade:error", { message: "Missing user id." });
      return;
    }

    upsertPlayerStmt.run(userId, displayName);

    room = getOrCreateWaitingRoom();
    player = {
      userId,
      displayName,
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
      vx: 0,
      vy: 0,
      hp: PLAYER_HP,
      ammo: CLIP_SIZE,
      reloadingUntil: 0,
      nextShotAt: 0,
      alive: true,
      angle: 0,
      lastDamagedAt: 0,
      lastHitAt: 0,
      joinedAt: Date.now(),
      inputs: {
        up: false,
        down: false,
        left: false,
        right: false,
        fire: false,
        aimX: WORLD_WIDTH / 2,
        aimY: WORLD_HEIGHT / 2,
      },
      stats: {
        kills: 0,
        placement: ROOM_CAPACITY,
        finished: false,
        creditsAwarded: 0,
      },
      socketId: socket.id,
    };

    room.players.set(userId, player);
    room.sockets.add(socket.id);
    socket.join(room.id);

    socket.emit("arcade:joined", {
      roomId: room.id,
      tickRate: TICK_RATE,
      world: {
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        obstacles,
      },
    });
  });

  socket.on("arcade:input", (payload = {}) => {
    if (!player) return;
    player.inputs.up = !!payload.up;
    player.inputs.down = !!payload.down;
    player.inputs.left = !!payload.left;
    player.inputs.right = !!payload.right;
    player.inputs.fire = !!payload.fire;
    player.inputs.aimX = Number(payload.aimX ?? player.inputs.aimX);
    player.inputs.aimY = Number(payload.aimY ?? player.inputs.aimY);
  });

  socket.on("disconnect", () => {
    if (!room || !player) return;
    const existing = room.players.get(player.userId);
    if (existing) {
      if (room.status === "live" && existing.alive) {
        applyElimination(room, existing, null);
      }
      room.players.delete(player.userId);
    }
    room.sockets.delete(socket.id);
    if (room.players.size === 0) {
      rooms.delete(room.id);
    } else {
      maybeFinishRoom(room);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    tickRoom(room, now);
    for (const player of room.players.values()) {
      const snapshot = serializeRoom(room, player.userId);
      io.to(player.socketId).emit("arcade:snapshot", snapshot);
    }
  }
}, TICK_MS);

httpServer.listen(PORT, () => {
  console.log(`Arcade survivor server listening on http://localhost:${PORT}`);
});
