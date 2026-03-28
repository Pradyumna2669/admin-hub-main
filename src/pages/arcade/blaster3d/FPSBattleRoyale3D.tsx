import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { io, type Socket } from "socket.io-client";
import { Link } from "react-router-dom";
import { ArrowLeft, Crosshair, Expand, Minimize, Volume2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { AudioManager } from "./AudioManager";
import { FPSCameraRig } from "./FPSCamera";
import { EMPTY_STICK, TOUCH_STICK_RADIUS, beginStick, moveStick, type StickState } from "./MobileControls";
import { SERVER_WORLD_SIZE, WORLD_CENTER, WORLD_SCALE, getMatchmakingState, worldDistanceToScene, worldToScene } from "./Matchmaking";
import { createPlayerVisual, updatePlayerVisual, type RemoteVisual } from "./Player3D";

type Profile = { player_id: string; display_name: string; credits: number; wins: number; kills: number; matches: number };
type LeaderboardRow = Profile;
type SnapshotEntity = {
  id: string; displayName: string; type: "human" | "bot"; x: number; y: number; angle: number; health: number;
  alive: boolean; kills: number; ammo: number; reserveAmmo: number; reloadingUntil: number; damageFlashAt: number;
};
type Snapshot = {
  serverTime: number;
  round: {
    id: string; phase: "waiting" | "starting" | "active" | "ended"; phaseEndsAt: number; startedAt: number;
    zone: { x: number; y: number; radius: number; targetRadius: number; closesAt: number };
    playerCount: number; aliveCount: number;
  };
  entities: SnapshotEntity[];
  bullets: Array<{ id: string; x: number; y: number; previousX: number; previousY: number }>;
};
type RoundResult = { playerId: string; displayName: string; placement: number; kills: number; creditsEarned: number };
type InputState = { up: boolean; down: boolean; left: boolean; right: boolean; firing: boolean; aimX: number; aimY: number };
type TouchUi = { left: StickState; right: StickState };
type LocalMoveState = { forward: number; strafe: number };

const SERVER_URL = import.meta.env.VITE_BLASTER_SERVER_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");
const PLAYER_EYE_HEIGHT = 1.58;
const CAMERA_SENSITIVITY = 0.0022;
const BULLET_HEIGHT = 1.1;

const getNameFromUser = (user: any) =>
  `${user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "Player"}`.trim().slice(0, 20);

const fetchJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
};

const addBox = (group: THREE.Group, pos: [number, number, number], size: [number, number, number], color: number) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshLambertMaterial({ color }));
  mesh.position.set(...pos);
  group.add(mesh);
};

const makeWeaponMesh = () => {
  const group = new THREE.Group();
  addBox(group, [0.04, -0.02, -0.18], [0.16, 0.16, 0.9], 0x161f2c);
  addBox(group, [0.08, 0.02, -0.72], [0.05, 0.05, 0.76], 0x6ee7f9);
  addBox(group, [-0.03, -0.12, 0.05], [0.12, 0.22, 0.14], 0x334155);
  addBox(group, [-0.07, -0.04, 0.24], [0.14, 0.14, 0.24], 0x475569);
  group.rotation.set(-0.1, 0.14, -0.04);
  return group;
};

