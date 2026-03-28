import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import sqlite3 from "sqlite3";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.BLASTER_PORT || 3001);
const CLIENT_ORIGIN = process.env.BLASTER_CLIENT_ORIGIN || "*";
const TICK_RATE = 20;
const SNAPSHOT_RATE = 20;
const WORLD_SIZE = 2200;
const PLAYER_RADIUS = 16;
const MAX_PLAYERS = 24;
const MIN_PLAYERS_TO_START = 2;
const ROUND_START_DELAY_MS = 3500;
const ROUND_END_DELAY_MS = 7000;
const PLAYER_SPEED = 250;
const BULLET_SPEED = 850;
const BULLET_LIFETIME_MS = 900;
const FIRE_COOLDOWN_MS = 125;
const RESPAWN_HEALTH = 100;
const CLIP_SIZE = 24;
const RELOAD_MS = 1450;
const ZONE_TICK_MS = 22000;
const ZONE_SHRINK_FACTOR = 0.84;
const ZONE_MIN_RADIUS = 150;
const ZONE_DAMAGE_PER_SECOND = 12;
const REWARD_BY_PLACE = [120, 70, 35];

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, "arcade-blaster.sqlite"));

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve(this);
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });

await run(`
  CREATE TABLE IF NOT EXISTS blaster_players (
    player_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    matches INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

await run(`
  CREATE TABLE IF NOT EXISTS blaster_match_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    placement INTEGER NOT NULL,
    kills INTEGER NOT NULL,
    credits_earned INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const rand = (min, max) => Math.random() * (max - min) + min;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const normalize = (x, y) => {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
};
const now = () => Date.now();
const createSpawn = () => ({ x: rand(180, WORLD_SIZE - 180), y: rand(180, WORLD_SIZE - 180) });
const getHumanPlayers = () => [...game.players.values()];
const getConnectedHumans = () => getHumanPlayers().filter((player) => !!player.socketId);

const defaultWeapon = () => ({
  ammo: CLIP_SIZE,
  reserveAmmo: CLIP_SIZE * 3,
  reloadingUntil: 0,
  lastShotAt: 0,
});

const initialRoundState = () => ({
  id: `round-${Date.now()}`,
  phase: "waiting",
  phaseEndsAt: now() + ROUND_START_DELAY_MS,
  zone: {
    x: WORLD_SIZE / 2,
    y: WORLD_SIZE / 2,
    radius: WORLD_SIZE * 0.44,
    targetRadius: WORLD_SIZE * 0.44,
    closesAt: now() + ZONE_TICK_MS,
  },
  startedAt: 0,
  endedAt: 0,
  placements: [],
});

const game = {
  players: new Map(),
  sockets: new Map(),
  bullets: [],
  round: initialRoundState(),
  lastSnapshotAt: 0,
  lastTickAt: now(),
};

const sanitizeName = (value, fallback) => {
  const name = `${value || ""}`.trim().replace(/\s+/g, " ");
  if (!name) return fallback;
  return name.slice(0, 20);
};

const createHumanState = ({ socketId, playerId, displayName }) => {
  const spawn = createSpawn();
  return {
    id: playerId,
    socketId,
    displayName,
    type: "human",
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    angle: 0,
    health: RESPAWN_HEALTH,
    alive: false,
    kills: 0,
    damageFlashAt: 0,
    lastSeenAt: now(),
    weapon: defaultWeapon(),
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      firing: false,
      aimX: spawn.x + 1,
      aimY: spawn.y,
    },
  };
};

const getLivingActors = () => getHumanPlayers().filter((player) => player.alive);
const aliveCountForPlacement = () => getLivingActors().length;

const ensurePlayerProfile = async (playerId, displayName) => {
  await run(
    `
      INSERT INTO blaster_players (player_id, display_name)
      VALUES (?, ?)
      ON CONFLICT(player_id) DO UPDATE SET
        display_name = excluded.display_name,
        updated_at = CURRENT_TIMESTAMP
    `,
    [playerId, displayName],
  );
};

