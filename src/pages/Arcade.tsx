import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { setupHiDPICanvas } from "@/pages/arcade/lib/canvas";
import { fetchCredits, fetchLeaderboard, startRun, submitScore } from "@/pages/arcade/lib/arcadeApi";
import { getDailyChallenge } from "@/pages/arcade/lib/dailyChallenge";
import type { ArcadeGameName, ArcadeGameStatus } from "@/pages/arcade/types";
import { createFlappy } from "@/pages/arcade/games/flappy";
import { createSnake } from "@/pages/arcade/games/snake";
import { createStack } from "@/pages/arcade/games/stack";
import { ArcadeAudio } from "@/pages/arcade/lib/audio";
import { Link } from "react-router-dom";
import { Bird, Coins, Crosshair, Gamepad2, Layers, Music2, Pause, Play, RefreshCcw, Trophy, Volume2, VolumeX, Worm } from "lucide-react";

type ClassicGameName = Exclude<ArcadeGameName, "blaster">;
type Controller = ReturnType<typeof createFlappy> | ReturnType<typeof createSnake> | ReturnType<typeof createStack>;

type GameMeta = {
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  howTo: string;
  scoreLabel: string;
  multiplayer?: boolean;
};

const GAME_META: Record<ArcadeGameName, GameMeta> = {
  flappy: {
    title: "Flappy",
    description: "Tap to flap. Thread the pipes.",
    icon: Bird,
    howTo: "Tap / Space to flap. Survive as long as you can.",
    scoreLabel: "Score",
  },
  snake: {
    title: "Snake",
    description: "Swipe to steer. Grow your length.",
    icon: Worm,
    howTo: "Swipe / Arrow keys. Eat red squares, avoid walls & yourself.",
    scoreLabel: "Length",
  },
  stack: {
    title: "Stack",
    description: "Tap to drop. Keep your stack alive.",
    icon: Layers,
    howTo: "Tap / Space to drop. Small misses shrink your block.",
    scoreLabel: "Stack",
  },
  blaster: {
    title: "Blaster Royale",
    description: "Lightweight multiplayer survival shooter with shrinking zone.",
    icon: Crosshair,
    howTo: "WASD to move, mouse to aim, hold click to fire.",
    scoreLabel: "Placement",
    multiplayer: true,
  },
};

const CLASSIC_GAMES: ClassicGameName[] = ["flappy", "snake", "stack"];
const formatUserId = (id: string) => `${id.slice(0, 6)}...${id.slice(-4)}`;

const getLeaderboardName = (row: { user_id: string; display_name?: string }, selfId?: string) => {
  if (row.user_id === selfId) return "You";
  return row.display_name || formatUserId(row.user_id);
};