const createArena = () => {
  const group = new THREE.Group();
  const span = worldDistanceToScene(SERVER_WORLD_SIZE);
  const half = span / 2;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(span + 36, span + 36), new THREE.MeshLambertMaterial({ color: 0x0d1b24 }));
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  const inner = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.92, span * 0.92), new THREE.MeshLambertMaterial({ color: 0x102533 }));
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.01;
  group.add(inner);

  for (const [w, h, x, z] of [[span * 0.16, span * 0.86, 0, 0], [span * 0.86, span * 0.16, 0, 0]] as const) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ color: 0x162c3b }));
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.02;
    road.position.setX(x);
    road.position.setZ(z);
    group.add(road);
  }

  group.add(new THREE.GridHelper(span, 22, 0x274459, 0x183041));

  const centerPad = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 0.2, 28), new THREE.MeshLambertMaterial({ color: 0x1a3a4d }));
  centerPad.position.y = 0.1;
  group.add(centerPad);

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(group, [sx * (half - 4), 2.2, sz * (half - 4)], [1.2, 4.4, 1.2], 0x5cc3d6);

  for (const ridge of [
    [0, 0.9, -half * 0.62, span * 0.54, 1.8, 4],
    [0, 0.9, half * 0.62, span * 0.54, 1.8, 4],
    [-half * 0.62, 0.9, 0, 4, 1.8, span * 0.54],
    [half * 0.62, 0.9, 0, 4, 1.8, span * 0.54],
  ] as const) addBox(group, [ridge[0], ridge[1], ridge[2]], [ridge[3], ridge[4], ridge[5]], 0x223f52);

  for (const [x, z] of [
    [-half * 0.48, -half * 0.38], [half * 0.48, -half * 0.38], [-half * 0.48, half * 0.38], [half * 0.48, half * 0.38],
  ] as const) {
    addBox(group, [x, 2.4, z], [9, 4.8, 9], 0x31485c);
    addBox(group, [x, 5.2, z], [4.2, 1.2, 4.2], 0x3a6b83);
    addBox(group, [x - 6.2, 1.1, z + 5.8], [3.8, 2.2, 2.2], 0x5a7688);
    addBox(group, [x + 6.2, 1.1, z - 5.8], [3.8, 2.2, 2.2], 0x5a7688);
  }

  for (const [x, z] of [
    [-half * 0.23, -half * 0.14], [0, -half * 0.19], [half * 0.23, -half * 0.14], [-half * 0.28, 0],
    [half * 0.28, 0], [-half * 0.23, half * 0.14], [0, half * 0.19], [half * 0.23, half * 0.14],
  ] as const) {
    addBox(group, [x, 1, z], [4.5, 2, 2.2], 0x466579);
    addBox(group, [x + 3, 0.7, z + 3.2], [2.2, 1.4, 2.2], 0x58798f);
  }

  const beaconGeo = new THREE.CylinderGeometry(0.45, 0.45, 6.5, 8);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0x36576f });
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const radius = half * 0.88;
    const mesh = new THREE.Mesh(beaconGeo, beaconMat);
    mesh.position.set(Math.cos(angle) * radius, 3.25, Math.sin(angle) * radius);
    group.add(mesh);
  }

  return group;
};