const fetchPlayerProfile = async (playerId, displayName = "Player") => {
  await ensurePlayerProfile(playerId, displayName);
  const row = await get(
    `
      SELECT player_id, display_name, credits, wins, kills, matches
      FROM blaster_players
      WHERE player_id = ?
    `,
    [playerId],
  );

  return row || {
    player_id: playerId,
    display_name: displayName,
    credits: 0,
    wins: 0,
    kills: 0,
    matches: 0,
  };
};

const fetchLeaderboard = async () =>
  all(
    `
      SELECT player_id, display_name, credits, wins, kills, matches
      FROM blaster_players
      ORDER BY credits DESC, wins DESC, kills DESC, updated_at ASC
      LIMIT 20
    `,
  );

const upsertResult = async (player, placement, creditsEarned) => {
  await run(
    `
      INSERT INTO blaster_match_results (player_id, display_name, placement, kills, credits_earned)
      VALUES (?, ?, ?, ?, ?)
    `,
    [player.id, player.displayName, placement, player.kills, creditsEarned],
  );

  await run(
    `
      INSERT INTO blaster_players (player_id, display_name, credits, wins, kills, matches, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(player_id) DO UPDATE SET
        display_name = excluded.display_name,
        credits = blaster_players.credits + excluded.credits,
        wins = blaster_players.wins + excluded.wins,
        kills = blaster_players.kills + excluded.kills,
        matches = blaster_players.matches + 1,
        updated_at = CURRENT_TIMESTAMP
    `,
    [player.id, player.displayName, creditsEarned, placement === 1 ? 1 : 0, player.kills],
  );
};

const resetRoundZone = () => ({
  x: WORLD_SIZE / 2,
  y: WORLD_SIZE / 2,
  radius: WORLD_SIZE * 0.44,
  targetRadius: WORLD_SIZE * 0.44,
  closesAt: now() + ZONE_TICK_MS,
});

const resetActorForRound = (player) => {
  const spawn = createSpawn();
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.health = RESPAWN_HEALTH;
  player.kills = 0;
  player.alive = true;
  player.damageFlashAt = 0;
  player.weapon = defaultWeapon();
  player.input.aimX = spawn.x + 1;
  player.input.aimY = spawn.y;
};

const eliminatePlayer = (victim, attacker, reason = "shot") => {
  if (!victim.alive) return;
  victim.alive = false;
  victim.health = 0;
  victim.damageFlashAt = now();

  if (attacker && attacker.id !== victim.id) attacker.kills += 1;

  game.round.placements.push({
    playerId: victim.id,
    displayName: victim.displayName,
    type: victim.type,
    placement: aliveCountForPlacement(),
    kills: victim.kills,
    reason,
  });
};

const maybeStartRound = () => {
  const humanCount = getConnectedHumans().length;
  if (game.round.phase === "waiting" && humanCount >= MIN_PLAYERS_TO_START) {
    game.round.phase = "starting";
    game.round.phaseEndsAt = now() + ROUND_START_DELAY_MS;
  }
  if (game.round.phase === "starting" && humanCount < MIN_PLAYERS_TO_START) {
    game.round.phase = "waiting";
    game.round.phaseEndsAt = now() + ROUND_START_DELAY_MS;
  }
};

const startRound = () => {
  if (getConnectedHumans().length < MIN_PLAYERS_TO_START) {
    game.round.phase = "waiting";
    game.round.phaseEndsAt = now() + ROUND_START_DELAY_MS;
    return;
  }

  game.bullets = [];
  game.round = {
    id: `round-${Date.now()}`,
    phase: "active",
    phaseEndsAt: now() + ZONE_TICK_MS,
    zone: resetRoundZone(),
    startedAt: now(),
    endedAt: 0,
    placements: [],
  };

  for (const player of getHumanPlayers()) resetActorForRound(player);
};

const resetToWaiting = () => {
  game.bullets = [];
  game.round = initialRoundState();
  for (const player of getHumanPlayers()) {
    player.alive = false;
    player.kills = 0;
    player.health = RESPAWN_HEALTH;
    player.weapon = defaultWeapon();
  }
};