const Arcade: React.FC = () => {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [selected, setSelected] = useState<ArcadeGameName>("blaster");
  const [status, setStatus] = useState<ArcadeGameStatus>("idle");
  const [score, setScore] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runEndedAt, setRunEndedAt] = useState<number | null>(null);
  const runIdRef = useRef<string | null>(null);
  const runStartedAtRef = useRef<number | null>(null);
  const runEndedAtRef = useRef<number | null>(null);
  const runStartPromiseRef = useRef<Promise<string | null> | null>(null);
  const runSessionVersionRef = useRef(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<Controller | null>(null);
  const audioRef = useRef<ArcadeAudio | null>(null);
  if (!audioRef.current) audioRef.current = new ArcadeAudio();
  const [audioSettings, setAudioSettings] = useState(() => audioRef.current!.getSettings());

  const setStartedAt = (t: number | null) => {
    runStartedAtRef.current = t;
    setRunStartedAt(t);
  };

  const setEndedAt = (t: number | null) => {
    runEndedAtRef.current = t;
    setRunEndedAt(t);
  };

  const setRunIdValue = (value: string | null) => {
    runIdRef.current = value;
    setRunId(value);
  };

  const clearRunSession = () => {
    runSessionVersionRef.current += 1;
    setRunIdValue(null);
    runStartPromiseRef.current = null;
    setStartedAt(null);
    setEndedAt(null);
  };

  const ensureServerRun = async (game: ClassicGameName) => {
    if (!user?.id) return null;
    if (runIdRef.current) return runIdRef.current;
    if (runStartPromiseRef.current) return runStartPromiseRef.current;

    const pending = (async () => {
      const sessionVersion = runSessionVersionRef.current;
      const res = await startRun(game);
      if (!res.accepted) {
        toast({
          title: "Run setup failed",
          description: res.message || res.reason,
          variant: "destructive",
        });
        return null;
      }

      if (sessionVersion !== runSessionVersionRef.current) return null;

      setRunIdValue(res.run_id);
      const serverStartedAt = Date.parse(res.started_at);
      if (Number.isFinite(serverStartedAt)) setStartedAt(serverStartedAt);
      return res.run_id;
    })();

    runStartPromiseRef.current = pending;
    const createdRunId = await pending;
    runStartPromiseRef.current = null;
    return createdRunId;
  };

  const challenge = useMemo(() => getDailyChallenge(new Date()), []);
  const classicSelected = selected !== "blaster";
  const classicGame = classicSelected ? (selected as ClassicGameName) : "flappy";
  const meta = GAME_META[selected];

  const creditsQuery = useQuery({
    queryKey: ["arcade-credits", user?.id],
    queryFn: async () => fetchCredits(user!.id),
    enabled: !!user?.id && classicSelected,
    staleTime: 10_000,
  });

  const leaderboardQuery = useQuery({
    queryKey: ["arcade-leaderboard", classicGame],
    queryFn: async () => fetchLeaderboard(classicGame, 10),
    enabled: classicSelected,
    staleTime: 10_000,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!runIdRef.current || selected === "blaster") return { accepted: false as const, reason: "missing_run" };
      return submitScore({
        run_id: runIdRef.current,
        game_name: selected,
        score,
      });
    },
    onSuccess: async (res) => {
      if (res.accepted) {
        toast({
          title: "Score submitted",
          description: `+${res.credits_awarded} credits (total ${res.credits_total}).`,
        });
        clearRunSession();
        await qc.invalidateQueries({ queryKey: ["arcade-credits", user?.id] });
        await qc.invalidateQueries({ queryKey: ["arcade-leaderboard", selected] });
      } else {
        toast({
          title: "Submission rejected",
          description: res.message || res.reason,
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({
        title: "Submission failed",
        description: err?.message || "Unable to submit score.",
        variant: "destructive",
      });
    },
  });

  const mountGame = (game: ClassicGameName) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    controllerRef.current?.destroy();
    controllerRef.current = null;

    setScore(0);
    clearRunSession();
    setStatus("idle");

    const rect = container.getBoundingClientRect();
    const targetW = Math.max(320, Math.floor(rect.width));
    const targetH = Math.max(420, Math.floor(Math.min(560, rect.width * 1.25)));

    const { resize } = setupHiDPICanvas(canvas);
    resize(targetW, targetH);

    const commonOpts = {
      onScore: (nextScore: number) => setScore(nextScore),
      onStatus: (nextStatus: ArcadeGameStatus) => {
        setStatus(nextStatus);
        if (nextStatus === "running" && !runStartedAtRef.current) {
          const t = controllerRef.current?.getStartedAt?.() ?? Date.now();
          setStartedAt(t);
        }
        if (nextStatus === "running" && !runIdRef.current) void ensureServerRun(game);
      },
      onGameOver: ({ score: nextScore }: { score: number }) => {
        setScore(nextScore);
        if (!runStartedAtRef.current) {
          const t = controllerRef.current?.getStartedAt?.() ?? Date.now();
          setStartedAt(t);
        }
        setEndedAt(Date.now());
      },
      onSfx: (name: any) => {
        audioRef.current?.resume();
        audioRef.current?.playSfx(name);
      },
    };

    if (game === "flappy") controllerRef.current = createFlappy(canvas, commonOpts);
    if (game === "snake") controllerRef.current = createSnake(canvas, commonOpts);
    if (game === "stack") controllerRef.current = createStack(canvas, commonOpts);

    audioRef.current?.resume();
    audioRef.current?.startMusic(game);
  };

  useEffect(() => {
    if (!classicSelected) {
      controllerRef.current?.destroy();
      controllerRef.current = null;
      audioRef.current?.stopAll();
      return;
    }
    mountGame(selected as ClassicGameName);
  }, [selected]);

  useEffect(() => {
    const onResize = () => {
      if (!classicSelected) return;
      mountGame(selected as ClassicGameName);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [selected, classicSelected]);

  useEffect(() => () => controllerRef.current?.destroy(), []);
  useEffect(() => () => audioRef.current?.stopAll(), []);

  const onStart = () => {
    if (selected === "blaster") return;
    if (!runStartedAtRef.current) setStartedAt(Date.now());
    if (!runIdRef.current) void ensureServerRun(selected);
    audioRef.current?.resume();
    controllerRef.current?.start();
  };

  const onPause = () => controllerRef.current?.pause();
  const onReset = () => {
    controllerRef.current?.reset();
    clearRunSession();
  };

  const canSubmit = classicSelected && status === "over" && !!runId && !!user?.id;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
          <div>
            <h1 className="font-heading text-3xl font-bold text-foreground flex items-center gap-2">
              <Gamepad2 className="h-7 w-7" />
              Arcade Hub
            </h1>
            <p className="text-muted-foreground mt-1">
              Lightweight browser games, including a realtime survival shooter with leaderboard-backed credit rewards.
            </p>
          </div>

          {classicSelected ? (
            <Card className="w-full sm:w-auto">
              <CardContent className="p-4 flex items-center gap-3">
                <Coins className="h-5 w-5 text-muted-foreground" />
                <div className="flex flex-col">
                  <div className="text-xs text-muted-foreground">Classic Credits</div>
                  <div className="text-lg font-semibold">
                    {creditsQuery.isLoading ? (
                      <Skeleton className="h-6 w-16" />
                    ) : creditsQuery.isError ? (
                      <span className="text-destructive">-</span>
                    ) : (
                      creditsQuery.data
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="w-full sm:w-auto">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Live Mode</div>
                <div className="text-lg font-semibold">Socket.IO + SQLite</div>
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Games</CardTitle>
            <CardDescription>Select a game from the arcade lineup.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {(Object.keys(GAME_META) as ArcadeGameName[]).map((game) => {
              const gameMeta = GAME_META[game];
              return (
                <button
                  key={game}
                  onClick={() => setSelected(game)}
                  className={[
                    "text-left rounded-xl border p-4 transition-colors",
                    game === selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <gameMeta.icon size={16} />
                    {gameMeta.title}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{gameMeta.description}</div>
                  {gameMeta.multiplayer ? (
                    <div className="text-[11px] uppercase tracking-wide text-emerald-500 mt-2">Multiplayer</div>
                  ) : null}
                </button>
              );
            })}
          </CardContent>
        </Card>

        {selected === "blaster" ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Crosshair className="h-5 w-5" /> Blaster Royale 3D</CardTitle>
              <CardDescription>Standalone fullscreen Three.js FPS client on top of the existing authoritative Socket.IO server.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-border p-4"><div className="text-xs text-muted-foreground">Desktop</div><div className="mt-1 font-semibold">Pointer lock, mouse look, WASD</div></div>
                <div className="rounded-xl border border-border p-4"><div className="text-xs text-muted-foreground">Mobile</div><div className="mt-1 font-semibold">Twin stick look + move with fullscreen controls</div></div>
                <div className="rounded-xl border border-border p-4"><div className="text-xs text-muted-foreground">Backend</div><div className="mt-1 font-semibold">Current server rules, credits, leaderboard preserved</div></div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link to="/arcade/blaster-fps">
                  <Button><Crosshair className="h-4 w-4 mr-2" /> Launch FPS Arena</Button>
                </Link>
                <div className="text-sm text-muted-foreground self-center">The 3D client is server-compatible. Weapon variety, sprint, jump, and interact are presented client-side within the current protocol limits.</div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <meta.icon size={18} />
                    {meta.title}
                  </span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {meta.scoreLabel}: <span className="text-foreground font-semibold">{score}</span>
                  </span>
                </CardTitle>
                <CardDescription>{meta.howTo}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div ref={containerRef} className="w-full">
                  <canvas ref={canvasRef} className="w-full rounded-lg border border-border bg-muted/30" />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={onStart} disabled={status === "running"}>
                    <Play className="h-4 w-4 mr-2" />
                    Start
                  </Button>
                  <Button variant="secondary" onClick={onPause} disabled={status !== "running"}>
                    <Pause className="h-4 w-4 mr-2" />
                    Pause
                  </Button>
                  <Button variant="outline" onClick={onReset}>
                    <RefreshCcw className="h-4 w-4 mr-2" />
                    Reset
                  </Button>

                  <Button className="ml-auto" onClick={() => submitMutation.mutate()} disabled={!canSubmit || submitMutation.isPending}>
                    {submitMutation.isPending ? "Submitting..." : "Submit Score"}
                  </Button>
                </div>

                {status !== "over" ? (
                  <div className="text-xs text-muted-foreground">
                    Tip: Rewards are calculated server-side; unrealistic scores are rejected.
                  </div>
                ) : (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Run complete.</span>{" "}
                    <span className="font-semibold">Submit</span>{" "}
                    <span className="text-muted-foreground">to update leaderboard and earn credits.</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Audio</CardTitle>
                  <CardDescription>Music and sound effects.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        audioRef.current?.resume();
                        audioRef.current?.setSettings({ enabled: !audioSettings.enabled });
                        setAudioSettings(audioRef.current!.getSettings());
                      }}
                    >
                      {audioSettings.enabled ? <Volume2 className="h-4 w-4 mr-2" /> : <VolumeX className="h-4 w-4 mr-2" />}
                      {audioSettings.enabled ? "Sound On" : "Sound Off"}
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => {
                        audioRef.current?.resume();
                        audioRef.current?.setSettings({ music: !audioSettings.music });
                        const nextSettings = audioRef.current!.getSettings();
                        setAudioSettings(nextSettings);
                        if (!nextSettings.music) audioRef.current?.stopAll();
                        else audioRef.current?.startMusic(selected as ClassicGameName);
                      }}
                    >
                      <Music2 className="h-4 w-4 mr-2" />
                      {audioSettings.music ? "Music On" : "Music Off"}
                    </Button>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-xs text-muted-foreground w-16">Volume</div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(audioSettings.volume * 100)}
                      onChange={(e) => {
                        audioRef.current?.resume();
                        audioRef.current?.setSettings({ volume: Number(e.target.value) / 100 });
                        setAudioSettings(audioRef.current!.getSettings());
                      }}
                      className="w-full accent-primary"
                    />
                  </div>

                  <div className="text-xs text-muted-foreground">Audio starts after your first interaction (browser policy).</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="h-5 w-5" />
                    Leaderboard
                  </CardTitle>
                  <CardDescription>Top scores for {meta.title}.</CardDescription>
                </CardHeader>
                <CardContent>
                  {leaderboardQuery.isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-11/12" />
                      <Skeleton className="h-4 w-10/12" />
                    </div>
                  ) : leaderboardQuery.isError ? (
                    <div className="text-sm text-destructive">Failed to load leaderboard.</div>
                  ) : leaderboardQuery.data.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No scores yet (or backend not configured).</div>
                  ) : (
                    <div className="space-y-2">
                      {leaderboardQuery.data.map((row, index) => (
                        <div key={row.id} className="flex items-center justify-between text-sm rounded-md border border-border px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 text-muted-foreground">{index + 1}</div>
                            <div className="font-medium">{getLeaderboardName(row, user?.id)}</div>
                          </div>
                          <div className="font-semibold">{row.score}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Daily Challenge</CardTitle>
                  <CardDescription>Rotates daily (UTC).</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="font-semibold">{challenge.title}</div>
                  <div className="text-sm text-muted-foreground">
                    Reach <span className="font-semibold text-foreground">{challenge.targetScore}</span> in{" "}
                    <span className="font-semibold text-foreground">{GAME_META[challenge.game].title}</span>.
                  </div>
                  <div className="text-xs text-muted-foreground">{challenge.hint}</div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Arcade;


