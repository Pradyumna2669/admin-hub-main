import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Crown, Coins, Trophy, Wifi } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchSurvivorLeaderboard, fetchSurvivorProfile } from "@/pages/arcade/br/api";
import SurvivorCanvas from "@/pages/arcade/br/SurvivorCanvas";

type BattleRoyalePanelProps = {
  userId: string;
  displayName: string;
};

const formatName = (name: string, selfDisplayName: string) => (name === selfDisplayName ? "You" : name);

export const BattleRoyalePanel: React.FC<BattleRoyalePanelProps> = ({ userId, displayName }) => {
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["arcade-survivor-profile", userId],
    queryFn: () => fetchSurvivorProfile(userId),
    staleTime: 8_000,
  });

  const leaderboardQuery = useQuery({
    queryKey: ["arcade-survivor-leaderboard"],
    queryFn: () => fetchSurvivorLeaderboard(10),
    staleTime: 8_000,
  });

  const refreshRewards = async () => {
    await queryClient.invalidateQueries({ queryKey: ["arcade-survivor-profile", userId] });
    await queryClient.invalidateQueries({ queryKey: ["arcade-survivor-leaderboard"] });
  };

  const profile = profileQuery.data?.profile;
  const recentResults = profileQuery.data?.recentResults || [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-amber-200/10 bg-[linear-gradient(180deg,rgba(22,22,18,0.94),rgba(11,13,11,0.98))] text-white">
          <CardHeader className="pb-2">
            <CardDescription className="text-white/55">Arcade Credits</CardDescription>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <Coins className="h-6 w-6 text-amber-300" />
              {profileQuery.isLoading ? <Skeleton className="h-8 w-24 bg-white/10" /> : profile?.credits?.toLocaleString() ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-white/60">
            Top placements earn the biggest payouts. Kills add bonus credits.
          </CardContent>
        </Card>

        <Card className="border-emerald-200/10 bg-[linear-gradient(180deg,rgba(9,31,24,0.96),rgba(7,14,12,0.98))] text-white">
          <CardHeader className="pb-2">
            <CardDescription className="text-white/55">Wins</CardDescription>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <Crown className="h-6 w-6 text-emerald-300" />
              {profileQuery.isLoading ? <Skeleton className="h-8 w-20 bg-white/10" /> : profile?.wins ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-white/60">
            Last alive inside the final zone wins the round.
          </CardContent>
        </Card>

        <Card className="border-sky-200/10 bg-[linear-gradient(180deg,rgba(11,27,40,0.96),rgba(7,12,18,0.98))] text-white">
          <CardHeader className="pb-2">
            <CardDescription className="text-white/55">Kills</CardDescription>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <Crosshair className="h-6 w-6 text-sky-300" />
              {profileQuery.isLoading ? <Skeleton className="h-8 w-20 bg-white/10" /> : profile?.kills ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-white/60">
            Recoil, line-of-fire checks, and obstacle cover keep the gunplay readable.
          </CardContent>
        </Card>

        <Card className="border-fuchsia-200/10 bg-[linear-gradient(180deg,rgba(28,17,37,0.96),rgba(12,10,18,0.98))] text-white">
          <CardHeader className="pb-2">
            <CardDescription className="text-white/55">Matches</CardDescription>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <Wifi className="h-6 w-6 text-fuchsia-300" />
              {profileQuery.isLoading ? <Skeleton className="h-8 w-20 bg-white/10" /> : profile?.matches_played ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-white/60">
            Socket.IO snapshots keep the browser client lightweight.
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
        <SurvivorCanvas userId={userId} displayName={displayName} onRoundSettled={refreshRewards} />

        <div className="space-y-6">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5" />
                Season Board
              </CardTitle>
              <CardDescription>Ranked by wins, kills, then stored credits.</CardDescription>
            </CardHeader>
            <CardContent>
              {leaderboardQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : leaderboardQuery.isError ? (
                <div className="text-sm text-destructive">Arcade server is unreachable. Start `npm run dev:arcade-server`.</div>
              ) : (
                <div className="space-y-2">
                  {leaderboardQuery.data?.map((entry, index) => (
                    <div
                      key={entry.user_id}
                      className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground">#{index + 1}</div>
                          <div className="font-semibold">{entry.user_id === userId ? "You" : formatName(entry.display_name, displayName)}</div>
                        </div>
                        <div className="text-right text-sm">
                          <div>{entry.wins} wins</div>
                          <div className="text-muted-foreground">{entry.kills} kills</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!leaderboardQuery.data?.length ? (
                    <div className="text-sm text-muted-foreground">No ranked runs yet.</div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>Recent Rewards</CardTitle>
              <CardDescription>Latest credit payouts stored in SQLite.</CardDescription>
            </CardHeader>
            <CardContent>
              {profileQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : recentResults.length ? (
                <div className="space-y-2">
                  {recentResults.map((result) => (
                    <div key={`${result.room_id}-${result.created_at}`} className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">Placement #{result.placement}</div>
                          <div className="text-xs text-muted-foreground">{new Date(result.created_at).toLocaleString()}</div>
                        </div>
                        <div className="text-right text-sm">
                          <div className="font-semibold text-amber-500">+{result.credits_awarded} cr</div>
                          <div className="text-muted-foreground">{result.kills} kills</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Play a round to start earning credits.</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>Reward Rules</CardTitle>
              <CardDescription>Server-side economy for the new survival shooter.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div>1st place: 140 credits</div>
              <div>2nd place: 90 credits</div>
              <div>3rd place: 55 credits</div>
              <div>4th place: 25 credits</div>
              <div>Each elimination: +8 credits</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default BattleRoyalePanel;