const tryReload = (player, currentTime) => {
  if (player.weapon.ammo > 0) return;
  if (player.weapon.reserveAmmo <= 0) return;
  if (player.weapon.reloadingUntil > currentTime) return;
  player.weapon.reloadingUntil = currentTime + RELOAD_MS;
};

const completeReload = (player, currentTime) => {
  if (player.weapon.reloadingUntil === 0 || player.weapon.reloadingUntil > currentTime) return;
  const needed = CLIP_SIZE - player.weapon.ammo;
  const toLoad = Math.min(needed, player.weapon.reserveAmmo);
  player.weapon.ammo += toLoad;
  player.weapon.reserveAmmo -= toLoad;
  player.weapon.reloadingUntil = 0;
};

const fireBullet = (player, currentTime) => {
  if (!player.alive) return;
  if (player.weapon.reloadingUntil > currentTime) return;
  if (currentTime - player.weapon.lastShotAt < FIRE_COOLDOWN_MS) return;
  if (player.weapon.ammo <= 0) {
    tryReload(player, currentTime);
    return;
  }

  const aim = normalize(player.input.aimX - player.x, player.input.aimY - player.y);
  player.weapon.lastShotAt = currentTime;
  player.weapon.ammo -= 1;
  player.angle = Math.atan2(aim.y, aim.x);

  game.bullets.push({
    id: `${player.id}-${currentTime}-${Math.random().toString(36).slice(2, 6)}`,
    ownerId: player.id,
    x: player.x + aim.x * (PLAYER_RADIUS + 20),
    y: player.y + aim.y * (PLAYER_RADIUS + 20),
    previousX: player.x + aim.x * (PLAYER_RADIUS + 10),
    previousY: player.y + aim.y * (PLAYER_RADIUS + 10),
    vx: aim.x * BULLET_SPEED,
    vy: aim.y * BULLET_SPEED,
    damage: 24,
    expiresAt: currentTime + BULLET_LIFETIME_MS,
  });
};

const movePlayer = (player, dtSec) => {
  if (!player.alive) return;

  let moveX = 0;
  let moveY = 0;
  if (player.input.up) moveY -= 1;
  if (player.input.down) moveY += 1;
  if (player.input.left) moveX -= 1;
  if (player.input.right) moveX += 1;
  const next = normalize(moveX, moveY);
  const magnitude = moveX === 0 && moveY === 0 ? 0 : PLAYER_SPEED;
  player.vx = next.x * magnitude;
  player.vy = next.y * magnitude;
  player.angle = Math.atan2(player.input.aimY - player.y, player.input.aimX - player.x);

  player.x = clamp(player.x + player.vx * dtSec, PLAYER_RADIUS, WORLD_SIZE - PLAYER_RADIUS);
  player.y = clamp(player.y + player.vy * dtSec, PLAYER_RADIUS, WORLD_SIZE - PLAYER_RADIUS);
};

const applyZoneDamage = (player, dtSec) => {
  if (!player.alive || game.round.phase !== "active") return;
  const dist = distance(player.x, player.y, game.round.zone.x, game.round.zone.y);
  if (dist <= game.round.zone.radius) return;
  player.health -= ZONE_DAMAGE_PER_SECOND * dtSec;
  player.damageFlashAt = now();
  if (player.health <= 0) eliminatePlayer(player, null, "zone");
};

const updateZone = (currentTime) => {
  if (game.round.phase !== "active") return;

  if (currentTime >= game.round.zone.closesAt) {
    const nextRadius = Math.max(ZONE_MIN_RADIUS, game.round.zone.radius * ZONE_SHRINK_FACTOR);
    game.round.zone.radius = nextRadius;
    game.round.zone.targetRadius = nextRadius;
    game.round.zone.x = clamp(game.round.zone.x + rand(-80, 80), nextRadius, WORLD_SIZE - nextRadius);
    game.round.zone.y = clamp(game.round.zone.y + rand(-80, 80), nextRadius, WORLD_SIZE - nextRadius);
    game.round.zone.closesAt = currentTime + ZONE_TICK_MS;
    game.round.phaseEndsAt = game.round.zone.closesAt;
  }
};

