import React, { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { isCoarsePointer, setupHiDPICanvas } from "@/pages/arcade/lib/canvas";
import { AlertTriangle, Coins, Crosshair, Crown, Expand, LoaderCircle, Minimize, Radar, ShieldAlert, Smartphone, Swords, Trophy } from "lucide-react";

type Profile = {
  player_id: string;
  display_name: string;
  credits: number;
  wins: number;
  kills: number;
  matches: number;
};

type LeaderboardRow = Profile;

type SnapshotEntity = {
  id: string;
  displayName: string;
  type: "human" | "bot";
  x: number;
  y: number;
  angle: number;
  health: number;
  alive: boolean;
  kills: number;
  ammo: number;
  reserveAmmo: number;
  reloadingUntil: number;
  damageFlashAt: number;
};

type Snapshot = {
  serverTime: number;
  round: {
    id: string;
    phase: "waiting" | "starting" | "active" | "ended";
    phaseEndsAt: number;
    startedAt: number;
    zone: {
      x: number;
      y: number;
      radius: number;
      targetRadius: number;
      closesAt: number;
    };
    playerCount: number;
    aliveCount: number;
  };
  entities: SnapshotEntity[];
  bullets: Array<{ id: string; x: number; y: number; previousX: number; previousY: number }>;
};

type RoundResult = {
  playerId: string;
  displayName: string;
  placement: number;
  kills: number;
  creditsEarned: number;
};

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  firing: boolean;
  aimX: number;
  aimY: number;
};

type VisualEntity = SnapshotEntity;

type TouchStickState = {
  active: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
};

const MAP_SIZE = 2200;
const TOUCH_STICK_RADIUS = 54;
const EMPTY_STICK: TouchStickState = { active: false, pointerId: null, startX: 0, startY: 0, x: 0, y: 0 };
const SERVER_URL = import.meta.env.VITE_BLASTER_SERVER_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalize = (x: number, y: number) => {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
};

const getNameFromUser = (user: any) =>
  `${user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "Player"}`
    .trim()
    .slice(0, 20);

const formatPhase = (phase: Snapshot["round"]["phase"]) => {
  if (phase === "waiting") return "Waiting for players";
  if (phase === "starting") return "Drop countdown";
  if (phase === "active") return "Zone closing";
  return "Round complete";
};

const fetchJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
};

const drawRoundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

