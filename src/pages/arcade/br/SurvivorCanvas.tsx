import React, { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getArcadeSurvivorServerBaseUrl } from "@/pages/arcade/br/api";
import type { SurvivorSnapshot } from "@/pages/arcade/br/types";

type SurvivorCanvasProps = {
  userId: string;
  displayName: string;
  onRoundSettled?: () => void;
};

type RenderPlayer = {
  x: number;
  y: number;
  angle: number;
  hp: number;
};

const WORLD_PADDING = 160;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

const formatCountdown = (ms: number) => `${Math.max(1, Math.ceil(ms / 1000))}s`;

const fitCanvas = (canvas: HTMLCanvasElement) => {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
};

const colorForPlayer = (userId: string, selfId: string) => {
  if (userId === selfId) return "#ffe08a";
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  const palette = ["#73d2de", "#f4a261", "#ff6b6b", "#7bd389", "#c3bef0"];
  return palette[hash % palette.length];
};

const drawRoundedBar = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  background: string,
  value: number,
) => {
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, width * clamp(value, 0, 1), height, height / 2);
  ctx.fill();
};

export const SurvivorCanvas: React.FC<SurvivorCanvasProps> = ({ userId, displayName, onRoundSettled }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const animationRef = useRef<number | null>(null);
  const inputRef = useRef({
    up: false,
    down: false,
    left: false,
    right: false,
    fire: false,
    aimX: 0,
    aimY: 0,
  });
  const renderPlayersRef = useRef<Map<string, RenderPlayer>>(new Map());
  const snapshotRef = useRef<SurvivorSnapshot | null>(null);
  const recoilRef = useRef(0);
  const hitFlashRef = useRef(0);
  const lastAmmoRef = useRef<number | null>(null);
  const finishedRoomRef = useRef<string | null>(null);

  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<SurvivorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const self = useMemo(
    () => snapshot?.players.find((player) => player.userId === userId) || null,
    [snapshot, userId],
  );

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!self) return;

    if (self.recentlyHit) {
      hitFlashRef.current = 1;
    }

    if (lastAmmoRef.current !== null && self.ammo < lastAmmoRef.current) {
      recoilRef.current = Math.min(1.4, recoilRef.current + 0.9);
    }
    lastAmmoRef.current = self.ammo;
  }, [self]);

  useEffect(() => {
    if (snapshot?.status === "finished" && snapshot.roomId !== finishedRoomRef.current) {
      finishedRoomRef.current = snapshot.roomId;
      onRoundSettled?.();
    }
  }, [snapshot, onRoundSettled]);

  useEffect(() => {
    const socket = io(getArcadeSurvivorServerBaseUrl(), {
      transports: ["websocket", "polling"],
      path: "/socket.io/arcade-survivor",
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setError(null);
      socket.emit("arcade:join", { userId, displayName });
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("arcade:error", (payload: { message?: string }) => {
      setError(payload?.message || "Arcade server rejected the session.");
    });

    socket.on("arcade:snapshot", (nextSnapshot: SurvivorSnapshot) => {
      setSnapshot(nextSnapshot);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [displayName, userId]);

  useEffect(() => {
    const sendInput = () => {
      const socket = socketRef.current;
      if (!socket?.connected) return;
      socket.emit("arcade:input", inputRef.current);
    };

    const id = window.setInterval(sendInput, 50);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent, pressed: boolean) => {
      if (!focused && pressed) return;
      if (event.code === "KeyW" || event.code === "ArrowUp") inputRef.current.up = pressed;
      if (event.code === "KeyS" || event.code === "ArrowDown") inputRef.current.down = pressed;
      if (event.code === "KeyA" || event.code === "ArrowLeft") inputRef.current.left = pressed;
      if (event.code === "KeyD" || event.code === "ArrowRight") inputRef.current.right = pressed;
      if (event.code === "Space") {
        inputRef.current.fire = pressed;
        event.preventDefault();
      }
    };

    const down = (event: KeyboardEvent) => onKey(event, true);
    const up = (event: KeyboardEvent) => onKey(event, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [focused]);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      const snapshotValue = snapshotRef.current;
      if (!canvas) {
        animationRef.current = window.requestAnimationFrame(draw);
        return;
      }

      const ctx = fitCanvas(canvas);
      if (!ctx || !snapshotValue) {
        animationRef.current = window.requestAnimationFrame(draw);
        return;
      }

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const me = snapshotValue.players.find((player) => player.userId === userId) || snapshotValue.players[0];
      if (!me) {
        animationRef.current = window.requestAnimationFrame(draw);
        return;
      }

      recoilRef.current = Math.max(0, recoilRef.current * 0.86);
      hitFlashRef.current = Math.max(0, hitFlashRef.current * 0.92);

      const cameraX = clamp(me.x - width / 2, -WORLD_PADDING, snapshotValue.world.width - width + WORLD_PADDING);
      const cameraY = clamp(me.y - height / 2, -WORLD_PADDING, snapshotValue.world.height - height + WORLD_PADDING);

      ctx.clearRect(0, 0, width, height);

      const background = ctx.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, "#0f261f");
      background.addColorStop(1, "#081510");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(-cameraX, -cameraY);

      ctx.fillStyle = "#143326";
      ctx.fillRect(0, 0, snapshotValue.world.width, snapshotValue.world.height);

      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x < snapshotValue.world.width; x += 120) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, snapshotValue.world.height);
        ctx.stroke();
      }
      for (let y = 0; y < snapshotValue.world.height; y += 120) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(snapshotValue.world.width, y);
        ctx.stroke();
      }

      const zone = snapshotValue.world.zone;
      ctx.fillStyle = "rgba(201, 41, 56, 0.08)";
      ctx.fillRect(0, 0, snapshotValue.world.width, snapshotValue.world.height);
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(zone.center.x, zone.center.y, zone.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "rgba(255, 205, 96, 0.95)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(zone.center.x, zone.center.y, zone.radius, 0, Math.PI * 2);
      ctx.stroke();

      for (const obstacle of snapshotValue.world.obstacles) {
        const rock = ctx.createRadialGradient(obstacle.x - 10, obstacle.y - 12, 8, obstacle.x, obstacle.y, obstacle.r);
        rock.addColorStop(0, "#61796d");
        rock.addColorStop(1, "#33453d");
        ctx.fillStyle = rock;
        ctx.beginPath();
        ctx.arc(obstacle.x, obstacle.y, obstacle.r, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const trail of snapshotValue.trails) {
        const age = Math.max(0, Date.now() - trail.createdAt);
        const alpha = clamp(1 - age / 220, 0, 1);
        ctx.strokeStyle = `rgba(255, 244, 176, ${alpha})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(trail.start.x, trail.start.y);
        ctx.lineTo(trail.end.x, trail.end.y);
        ctx.stroke();
      }

      const renderPlayers = renderPlayersRef.current;
      for (const player of snapshotValue.players) {
        const existing = renderPlayers.get(player.userId) || {
          x: player.x,
          y: player.y,
          angle: player.angle,
          hp: player.hp,
        };
        existing.x = lerp(existing.x, player.x, 0.34);
        existing.y = lerp(existing.y, player.y, 0.34);
        existing.angle = lerp(existing.angle, player.angle, 0.3);
        existing.hp = lerp(existing.hp, player.hp, 0.2);
        renderPlayers.set(player.userId, existing);

        ctx.save();
        ctx.translate(existing.x, existing.y);
        const tint = colorForPlayer(player.userId, userId);
        ctx.fillStyle = player.recentlyHit ? "#fff4c2" : tint;
        ctx.shadowColor = tint;
        ctx.shadowBlur = player.userId === userId ? 18 : 10;
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, Math.PI * 2);
        ctx.fill();

        ctx.rotate(existing.angle);
        ctx.fillStyle = "#f5f1d6";
        ctx.fillRect(-2, -4, 30, 8);
        ctx.restore();

        drawRoundedBar(ctx, existing.x - 22, existing.y - 34, 44, 6, "#89f0a8", "rgba(0,0,0,0.35)", existing.hp / 100);
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.font = "11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(player.userId === userId ? "YOU" : player.displayName.toUpperCase(), existing.x, existing.y - 42);

        if (!player.alive) {
          ctx.strokeStyle = "rgba(255, 96, 96, 0.9)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(existing.x - 14, existing.y - 14);
          ctx.lineTo(existing.x + 14, existing.y + 14);
          ctx.moveTo(existing.x + 14, existing.y - 14);
          ctx.lineTo(existing.x - 14, existing.y + 14);
          ctx.stroke();
        }
      }

      ctx.restore();

      if (hitFlashRef.current > 0.01) {
        ctx.fillStyle = `rgba(255, 94, 94, ${hitFlashRef.current * 0.25})`;
        ctx.fillRect(0, 0, width, height);
      }

      if (recoilRef.current > 0.01) {
        const kick = recoilRef.current * 8;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(width / 2 - 8, height / 2 + kick);
        ctx.lineTo(width / 2 + 8, height / 2 + kick);
        ctx.moveTo(width / 2, height / 2 - 8 + kick);
        ctx.lineTo(width / 2, height / 2 + 8 + kick);
        ctx.stroke();
      }

      animationRef.current = window.requestAnimationFrame(draw);
    };

    animationRef.current = window.requestAnimationFrame(draw);
    return () => {
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
    };
  }, [userId]);

  const updateAim = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const currentSnapshot = snapshotRef.current;
    if (!canvas || !currentSnapshot) return;
    const me = currentSnapshot.players.find((player) => player.userId === userId);
    if (!me) return;
    const rect = canvas.getBoundingClientRect();
    const worldX = me.x - rect.width / 2 + (clientX - rect.left);
    const worldY = me.y - rect.height / 2 + (clientY - rect.top);
    inputRef.current.aimX = worldX;
    inputRef.current.aimY = worldY;
  };

  const statusLabel =
    !snapshot ? "Connecting"
    : snapshot.status === "waiting" ? "Lobby"
    : snapshot.status === "live" ? "Combat"
    : "Round Ended";

  const overlayMessage =
    error ||
    (!connected ? "Connecting to arcade server..." : null) ||
    (snapshot?.status === "waiting" ? `Drop opens in ${formatCountdown(snapshot.countdownMs)}` : null) ||
    (self && !self.alive ? `Eliminated at #${self.placement}` : null) ||
    (snapshot?.status === "finished" && self?.placement === 1 ? "Winner winner." : null) ||
    (snapshot?.status === "finished" ? "Round settled. Queueing the next drop..." : null) ||
    null;

  return (
    <Card className="overflow-hidden border-border/70 bg-black/20">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{statusLabel}</Badge>
          <Badge variant="outline">{connected ? "Socket Online" : "Socket Offline"}</Badge>
          <Badge variant="outline">Players {snapshot?.players.length ?? 0}</Badge>
          <Badge variant="outline">Alive {snapshot?.aliveCount ?? 0}</Badge>
          <Badge variant="outline">Kills {self?.kills ?? 0}</Badge>
          <Badge variant="outline">Ammo {self?.ammo ?? 0}</Badge>
        </div>

        <div
          className="relative overflow-hidden rounded-2xl border border-amber-200/10 bg-[#07110d]"
        >
          <canvas
            ref={canvasRef}
            className="block h-[540px] w-full cursor-crosshair bg-transparent"
            onMouseEnter={() => setFocused(true)}
            onMouseLeave={() => {
              setFocused(false);
              inputRef.current.up = false;
              inputRef.current.down = false;
              inputRef.current.left = false;
              inputRef.current.right = false;
              inputRef.current.fire = false;
            }}
            onMouseMove={(event) => updateAim(event.clientX, event.clientY)}
            onMouseDown={(event) => {
              updateAim(event.clientX, event.clientY);
              setFocused(true);
              inputRef.current.fire = true;
            }}
            onMouseUp={() => {
              inputRef.current.fire = false;
            }}
          />

          <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-xs text-white/85 shadow-2xl">
            <div>Move: `WASD` / Arrows</div>
            <div>Aim + shoot: mouse / hold click</div>
            <div>Stay inside the circle or the zone burns HP</div>
          </div>

          {overlayMessage ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/34">
              <div className="rounded-2xl border border-white/10 bg-black/60 px-5 py-4 text-center text-sm text-white shadow-2xl">
                {overlayMessage}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs uppercase tracking-[0.22em] text-white/45">Vital</div>
            <div className="mt-2 text-2xl font-semibold text-white">{Math.round(self?.hp ?? 0)}</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-300 transition-[width] duration-150"
                style={{ width: `${clamp(self?.hp ?? 0, 0, 100)}%` }}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs uppercase tracking-[0.22em] text-white/45">Placement</div>
            <div className="mt-2 text-2xl font-semibold text-white">
              {self?.placement ? `#${self.placement}` : "--"}
            </div>
            <div className="mt-1 text-xs text-white/55">Shrinking zone rewards survival positioning.</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs uppercase tracking-[0.22em] text-white/45">Focus</div>
            <div className="mt-2 text-2xl font-semibold text-white">{focused ? "Armed" : "Click In"}</div>
            <div className="mt-1 text-xs text-white/55">Keyboard input is active while the arena is focused.</div>
          </div>
        </div>

        {snapshot?.standings?.length ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Live leaderboard</div>
              <Button
                variant="outline"
                size="sm"
                className="border-white/15 bg-transparent text-white hover:bg-white/10"
                onClick={() => onRoundSettled?.()}
              >
                Refresh Rewards
              </Button>
            </div>
            <div className="space-y-2">
              {snapshot.standings.map((entry) => (
                <div
                  key={`${entry.userId}-${entry.rank}`}
                  className="flex items-center justify-between rounded-xl border border-white/6 bg-black/20 px-3 py-2 text-sm text-white/85"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-white/45">{entry.rank}</span>
                    <span>{entry.displayName}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-white/55">
                    <span>{entry.kills} KO</span>
                    <span>{entry.alive ? "alive" : `#${entry.placement}`}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default SurvivorCanvas;