const updateBullets = (dtSec, currentTime) => {
  const survivors = [];

  for (const bullet of game.bullets) {
    bullet.previousX = bullet.x;
    bullet.previousY = bullet.y;
    bullet.x += bullet.vx * dtSec;
    bullet.y += bullet.vy * dtSec;

    if (
      bullet.expiresAt < currentTime ||
      bullet.x < 0 ||
      bullet.x > WORLD_SIZE ||
      bullet.y < 0 ||
      bullet.y > WORLD_SIZE
    ) {
      continue;
    }

    let hit = false;
    for (const player of getHumanPlayers()) {
      if (!player.alive || player.id === bullet.ownerId) continue;
      if (distance(player.x, player.y, bullet.x, bullet.y) > PLAYER_RADIUS + 2) continue;
      player.health -= bullet.damage;
      player.damageFlashAt = currentTime;
      if (player.health <= 0) {
        eliminatePlayer(player, game.players.get(bullet.ownerId), "shot");
      }
      hit = true;
      break;
    }

    if (!hit) survivors.push(bullet);
  }

  game.bullets = survivors;
};

const snapshot = () => ({
  serverTime: now(),
  round: {
    id: game.round.id,
    phase: game.round.phase,
    phaseEndsAt: game.round.phaseEndsAt,
    startedAt: game.round.startedAt,
    zone: game.round.zone,
    playerCount: getConnectedHumans().length,
    aliveCount: getLivingActors().length,
  },
  entities: getHumanPlayers().map((player) => ({
    id: player.id,
    displayName: player.displayName,
    type: player.type,
    x: player.x,
    y: player.y,
    angle: player.angle,
    health: Math.max(0, Math.round(player.health)),
    alive: player.alive,
    kills: player.kills,
    ammo: player.weapon.ammo,
    reserveAmmo: player.weapon.reserveAmmo,
    reloadingUntil: player.weapon.reloadingUntil,
    damageFlashAt: player.damageFlashAt,
  })),
  bullets: game.bullets.map((bullet) => ({
    id: bullet.id,
    x: bullet.x,
    y: bullet.y,
    previousX: bullet.previousX,
    previousY: bullet.previousY,
  })),
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    res.setHeader("Access-Control-Allow-Origin", CLIENT_ORIGIN);
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/api/blaster/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/blaster/leaderboard") {
      const leaderboard = await fetchLeaderboard();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(leaderboard));
      return;
    }

    if (url.pathname.startsWith("/api/blaster/profile/")) {
      const playerId = decodeURIComponent(url.pathname.replace("/api/blaster/profile/", ""));
      const displayName = url.searchParams.get("name") || "Player";
      const profile = await fetchPlayerProfile(playerId, displayName);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(profile));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN === "*" ? true : CLIENT_ORIGIN,
  },
});

const finishRoundIfNeeded = async () => {
  if (game.round.phase !== "active") return;

  const living = getLivingActors();
  if (living.length > 1) return;

  if (living.length === 1) {
    const winner = living[0];
    game.round.placements.push({
      playerId: winner.id,
      displayName: winner.displayName,
      type: winner.type,
      placement: 1,
      kills: winner.kills,
      reason: "winner",
    });
    winner.alive = false;
  }

  const humanPlacements = game.round.placements
    .filter((entry) => entry.type === "human")
    .sort((a, b) => a.placement - b.placement);

  for (const entry of humanPlacements) {
    const player = game.players.get(entry.playerId);
    if (!player) continue;
    const placementIndex = entry.placement - 1;
    const creditsEarned = entry.placement <= 3 ? REWARD_BY_PLACE[placementIndex] + entry.kills * 12 : 0;
    await upsertResult(player, entry.placement, creditsEarned);
  }

  const leaderboard = await fetchLeaderboard();
  game.round.phase = "ended";
  game.round.endedAt = now();
  game.round.phaseEndsAt = now() + ROUND_END_DELAY_MS;

  io.emit("roundEnded", {
    roundId: game.round.id,
    results: humanPlacements.map((entry) => ({
      playerId: entry.playerId,
      displayName: entry.displayName,
      placement: entry.placement,
      kills: entry.kills,
      creditsEarned: entry.placement <= 3 ? REWARD_BY_PLACE[entry.placement - 1] + entry.kills * 12 : 0,
    })),
    leaderboard,
  });

  const humanIds = new Set(humanPlacements.map((entry) => entry.playerId));
  for (const [socketId, playerId] of game.sockets.entries()) {
    if (!humanIds.has(playerId)) continue;
    const profile = await fetchPlayerProfile(playerId);
    io.to(socketId).emit("profile", profile);
  }
};