export const FPSBattleRoyale3D: React.FC = () => {
  const { user } = useAuth();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraRigRef = useRef<FPSCameraRig | null>(null);
  const weaponRef = useRef<THREE.Group | null>(null);
  const zoneRef = useRef<THREE.Mesh | null>(null);
  const tracerRef = useRef<THREE.LineSegments | null>(null);
  const remoteRef = useRef<Map<string, RemoteVisual>>(new Map());
  const animationRef = useRef<number | null>(null);
  const latestSnapshotRef = useRef<Snapshot | null>(null);
  const previousBulletIdsRef = useRef<Set<string>>(new Set());
  const zoneWarningRef = useRef<string>("");
  const inputRef = useRef<InputState>({ up: false, down: false, left: false, right: false, firing: false, aimX: 0, aimY: 0 });
  const localMoveRef = useRef<LocalMoveState>({ forward: 0, strafe: 0 });
  const aimRayRef = useRef(new THREE.Ray());
  const groundPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const rayOriginRef = useRef(new THREE.Vector3());
  const rayDirectionRef = useRef(new THREE.Vector3());
  const aimHitRef = useRef(new THREE.Vector3());
  const touchLeftRef = useRef<StickState>({ ...EMPTY_STICK });
  const touchRightRef = useRef<StickState>({ ...EMPTY_STICK });
  const touchHudTimerRef = useRef<number>(Date.now());
  const audioRef = useRef(new AudioManager());

  const [profile, setProfile] = useState<Profile | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "offline">("connecting");
  const [touchUi, setTouchUi] = useState<TouchUi>({ left: { ...EMPTY_STICK }, right: { ...EMPTY_STICK } });
  const [isTouchMode, setIsTouchMode] = useState(false);
  const [touchHudVisible, setTouchHudVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);

  const selfId = user?.id || "";
  const selfName = useMemo(() => getNameFromUser(user), [user]);
  const matchmaking = getMatchmakingState(snapshot?.round || null, selfId, snapshot?.entities || []);
  const selfEntity = snapshot?.entities.find((entity) => entity.id === selfId) || null;
  const isAlive = !!selfEntity?.alive;
  const isRoundActive = snapshot?.round.phase === "active";
  const canControl = !!selfEntity && isAlive && isRoundActive;
  const damageFlashActive = !!selfEntity && Date.now() - selfEntity.damageFlashAt < 170;
  const reloadingMs = selfEntity ? Math.max(0, selfEntity.reloadingUntil - Date.now()) : 0;
  const isMobileFightView = isTouchMode && snapshot?.round.phase === "active" && isAlive;

  const syncTouchUi = () => setTouchUi({ left: { ...touchLeftRef.current }, right: { ...touchRightRef.current } });
  const markTouchActive = () => {
    touchHudTimerRef.current = Date.now();
    setTouchHudVisible(true);
  };

  const getCameraPlanarBasis = () => {
    const camera = cameraRef.current;
    if (!camera) {
      return {
        forward: new THREE.Vector3(0, 0, -1),
        right: new THREE.Vector3(1, 0, 0),
      };
    }

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    forward.normalize();

    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    return { forward, right };
  };

  const applyMovementToInput = () => {
    const local = localMoveRef.current;
    const { forward, right } = getCameraPlanarBasis();
    const worldX = right.x * local.strafe + forward.x * local.forward;
    const worldY = right.z * local.strafe + forward.z * local.forward;
    const threshold = 0.18;

    inputRef.current.left = worldX < -threshold;
    inputRef.current.right = worldX > threshold;
    inputRef.current.up = worldY < -threshold;
    inputRef.current.down = worldY > threshold;
  };

  const applyLookToServerAim = () => {
    const self = latestSnapshotRef.current?.entities.find((entity) => entity.id === selfId);
    const camera = cameraRef.current;
    if (!self || !camera) return;

    camera.getWorldPosition(rayOriginRef.current);
    camera.getWorldDirection(rayDirectionRef.current);
    aimRayRef.current.set(rayOriginRef.current, rayDirectionRef.current);

    if (aimRayRef.current.intersectPlane(groundPlaneRef.current, aimHitRef.current)) {
      inputRef.current.aimX = WORLD_CENTER + aimHitRef.current.x / WORLD_SCALE;
      inputRef.current.aimY = WORLD_CENTER + aimHitRef.current.z / WORLD_SCALE;
      return;
    }

    const { forward } = getCameraPlanarBasis();
    inputRef.current.aimX = self.x + forward.x * 2200;
    inputRef.current.aimY = self.y + forward.z * 2200;
  };

  const emitInput = () => {
    applyMovementToInput();
    applyLookToServerAim();
    socketRef.current?.emit("playerInput", inputRef.current);
  };

  const stopAllInput = () => {
    localMoveRef.current.forward = 0;
    localMoveRef.current.strafe = 0;
    inputRef.current.up = false;
    inputRef.current.down = false;
    inputRef.current.left = false;
    inputRef.current.right = false;
    inputRef.current.firing = false;
    touchLeftRef.current = { ...EMPTY_STICK };
    touchRightRef.current = { ...EMPTY_STICK };
    syncTouchUi();
    socketRef.current?.emit("playerInput", inputRef.current);
  };

  const refreshSummary = async () => {
    if (!selfId) return;
    const [nextProfile, nextLeaderboard] = await Promise.all([
      fetchJson<Profile>(`${SERVER_URL}/api/blaster/profile/${encodeURIComponent(selfId)}?name=${encodeURIComponent(selfName)}`),
      fetchJson<LeaderboardRow[]>(`${SERVER_URL}/api/blaster/leaderboard`),
    ]);
    setProfile(nextProfile);
    setLeaderboard(nextLeaderboard);
  };

  const toggleFullscreen = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
  };

  useEffect(() => {
    if (!canControl) stopAllInput();
  }, [canControl]);

  useEffect(() => {
    const onFlags = () => {
      setIsTouchMode(window.matchMedia?.("(pointer: coarse)")?.matches || window.innerWidth < 900);
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    };
    const onPointerLock = () => setPointerLocked(document.pointerLockElement === mountRef.current);
    onFlags();
    window.addEventListener("resize", onFlags);
    document.addEventListener("fullscreenchange", onFlags);
    document.addEventListener("pointerlockchange", onPointerLock);
    return () => {
      window.removeEventListener("resize", onFlags);
      document.removeEventListener("fullscreenchange", onFlags);
      document.removeEventListener("pointerlockchange", onPointerLock);
    };
  }, []);

  useEffect(() => {
    if (!isTouchMode) return undefined;
    const interval = window.setInterval(() => {
      if (touchLeftRef.current.active || touchRightRef.current.active) return;
      setTouchHudVisible(Date.now() - touchHudTimerRef.current < 2400);
    }, 300);
    return () => window.clearInterval(interval);
  }, [isTouchMode]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x061018);
    scene.fog = new THREE.Fog(0x061018, 34, 180);

    const camera = new THREE.PerspectiveCamera(78, 1, 0.1, 260);
    camera.position.set(0, 8, 18);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xc8ecff, 0x09121a, 1.1));
    const dir = new THREE.DirectionalLight(0xe7f6ff, 0.55);
    dir.position.set(36, 52, 14);
    scene.add(dir);
    scene.add(createArena());

    const zone = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.28, 96),
      new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    zone.rotation.x = -Math.PI / 2;
    zone.position.y = 0.09;
    scene.add(zone);

    const tracers = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xfff59d, transparent: true, opacity: 0.95 }),
    );
    scene.add(tracers);

    const weapon = makeWeaponMesh();
    camera.add(weapon);
    scene.add(camera);

    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    cameraRigRef.current = new FPSCameraRig(camera, weapon);
    weaponRef.current = weapon;
    zoneRef.current = zone;
    tracerRef.current = tracers;

    const resize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const width = mountRef.current.clientWidth;
      const height = mountRef.current.clientHeight;
      rendererRef.current.setSize(width, height);
      cameraRef.current.aspect = width / Math.max(1, height);
      cameraRef.current.updateProjectionMatrix();
    };

    let last = performance.now();
    const animate = () => {
      const currentScene = sceneRef.current;
      const currentRenderer = rendererRef.current;
      const currentCamera = cameraRef.current;
      const currentRig = cameraRigRef.current;
      const currentSnapshot = latestSnapshotRef.current;
      const zoneMesh = zoneRef.current;
      const weaponMesh = weaponRef.current;

      if (!currentScene || !currentRenderer || !currentCamera || !currentRig || !currentSnapshot || !zoneMesh || !weaponMesh) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      const nowTime = performance.now();
      const dt = Math.min(0.05, (nowTime - last) / 1000);
      last = nowTime;

      const self = currentSnapshot.entities.find((entity) => entity.id === selfId);
      const aliveFocus =
        currentSnapshot.entities.find((entity) => entity.id !== selfId && entity.alive) ||
        currentSnapshot.entities.find((entity) => entity.alive) ||
        currentSnapshot.entities[0];

      if (self?.alive) {
        const moving = Math.abs(localMoveRef.current.forward) > 0.15 || Math.abs(localMoveRef.current.strafe) > 0.15;
        currentRig.update(worldToScene(self.x, self.y, PLAYER_EYE_HEIGHT), moving, dt);
        currentCamera.fov += (78 - currentCamera.fov) * 0.18;
        currentCamera.updateProjectionMatrix();
        weaponMesh.visible = true;
        audioRef.current.setListener(currentCamera.position, getCameraPlanarBasis().forward);
        audioRef.current.maybeStep(moving);
        applyMovementToInput();
      } else if (aliveFocus) {
        const focus = worldToScene(aliveFocus.x, aliveFocus.y, 1.4);
        const orbit = nowTime * 0.00022;
        currentCamera.position.lerp(new THREE.Vector3(focus.x + Math.cos(orbit) * 14, 9, focus.z + Math.sin(orbit) * 14), 0.045);
        currentCamera.lookAt(focus);
        weaponMesh.visible = false;
        audioRef.current.setListener(currentCamera.position, new THREE.Vector3(0, 0, -1));
      } else {
        currentCamera.position.lerp(new THREE.Vector3(0, 15, 22), 0.04);
        currentCamera.lookAt(0, 0, 0);
        weaponMesh.visible = false;
      }

      zoneMesh.position.copy(worldToScene(currentSnapshot.round.zone.x, currentSnapshot.round.zone.y, 0.08));
      const zoneRadius = Math.max(1, worldDistanceToScene(currentSnapshot.round.zone.radius));
      zoneMesh.scale.set(zoneRadius, zoneRadius, zoneRadius);

      const tracerPoints: number[] = [];
      for (const bullet of currentSnapshot.bullets) {
        const from = worldToScene(bullet.previousX, bullet.previousY, BULLET_HEIGHT);
        const to = worldToScene(bullet.x, bullet.y, BULLET_HEIGHT);
        tracerPoints.push(from.x, from.y, from.z, to.x, to.y, to.z);
      }
      tracers.geometry.setAttribute("position", new THREE.Float32BufferAttribute(tracerPoints, 3));
      tracers.geometry.computeBoundingSphere();

      const active = new Set<string>();
      for (const entity of currentSnapshot.entities) {
        if (!entity.alive) continue;
        if (self?.alive && entity.id === selfId) continue;
        active.add(entity.id);
        let visual = remoteRef.current.get(entity.id);
        if (!visual) {
          visual = createPlayerVisual(entity.displayName, entity.id === selfId ? 0x60a5fa : 0xfb7185);
          remoteRef.current.set(entity.id, visual);
          currentScene.add(visual.root);
        }
        updatePlayerVisual(visual, entity);
        visual.label.lookAt(currentCamera.position);
      }

      for (const [id, visual] of remoteRef.current.entries()) {
        if (active.has(id)) continue;
        currentScene.remove(visual.root);
        remoteRef.current.delete(id);
      }

      currentRenderer.render(currentScene, currentCamera);
      animationRef.current = requestAnimationFrame(animate);
    };

    resize();
    animationRef.current = requestAnimationFrame(animate);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      for (const visual of remoteRef.current.values()) scene.remove(visual.root);
      remoteRef.current.clear();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [selfId]);

  useEffect(() => {
    if (!selfId) return undefined;
    void refreshSummary();

    const socket = io(SERVER_URL, { transports: ["websocket", "polling"], auth: { playerId: selfId, displayName: selfName } });
    socketRef.current = socket;
    setConnectionState("connecting");

    socket.on("connect", async () => {
      setConnectionState("connected");
      await audioRef.current.ensure();
    });
    socket.on("disconnect", () => setConnectionState("offline"));
    socket.on("fatal", (payload) => toast({ title: "Match error", description: payload?.message || "Connection failed", variant: "destructive" }));
    socket.on("profile", (nextProfile: Profile) => setProfile(nextProfile));
    socket.on("snapshot", (nextSnapshot: Snapshot) => {
      const prevSnapshot = latestSnapshotRef.current;
      const prevBullets = previousBulletIdsRef.current;
      const nextBulletIds = new Set(nextSnapshot.bullets.map((bullet) => bullet.id));

      for (const bullet of nextSnapshot.bullets) {
        if (!prevBullets.has(bullet.id)) audioRef.current.playAt("gunshot", bullet.previousX, bullet.previousY);
      }
      previousBulletIdsRef.current = nextBulletIds;

      const prevSelf = prevSnapshot?.entities.find((entity) => entity.id === selfId);
      const nextSelf = nextSnapshot.entities.find((entity) => entity.id === selfId);
      if (prevSelf && nextSelf && nextSelf.health < prevSelf.health) audioRef.current.playUi("hit");

      const warningKey = `${nextSnapshot.round.id}:${nextSnapshot.round.phaseEndsAt}`;
      if (nextSnapshot.round.phase === "active" && nextSnapshot.round.phaseEndsAt - Date.now() < 3000 && zoneWarningRef.current !== warningKey) {
        zoneWarningRef.current = warningKey;
        audioRef.current.playUi("zone");
      }

      latestSnapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
    });
    socket.on("roundEnded", async (payload: { results: RoundResult[]; leaderboard: LeaderboardRow[] }) => {
      setRoundResults(payload.results || []);
      setLeaderboard(payload.leaderboard || []);
      const winner = payload.results?.find((result) => result.placement === 1);
      if (winner?.playerId === selfId) audioRef.current.playUi("winner");
      else audioRef.current.playUi("kill");
      await refreshSummary();
    });

    return () => socket.disconnect();
  }, [selfId, selfName]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (isTouchMode || !pointerLocked || !canControl) return;
      cameraRigRef.current?.look(event.movementX, event.movementY, CAMERA_SENSITIVITY);
      emitInput();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!canControl) return;
      const key = event.key.toLowerCase();
      if (key === "w") localMoveRef.current.forward = 1;
      if (key === "s") localMoveRef.current.forward = -1;
      if (key === "a") localMoveRef.current.strafe = -1;
      if (key === "d") localMoveRef.current.strafe = 1;
      if (key === "r") audioRef.current.playUi("reload");
      if (key === " ") cameraRigRef.current?.kick(0.018);
      if (key === "f") toast({ title: "No interactables yet", description: "The current server has no pickups or doors." });
      emitInput();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!canControl) return;
      const key = event.key.toLowerCase();
      if (key === "w" && localMoveRef.current.forward > 0) localMoveRef.current.forward = 0;
      if (key === "s" && localMoveRef.current.forward < 0) localMoveRef.current.forward = 0;
      if (key === "a" && localMoveRef.current.strafe < 0) localMoveRef.current.strafe = 0;
      if (key === "d" && localMoveRef.current.strafe > 0) localMoveRef.current.strafe = 0;
      emitInput();
    };
    const onMouseDown = async () => {
      if (isTouchMode || !canControl) return;
      await audioRef.current.ensure();
      if (!pointerLocked) {
        mountRef.current?.requestPointerLock();
        return;
      }
      if ((selfEntity?.ammo || 0) <= 0) audioRef.current.playUi("empty");
      inputRef.current.firing = true;
      cameraRigRef.current?.kick(0.05);
      emitInput();
    };
    const onMouseUp = () => {
      if (isTouchMode || !canControl) return;
      inputRef.current.firing = false;
      emitInput();
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [canControl, isTouchMode, pointerLocked, selfEntity?.ammo]);

  const updateMoveStick = (normalized: { x: number; y: number }) => {
    localMoveRef.current.strafe = normalized.x;
    localMoveRef.current.forward = -normalized.y;
  };

  const leftTouchStart: React.TouchEventHandler<HTMLDivElement> = (event) => {
    if (!canControl) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    void audioRef.current.ensure();
    touchLeftRef.current = beginStick(touch.identifier, touch.clientX, touch.clientY);
    markTouchActive();
    syncTouchUi();
  };
  const leftTouchMove: React.TouchEventHandler<HTMLDivElement> = (event) => {
    if (!canControl) return;
    const touch = [...event.changedTouches].find((entry) => entry.identifier === touchLeftRef.current.pointerId);
    if (!touch) return;
    const moved = moveStick(touchLeftRef.current, touch.clientX, touch.clientY);
    touchLeftRef.current = moved.next;
    updateMoveStick(moved.normalized);
    markTouchActive();
    syncTouchUi();
    emitInput();
  };
  const leftTouchEnd: React.TouchEventHandler<HTMLDivElement> = (event) => {
    if (!canControl) return;
    const touch = [...event.changedTouches].find((entry) => entry.identifier === touchLeftRef.current.pointerId);
    if (!touch) return;
    touchLeftRef.current = { ...EMPTY_STICK };
    localMoveRef.current.forward = 0;
    localMoveRef.current.strafe = 0;
    markTouchActive();
    syncTouchUi();
    emitInput();
  };

  const rightTouchStart: React.TouchEventHandler<HTMLDivElement> = (event) => {
    if (!canControl) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    void audioRef.current.ensure();
    touchRightRef.current = beginStick(touch.identifier, touch.clientX, touch.clientY);
    markTouchActive();
    syncTouchUi();
  };
  const rightTouchMove: React.TouchEventHandler<HTMLDivElement> = (event) => {
    if (!canControl) return;
    const touch = [...event.changedTouches].find((entry) => entry.identifier === touchRightRef.current.pointerId);
    if (!touch) return;
    const moved = moveStick(touchRightRef.current, touch.clientX, touch.clientY);
    touchRightRef.current = moved.next;
    cameraRigRef.current?.look(moved.normalized.x * 14, moved.normalized.y * 14, CAMERA_SENSITIVITY * 1.7);
    markTouchActive();
    syncTouchUi();
    emitInput();
  };
  const rightTouchEnd: React.TouchEventHandler<HTMLDivElement> = (event) => {
    if (!canControl) return;
    const touch = [...event.changedTouches].find((entry) => entry.identifier === touchRightRef.current.pointerId);
    if (!touch) return;
    touchRightRef.current = { ...EMPTY_STICK };
    markTouchActive();
    syncTouchUi();
  };

  const touchFireStart = async () => {
    if (!canControl) return;
    markTouchActive();
    await audioRef.current.ensure();
    if ((selfEntity?.ammo || 0) <= 0) audioRef.current.playUi("empty");
    inputRef.current.firing = true;
    cameraRigRef.current?.kick(0.05);
    emitInput();
  };
  const touchFireEnd = () => {
    if (!canControl) return;
    inputRef.current.firing = false;
    markTouchActive();
    emitInput();
  };

  const stickStyle = (stick: StickState) => {
    const rect = mountRef.current?.getBoundingClientRect();
    return {
      base: { left: stick.startX - (rect?.left || 0) - TOUCH_STICK_RADIUS, top: stick.startY - (rect?.top || 0) - TOUCH_STICK_RADIUS },
      knob: { left: stick.x - (rect?.left || 0) - 22, top: stick.y - (rect?.top || 0) - 22 },
    };
  };

  const leftStyle = stickStyle(touchUi.left);
  const rightStyle = stickStyle(touchUi.right);

  return (
    <div ref={stageRef} className={["fixed inset-0 bg-black text-white", isFullscreen ? "z-[140]" : "z-50"].join(" ")}>
      <div
        ref={mountRef}
        className="absolute inset-0"
        onClick={() => {
          void audioRef.current.ensure();
          if (!isTouchMode && canControl) mountRef.current?.requestPointerLock();
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(54,121,153,0.18),rgba(1,7,12,0.94))]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(103,197,255,0.05),transparent_30%,rgba(0,0,0,0.18))]" />
      {damageFlashActive ? <div className="pointer-events-none absolute inset-0 bg-red-500/10" /> : null}

      {!isMobileFightView ? (
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
        <Link to="/arcade">
          <Button variant="secondary" className="pointer-events-auto bg-slate-800/90 text-white hover:bg-slate-700">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Arcade
          </Button>
        </Link>
        <Badge variant="secondary" className="border-white/10 bg-black/45 text-white">{connectionState}</Badge>
        <Badge variant="secondary" className="border-cyan-300/20 bg-black/45 text-cyan-100">{matchmaking.statusLabel}</Badge>
      </div>
      ) : null}

      {!isMobileFightView ? (
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
        <Button variant="secondary" className="pointer-events-auto border-white/10 bg-black/45 text-white" onClick={() => void audioRef.current.ensure()}>
          <Volume2 className="mr-2 h-4 w-4" />
          Audio
        </Button>
        <Button variant="secondary" className="pointer-events-auto border-white/10 bg-black/45 text-white" onClick={() => void toggleFullscreen()}>
          {isFullscreen ? <Minimize className="mr-2 h-4 w-4" /> : <Expand className="mr-2 h-4 w-4" />}
          {isFullscreen ? "Exit" : "Fullscreen"}
        </Button>
      </div>
      ) : null}

      {!isMobileFightView ? (
      <div className="absolute left-4 bottom-4 z-20 w-[340px] max-w-[calc(100vw-2rem)] rounded-3xl border border-white/10 bg-black/45 p-4 backdrop-blur-md">
        <div className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">{matchmaking.statusLabel}</div>
        <div className="mt-1 text-sm text-slate-200">{matchmaking.subtitle}</div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-300 transition-all" style={{ width: `${selfEntity ? Math.max(0, Math.min(100, selfEntity.health)) : 0}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-300">
          <div>Health: <span className="font-semibold text-white">{selfEntity?.health ?? 0}</span></div>
          <div>Alive: <span className="font-semibold text-white">{snapshot?.round.aliveCount ?? 0}</span></div>
          <div>Ammo: <span className="font-semibold text-white">{selfEntity ? `${selfEntity.ammo}/${selfEntity.reserveAmmo}` : "0/0"}</span></div>
          <div>Kills: <span className="font-semibold text-white">{selfEntity?.kills ?? 0}</span></div>
          <div>Credits: <span className="font-semibold text-white">{profile?.credits ?? 0}</span></div>
          <div>Players: <span className="font-semibold text-white">{snapshot?.round.playerCount ?? 0}</span></div>
        </div>
        {reloadingMs > 0 ? <div className="mt-3 text-xs text-amber-200">Reloading {Math.ceil(reloadingMs / 1000)}s</div> : null}
      </div>
      ) : null}

      {!isMobileFightView ? (
      <div className="absolute right-4 bottom-4 z-20 w-[320px] max-w-[calc(100vw-2rem)] space-y-3">
        <div className="rounded-3xl border border-white/10 bg-black/45 p-4 backdrop-blur-md">
          <div className="text-xs uppercase tracking-[0.28em] text-slate-300">Leaderboard</div>
          <div className="mt-3 space-y-2 text-sm">
            {leaderboard.slice(0, 5).map((row, index) => (
              <div key={row.player_id} className="flex items-center justify-between text-slate-200">
                <span>{index + 1}. {row.display_name}</span>
                <span>{row.credits} cr</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-black/45 p-4 backdrop-blur-md">
          <div className="text-xs uppercase tracking-[0.28em] text-slate-300">Match Rules</div>
          <div className="mt-3 space-y-1 text-xs text-slate-300">
            <div>Real players only. Round starts at 2 players.</div>
            <div>Mid-round joiners spectate and spawn next round.</div>
            <div>Top 3 placements and every kill earn credits.</div>
          </div>
        </div>
      </div>
      ) : null}

      {roundResults.length > 0 && !isMobileFightView ? (
        <div className="absolute inset-x-0 top-24 z-20 mx-auto w-[min(520px,calc(100vw-2rem))] rounded-3xl border border-white/10 bg-black/55 p-4 text-white backdrop-blur-md">
          <div className="text-xs uppercase tracking-[0.28em] text-slate-300">Latest Round</div>
          <div className="mt-3 space-y-2 text-sm">
            {roundResults.slice(0, 3).map((row) => (
              <div key={`${row.playerId}-${row.placement}`} className="flex items-center justify-between">
                <span>#{row.placement} {row.displayName}</span>
                <span>{row.kills} kills | {row.creditsEarned} cr</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {canControl && !matchmaking.spectating ? (
        <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-white/90">
          <Crosshair className="h-8 w-8" />
        </div>
      ) : null}

      {!isTouchMode ? (
        <div className="absolute left-1/2 bottom-4 z-20 -translate-x-1/2 rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-xs text-slate-300 backdrop-blur-sm">
          {canControl ? "Mouse look | WASD move | Click shoot | R reload | Space camera hop | F notice" : "Controls unlock when the round is active and you are alive."}
        </div>
      ) : null}

      {!pointerLocked && !isTouchMode && canControl ? (
        <div className="pointer-events-none absolute inset-x-0 top-[16%] z-20 mx-auto w-[min(440px,calc(100vw-2rem))] rounded-3xl border border-white/10 bg-black/45 p-4 text-center backdrop-blur-md">
          <div className="text-sm text-white">Click the arena to lock the mouse and enter first-person aim.</div>
        </div>
      ) : null}

      {isTouchMode && canControl ? (
        <>
          <div className="absolute inset-y-0 left-0 z-20 w-1/2 touch-none" onTouchStart={leftTouchStart} onTouchMove={leftTouchMove} onTouchEnd={leftTouchEnd} onTouchCancel={leftTouchEnd} />
          <div className="absolute inset-y-0 right-0 z-20 w-1/2 touch-none" onTouchStart={rightTouchStart} onTouchMove={rightTouchMove} onTouchEnd={rightTouchEnd} onTouchCancel={rightTouchEnd} />

          {touchHudVisible || touchUi.left.active || touchUi.right.active ? (
            <>
              {touchUi.left.active ? (
                <>
                  <div className="pointer-events-none absolute z-20 h-[116px] w-[116px] rounded-full border border-white/20 bg-black/20" style={leftStyle.base} />
                  <div className="pointer-events-none absolute z-20 h-11 w-11 rounded-full bg-white/35 ring-2 ring-white/20" style={leftStyle.knob} />
                </>
              ) : null}
              {touchUi.right.active ? (
                <>
                  <div className="pointer-events-none absolute z-20 h-[116px] w-[116px] rounded-full border border-cyan-300/20 bg-cyan-400/10" style={rightStyle.base} />
                  <div className="pointer-events-none absolute z-20 h-11 w-11 rounded-full bg-cyan-300/35 ring-2 ring-cyan-200/25" style={rightStyle.knob} />
                </>
              ) : null}

              <div className="absolute bottom-6 left-6 z-20 rounded-full border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-white/80">Move</div>
              <div className="absolute bottom-6 right-6 z-20 rounded-full border border-cyan-300/20 bg-black/40 px-3 py-2 text-[11px] text-cyan-100">Look</div>

              <div className="absolute bottom-6 right-6 z-20 flex flex-col items-end gap-3 pointer-events-auto">
                <button onTouchStart={() => void touchFireStart()} onTouchEnd={touchFireEnd} onTouchCancel={touchFireEnd} className="h-20 w-20 rounded-full border border-red-300/30 bg-red-500/20 text-sm font-semibold text-white backdrop-blur-sm">Fire</button>
                <div className="flex gap-2">
                  <button onClick={() => { markTouchActive(); audioRef.current.playUi("reload"); }} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/80">Reload</button>
                  <button onClick={() => { markTouchActive(); cameraRigRef.current?.kick(0.018); }} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/80">Jump</button>
                  <button onClick={() => void toggleFullscreen()} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/80">Full</button>
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