export const BlasterRoyalePanel: React.FC = () => {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const animationRef = useRef<number | null>(null);
  const visualsRef = useRef<Map<string, VisualEntity>>(new Map());
  const inputRef = useRef<InputState>({ up: false, down: false, left: false, right: false, firing: false, aimX: MAP_SIZE / 2, aimY: MAP_SIZE / 2 });
  const latestSnapshotRef = useRef<Snapshot | null>(null);
  const hitFlashRef = useRef(0);
  const recoilRef = useRef({ x: 0, y: 0 });
  const leftStickRef = useRef<TouchStickState>({ ...EMPTY_STICK });
  const rightStickRef = useRef<TouchStickState>({ ...EMPTY_STICK });

  const [profile, setProfile] = useState<Profile | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "offline">("connecting");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isTouchMode, setIsTouchMode] = useState<boolean>(() => isCoarsePointer());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [touchUi, setTouchUi] = useState({ left: { ...EMPTY_STICK }, right: { ...EMPTY_STICK } });

  const selfId = user?.id || "";
  const selfName = useMemo(() => getNameFromUser(user), [user]);

  const emitInput = () => {
    socketRef.current?.emit("playerInput", inputRef.current);
  };

  const getCurrentSelf = () => latestSnapshotRef.current?.entities.find((entity) => entity.id === selfId) || null;

  const syncTouchUi = () => {
    setTouchUi({ left: { ...leftStickRef.current }, right: { ...rightStickRef.current } });
  };

  const clearMovementStick = () => {
    inputRef.current.left = false;
    inputRef.current.right = false;
    inputRef.current.up = false;
    inputRef.current.down = false;
  };

  const applyMovementStick = (dx: number, dy: number) => {
    const threshold = 0.24;
    inputRef.current.left = dx < -threshold;
    inputRef.current.right = dx > threshold;
    inputRef.current.up = dy < -threshold;
    inputRef.current.down = dy > threshold;
  };

  const clearAimStick = () => {
    inputRef.current.firing = false;
  };

  const applyAimStick = (dx: number, dy: number) => {
    const self = getCurrentSelf();
    if (!self) return;
    const aim = normalize(dx, dy);
    inputRef.current.aimX = self.x + aim.x * 340;
    inputRef.current.aimY = self.y + aim.y * 340;
    inputRef.current.firing = Math.hypot(dx, dy) > 0.2;
  };

  const beginStick = (stick: React.MutableRefObject<TouchStickState>, pointerId: number, x: number, y: number) => {
    stick.current = { active: true, pointerId, startX: x, startY: y, x, y };
    syncTouchUi();
  };

  const moveStick = (stick: React.MutableRefObject<TouchStickState>, x: number, y: number) => {
    const dx = x - stick.current.startX;
    const dy = y - stick.current.startY;
    const distance = Math.hypot(dx, dy);
    const ratio = distance > TOUCH_STICK_RADIUS ? TOUCH_STICK_RADIUS / distance : 1;
    stick.current.x = stick.current.startX + dx * ratio;
    stick.current.y = stick.current.startY + dy * ratio;
    syncTouchUi();
    return { dx: (stick.current.x - stick.current.startX) / TOUCH_STICK_RADIUS, dy: (stick.current.y - stick.current.startY) / TOUCH_STICK_RADIUS };
  };

  const endStick = (stick: React.MutableRefObject<TouchStickState>) => {
    stick.current = { ...EMPTY_STICK };
    syncTouchUi();
  };

  const refreshSummary = async () => {
    if (!selfId) return;
    try {
      const [nextProfile, nextLeaderboard] = await Promise.all([
        fetchJson<Profile>(`${SERVER_URL}/api/blaster/profile/${encodeURIComponent(selfId)}?name=${encodeURIComponent(selfName)}`),
        fetchJson<LeaderboardRow[]>(`${SERVER_URL}/api/blaster/leaderboard`),
      ]);
      setProfile(nextProfile);
      setLeaderboard(nextLeaderboard);
    } catch (error: any) {
      setErrorText(error?.message || "Failed to load arcade server data.");
    }
  };

  const toggleFullscreen = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch (error: any) {
      setErrorText(error?.message || "Fullscreen request failed.");
    }
  };

  useEffect(() => {
    const syncFlags = () => {
      setIsTouchMode(isCoarsePointer() || window.innerWidth < 900);
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    };

    syncFlags();
    window.addEventListener("resize", syncFlags);
    document.addEventListener("fullscreenchange", syncFlags);
    return () => {
      window.removeEventListener("resize", syncFlags);
      document.removeEventListener("fullscreenchange", syncFlags);
    };
  }, []);

  useEffect(() => {
    if (!selfId) return undefined;

    setConnectionState("connecting");
    setErrorText(null);
    void refreshSummary();

    const socket = io(SERVER_URL, {
      transports: ["websocket", "polling"],
      auth: { playerId: selfId, displayName: selfName },
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnectionState("connected");
      setErrorText(null);
    });

    socket.on("disconnect", () => {
      setConnectionState("offline");
    });

    socket.on("fatal", (payload) => {
      setConnectionState("offline");
      setErrorText(payload?.message || "Connection failed.");
    });

    socket.on("profile", (nextProfile: Profile) => {
      setProfile(nextProfile);
    });

    socket.on("snapshot", (nextSnapshot: Snapshot) => {
      const current = latestSnapshotRef.current;
      const prevSelf = current?.entities.find((entity) => entity.id === selfId);
      const nextSelf = nextSnapshot.entities.find((entity) => entity.id === selfId);

      if (prevSelf && nextSelf && nextSelf.health < prevSelf.health) hitFlashRef.current = 1;

      latestSnapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
    });

    socket.on("roundEnded", (payload: { results: RoundResult[]; leaderboard: LeaderboardRow[] }) => {
      setRoundResults(payload.results || []);
      setLeaderboard(payload.leaderboard || []);
      void refreshSummary();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [selfId, selfName]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return undefined;

    const { resize } = setupHiDPICanvas(canvas);

    const render = () => {
      const width = Math.max(320, Math.floor(container.clientWidth));
      const height = Math.max(360, Math.floor(isFullscreen ? window.innerHeight - 40 : Math.min(720, width * 0.7)));
      const { ctx } = resize(width, height);
      const currentSnapshot = latestSnapshotRef.current;
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = "#09131f";
      ctx.fillRect(0, 0, width, height);

      if (!currentSnapshot) {
        ctx.fillStyle = "#d7dee7";
        ctx.font = "600 18px sans-serif";
        ctx.fillText("Connecting to Blaster Royale...", 24, 38);
        animationRef.current = window.requestAnimationFrame(render);
        return;
      }

      for (const entity of currentSnapshot.entities) {
        const existing = visualsRef.current.get(entity.id);
        visualsRef.current.set(entity.id, existing ? {
          ...entity,
          x: existing.x + (entity.x - existing.x) * 0.34,
          y: existing.y + (entity.y - existing.y) * 0.34,
          angle: existing.angle + (entity.angle - existing.angle) * 0.4,
        } : { ...entity });
      }

      for (const key of [...visualsRef.current.keys()]) {
        if (!currentSnapshot.entities.find((entity) => entity.id === key)) visualsRef.current.delete(key);
      }

      const self = visualsRef.current.get(selfId) || currentSnapshot.entities.find((entity) => entity.id === selfId) || currentSnapshot.entities[0];
      const recoil = recoilRef.current;
      const cameraX = (self?.x || MAP_SIZE / 2) - width / 2 + recoil.x;
      const cameraY = (self?.y || MAP_SIZE / 2) - height / 2 + recoil.y;

      recoil.x *= 0.82;
      recoil.y *= 0.82;
      hitFlashRef.current *= 0.88;

      ctx.save();
      ctx.translate(-cameraX, -cameraY);

      const gridSize = 100;
      ctx.strokeStyle = "rgba(107, 134, 173, 0.15)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= MAP_SIZE; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, MAP_SIZE);
        ctx.stroke();
      }
      for (let y = 0; y <= MAP_SIZE; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(MAP_SIZE, y);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(10, 14, 22, 0.35)";
      ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

      ctx.beginPath();
      ctx.arc(currentSnapshot.round.zone.x, currentSnapshot.round.zone.y, currentSnapshot.round.zone.radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(74, 222, 128, 0.07)";
      ctx.fill();
      ctx.strokeStyle = "rgba(74, 222, 128, 0.6)";
      ctx.lineWidth = 5;
      ctx.stroke();

      ctx.beginPath();
      ctx.rect(-4000, -4000, 8000, 8000);
      ctx.arc(currentSnapshot.round.zone.x, currentSnapshot.round.zone.y, currentSnapshot.round.zone.radius, 0, Math.PI * 2, true);
      ctx.fillStyle = "rgba(220, 38, 38, 0.18)";
      ctx.fill("evenodd");

      currentSnapshot.bullets.forEach((bullet) => {
        ctx.strokeStyle = "rgba(255, 241, 118, 0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bullet.previousX, bullet.previousY);
        ctx.lineTo(bullet.x, bullet.y);
        ctx.stroke();
      });

      visualsRef.current.forEach((entity) => {
        if (!entity.alive && entity.id !== selfId) return;
        const teamColor = entity.id === selfId ? "#5eead4" : entity.type === "bot" ? "#fbbf24" : "#fb7185";
        const flash = Date.now() - entity.damageFlashAt < 120 ? 1 : 0;

        ctx.save();
        ctx.translate(entity.x, entity.y);
        ctx.rotate(entity.angle);
        ctx.fillStyle = flash ? "#fee2e2" : "#1f2937";
        drawRoundedRect(ctx, -8, -5, 24, 10, 3);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, Math.PI * 2);
        ctx.fillStyle = flash ? "#ffffff" : teamColor;
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = "rgba(10, 14, 22, 0.85)";
        drawRoundedRect(ctx, entity.x - 22, entity.y - 34, 44, 6, 3);
        ctx.fill();
        ctx.fillStyle = entity.id === selfId ? "#34d399" : "#f87171";
        drawRoundedRect(ctx, entity.x - 22, entity.y - 34, Math.max(0, 44 * (entity.health / 100)), 6, 3);
        ctx.fill();
        ctx.fillStyle = "#f8fafc";
        ctx.font = isTouchMode ? "700 12px sans-serif" : "600 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(entity.displayName, entity.x, entity.y - 42);
      });

      ctx.restore();

      const hudWidth = isTouchMode ? 274 : 250;
      ctx.fillStyle = "rgba(8, 15, 26, 0.74)";
      drawRoundedRect(ctx, 16, 16, hudWidth, 96, 16);
      ctx.fill();

      const phaseMs = Math.max(0, currentSnapshot.round.phaseEndsAt - Date.now());
      const seconds = (phaseMs / 1000).toFixed(1);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 18px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Blaster Royale", 30, 42);
      ctx.font = "500 12px sans-serif";
      ctx.fillStyle = "#b8c4d3";
      ctx.fillText(`${formatPhase(currentSnapshot.round.phase)}  |  ${seconds}s`, 30, 62);
      ctx.fillText(`Alive: ${currentSnapshot.round.aliveCount}  |  Humans: ${currentSnapshot.round.playerCount}`, 30, 80);
      if (self) ctx.fillText(`Ammo: ${self.ammo}/${self.reserveAmmo}  |  Kills: ${self.kills}`, 30, 98);

      if (hitFlashRef.current > 0.05) {
        ctx.fillStyle = `rgba(255, 69, 58, ${0.28 * hitFlashRef.current})`;
        ctx.fillRect(0, 0, width, height);
      }

      animationRef.current = window.requestAnimationFrame(render);
    };

    render();
    const onResize = () => render();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
    };
  }, [selfId, isFullscreen, isTouchMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key.toLowerCase() === "w") inputRef.current.up = true;
      if (event.key.toLowerCase() === "s") inputRef.current.down = true;
      if (event.key.toLowerCase() === "a") inputRef.current.left = true;
      if (event.key.toLowerCase() === "d") inputRef.current.right = true;
      emitInput();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "w") inputRef.current.up = false;
      if (event.key.toLowerCase() === "s") inputRef.current.down = false;
      if (event.key.toLowerCase() === "a") inputRef.current.left = false;
      if (event.key.toLowerCase() === "d") inputRef.current.right = false;
      emitInput();
    };

    const onMouseDown = () => {
      if (isTouchMode) return;
      inputRef.current.firing = true;
      recoilRef.current.x = (Math.random() - 0.5) * 12;
      recoilRef.current.y = (Math.random() - 0.5) * 12;
      emitInput();
    };

    const onMouseUp = () => {
      if (isTouchMode) return;
      inputRef.current.firing = false;
      emitInput();
    };

    const onMouseMove = (event: MouseEvent) => {
      if (isTouchMode) return;
      const canvas = canvasRef.current;
      const currentSnapshot = latestSnapshotRef.current;
      if (!canvas || !currentSnapshot) return;
      const rect = canvas.getBoundingClientRect();
      const self = currentSnapshot.entities.find((entity) => entity.id === selfId);
      if (!self) return;
      const cameraX = self.x - rect.width / 2;
      const cameraY = self.y - rect.height / 2;
      inputRef.current.aimX = cameraX + (event.clientX - rect.left);
      inputRef.current.aimY = cameraY + (event.clientY - rect.top);
      emitInput();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, [selfId, isTouchMode]);

  const handleMoveTouchStart: React.TouchEventHandler<HTMLDivElement> = (event) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    beginStick(leftStickRef, touch.identifier, touch.clientX, touch.clientY);
    clearMovementStick();
    emitInput();
  };

  const handleMoveTouchMove: React.TouchEventHandler<HTMLDivElement> = (event) => {
    const touch = [...event.changedTouches].find((entry) => entry.identifier === leftStickRef.current.pointerId);
    if (!touch) return;
    const next = moveStick(leftStickRef, touch.clientX, touch.clientY);
    applyMovementStick(next.dx, next.dy);
    emitInput();
  };

  const handleMoveTouchEnd: React.TouchEventHandler<HTMLDivElement> = (event) => {
    const touch = [...event.changedTouches].find((entry) => entry.identifier === leftStickRef.current.pointerId);
    if (!touch) return;
    endStick(leftStickRef);
    clearMovementStick();
    emitInput();
  };

  const handleAimTouchStart: React.TouchEventHandler<HTMLDivElement> = (event) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    beginStick(rightStickRef, touch.identifier, touch.clientX, touch.clientY);
    inputRef.current.firing = false;
    emitInput();
  };

  const handleAimTouchMove: React.TouchEventHandler<HTMLDivElement> = (event) => {
    const touch = [...event.changedTouches].find((entry) => entry.identifier === rightStickRef.current.pointerId);
    if (!touch) return;
    const next = moveStick(rightStickRef, touch.clientX, touch.clientY);
    applyAimStick(next.dx, next.dy);
    recoilRef.current.x = (Math.random() - 0.5) * 7;
    recoilRef.current.y = (Math.random() - 0.5) * 7;
    emitInput();
  };

  const handleAimTouchEnd: React.TouchEventHandler<HTMLDivElement> = (event) => {
    const touch = [...event.changedTouches].find((entry) => entry.identifier === rightStickRef.current.pointerId);
    if (!touch) return;
    endStick(rightStickRef);
    clearAimStick();
    emitInput();
  };

  const containerRect = containerRef.current?.getBoundingClientRect();
  const selfEntity = snapshot?.entities.find((entity) => entity.id === selfId);
  const yourPlacement = roundResults.find((result) => result.playerId === selfId);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_380px] gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crosshair className="h-5 w-5" />
            Blaster Royale
          </CardTitle>
          <CardDescription>
            {isTouchMode
              ? "Twin-stick mobile controls are enabled. Left thumb moves, right thumb aims and fires."
              : "Lightweight top-down battle royale. WASD moves, mouse aims, hold click to fire."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            ref={stageRef}
            className={[
              "rounded-2xl border border-border/70 bg-slate-950/80 p-2",
              isFullscreen ? "fixed inset-3 z-[120] p-3 bg-slate-950" : "relative",
            ].join(" ")}
          >
            <div ref={containerRef} className="relative overflow-hidden rounded-xl">
              <canvas ref={canvasRef} className="w-full rounded-xl border border-slate-800 bg-slate-950" />

              {isTouchMode ? (
                <>
                  <div
                    className="absolute inset-y-0 left-0 w-1/2 touch-none"
                    onTouchStart={handleMoveTouchStart}
                    onTouchMove={handleMoveTouchMove}
                    onTouchEnd={handleMoveTouchEnd}
                    onTouchCancel={handleMoveTouchEnd}
                  />
                  <div
                    className="absolute inset-y-0 right-0 w-1/2 touch-none"
                    onTouchStart={handleAimTouchStart}
                    onTouchMove={handleAimTouchMove}
                    onTouchEnd={handleAimTouchEnd}
                    onTouchCancel={handleAimTouchEnd}
                  />

                  {touchUi.left.active ? (
                    <>
                      <div
                        className="pointer-events-none absolute h-24 w-24 rounded-full border border-white/25 bg-black/20"
                        style={{
                          left: touchUi.left.startX - 48 - (containerRect?.left || 0),
                          top: touchUi.left.startY - 48 - (containerRect?.top || 0),
                        }}
                      />
                      <div
                        className="pointer-events-none absolute h-11 w-11 rounded-full bg-white/35 ring-2 ring-white/30"
                        style={{
                          left: touchUi.left.x - 22 - (containerRect?.left || 0),
                          top: touchUi.left.y - 22 - (containerRect?.top || 0),
                        }}
                      />
                    </>
                  ) : null}

                  {touchUi.right.active ? (
                    <>
                      <div
                        className="pointer-events-none absolute h-24 w-24 rounded-full border border-emerald-300/30 bg-emerald-400/10"
                        style={{
                          left: touchUi.right.startX - 48 - (containerRect?.left || 0),
                          top: touchUi.right.startY - 48 - (containerRect?.top || 0),
                        }}
                      />
                      <div
                        className="pointer-events-none absolute h-11 w-11 rounded-full bg-emerald-300/35 ring-2 ring-emerald-200/40"
                        style={{
                          left: touchUi.right.x - 22 - (containerRect?.left || 0),
                          top: touchUi.right.y - 22 - (containerRect?.top || 0),
                        }}
                      />
                    </>
                  ) : null}

                  <div className="pointer-events-none absolute bottom-4 left-4 rounded-full border border-white/10 bg-slate-950/70 px-3 py-2 text-[11px] text-white/80">
                    Move
                  </div>
                  <div className="pointer-events-none absolute bottom-4 right-4 rounded-full border border-emerald-300/20 bg-slate-950/70 px-3 py-2 text-[11px] text-emerald-100">
                    Aim / Fire
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-card/70 p-3">
              <div className="text-xs text-muted-foreground">Connection</div>
              <div className="mt-1 font-semibold capitalize">{connectionState}</div>
            </div>
            <div className="rounded-xl border border-border bg-card/70 p-3">
              <div className="text-xs text-muted-foreground">Health</div>
              <div className="mt-1 font-semibold">{selfEntity?.health ?? 0}</div>
            </div>
            <div className="rounded-xl border border-border bg-card/70 p-3">
              <div className="text-xs text-muted-foreground">Ammo</div>
              <div className="mt-1 font-semibold">{selfEntity ? `${selfEntity.ammo}/${selfEntity.reserveAmmo}` : "0/0"}</div>
            </div>
            <div className="rounded-xl border border-border bg-card/70 p-3">
              <div className="text-xs text-muted-foreground">Round State</div>
              <div className="mt-1 font-semibold">{snapshot ? formatPhase(snapshot.round.phase) : "Syncing"}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => socketRef.current?.connect()}>
              Reconnect
            </Button>
            <Button variant="outline" onClick={() => void refreshSummary()}>
              Refresh Stats
            </Button>
            <Button variant="outline" onClick={() => void toggleFullscreen()}>
              {isFullscreen ? <Minimize className="h-4 w-4 mr-2" /> : <Expand className="h-4 w-4 mr-2" />}
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground flex items-start gap-2">
            <Smartphone className="h-4 w-4 mt-0.5 text-cyan-400" />
            <span>
              {isTouchMode
                ? "Mobile mode active. Use both thumbs on the game area. Fullscreen works on supported mobile and desktop browsers."
                : "Desktop mode active. You can still use the fullscreen button for a larger play area."}
            </span>
          </div>

          {errorText ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {errorText}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              Credits
            </CardTitle>
            <CardDescription>Stored in SQLite and awarded to top finishers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!profile ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <div className="text-3xl font-bold">{profile.credits}</div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-xs text-muted-foreground">Wins</div>
                    <div className="mt-1 font-semibold">{profile.wins}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-xs text-muted-foreground">Kills</div>
                    <div className="mt-1 font-semibold">{profile.kills}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-xs text-muted-foreground">Matches</div>
                    <div className="mt-1 font-semibold">{profile.matches}</div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Leaderboard
            </CardTitle>
            <CardDescription>Top players by arcade credits.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {leaderboard.length === 0 ? (
              <div className="text-sm text-muted-foreground">No leaderboard data yet.</div>
            ) : (
              leaderboard.map((row, index) => (
                <div key={row.player_id} className="rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{index + 1}. {row.display_name}</div>
                    <div className="text-xs text-muted-foreground">{row.wins} wins | {row.kills} kills</div>
                  </div>
                  <Badge variant="secondary">{row.credits} cr</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5" />
              Match Rewards
            </CardTitle>
            <CardDescription>Top players are paid automatically when a round ends.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <span>1st place</span>
              <span className="font-semibold">120 + 12 per kill</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <span>2nd place</span>
              <span className="font-semibold">70 + 12 per kill</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <span>3rd place</span>
              <span className="font-semibold">35 + 12 per kill</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radar className="h-5 w-5" />
              Round Results
            </CardTitle>
            <CardDescription>Latest placements from the current server.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {yourPlacement ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                You finished #{yourPlacement.placement} and earned {yourPlacement.creditsEarned} credits.
              </div>
            ) : null}
            {roundResults.length === 0 ? (
              <div className="text-sm text-muted-foreground">Finish a round to populate the latest results.</div>
            ) : (
              roundResults.map((row) => (
                <div key={`${row.playerId}-${row.placement}`} className="rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                  <div>
                    <div className="font-medium">#{row.placement} {row.displayName}</div>
                    <div className="text-xs text-muted-foreground">{row.kills} kills</div>
                  </div>
                  <Badge>{row.creditsEarned} cr</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Read</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 mt-0.5 text-amber-400" />
              Stay inside the safe zone. Outside damage ramps pressure quickly.
            </div>
            <div className="flex items-start gap-2">
              <Swords className="h-4 w-4 mt-0.5 text-rose-400" />
              Matches now wait for at least two real players before the round can start.
            </div>
            <div className="flex items-start gap-2">
              <LoaderCircle className="h-4 w-4 mt-0.5 text-cyan-400" />
              Reloading is automatic when your magazine hits zero.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