io.on("connection", async (socket) => {
  const rawPlayerId = `${socket.handshake.auth?.playerId || ""}`.trim();
  const displayName = sanitizeName(socket.handshake.auth?.displayName, "Player");

  if (!rawPlayerId || rawPlayerId.length < 6) {
    socket.emit("fatal", { message: "Missing player identity." });
    socket.disconnect(true);
    return;
  }

  const playerId = rawPlayerId.slice(0, 64);
  await ensurePlayerProfile(playerId, displayName);

  if (!game.players.has(playerId) && game.players.size >= MAX_PLAYERS) {
    socket.emit("fatal", { message: "Match server is full." });
    socket.disconnect(true);
    return;
  }

  let player = game.players.get(playerId);
  if (!player) {
    player = createHumanState({ socketId: socket.id, playerId, displayName });
    game.players.set(playerId, player);
  }

  player.socketId = socket.id;
  player.displayName = displayName;
  player.lastSeenAt = now();
  game.sockets.set(socket.id, playerId);

  socket.emit("profile", await fetchPlayerProfile(playerId, displayName));
  socket.emit("snapshot", snapshot());

  maybeStartRound();

  socket.on("playerInput", (input) => {
    const currentPlayer = game.players.get(playerId);
    if (!currentPlayer) return;
    currentPlayer.lastSeenAt = now();
    currentPlayer.input = {
      up: !!input?.up,
      down: !!input?.down,
      left: !!input?.left,
      right: !!input?.right,
      firing: !!input?.firing,
      aimX: clamp(Number(input?.aimX) || currentPlayer.x, 0, WORLD_SIZE),
      aimY: clamp(Number(input?.aimY) || currentPlayer.y, 0, WORLD_SIZE),
    };
  });

  socket.on("disconnect", () => {
    game.sockets.delete(socket.id);
    const currentPlayer = game.players.get(playerId);
    if (!currentPlayer) return;
    currentPlayer.socketId = null;
    currentPlayer.input.firing = false;

    if (game.round.phase !== "active") maybeStartRound();

    setTimeout(() => {
      const latestPlayer = game.players.get(playerId);
      if (!latestPlayer || latestPlayer.socketId) return;
      game.players.delete(playerId);
      if (getHumanPlayers().length === 0) resetToWaiting();
      else if (game.round.phase !== "active") maybeStartRound();
    }, 45000);
  });
});

setInterval(async () => {
  const currentTime = now();
  const dtSec = Math.min(0.05, (currentTime - game.lastTickAt) / 1000);
  game.lastTickAt = currentTime;

  if (game.round.phase === "starting" && currentTime >= game.round.phaseEndsAt) {
    startRound();
  } else if (game.round.phase === "ended" && currentTime >= game.round.phaseEndsAt) {
    resetToWaiting();
    maybeStartRound();
  } else if (game.round.phase === "waiting") {
    maybeStartRound();
  }

  for (const player of getHumanPlayers()) {
    if (!player.alive) continue;
    completeReload(player, currentTime);
    movePlayer(player, dtSec);
    if (player.input.firing) fireBullet(player, currentTime);
    else if (player.weapon.ammo === 0) tryReload(player, currentTime);
    applyZoneDamage(player, dtSec);
  }

  updateZone(currentTime);
  updateBullets(dtSec, currentTime);
  await finishRoundIfNeeded();

  if (currentTime - game.lastSnapshotAt >= 1000 / SNAPSHOT_RATE) {
    game.lastSnapshotAt = currentTime;
    io.emit("snapshot", snapshot());
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Blaster arcade server listening on :${PORT}`);
});


