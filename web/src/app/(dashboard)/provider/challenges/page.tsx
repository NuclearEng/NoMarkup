'use client';

import { Flame, Trophy } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ChallengeCard } from '@/components/providers/ChallengeCard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useActiveChallenges,
  useJoinChallenge,
  useMyChallenges,
} from '@/hooks/useChallenges';
import type { Challenge } from '@/types';

export default function ProviderChallengesPage() {
  const { data: activeChallenges, isLoading: activeLoading } = useActiveChallenges();
  const { data: myChallenges, isLoading: myLoading } = useMyChallenges();
  const joinChallenge = useJoinChallenge();

  const [joiningId, setJoiningId] = useState<string | null>(null);

  const handleJoin = useCallback(
    (challengeId: string) => {
      setJoiningId(challengeId);
      joinChallenge.mutate(challengeId, {
        onSettled: () => setJoiningId(null),
      });
    },
    [joinChallenge],
  );

  // Split active challenges into ones the user hasn't joined yet
  const availableChallenges = useMemo(
    () => activeChallenges?.filter((c: Challenge) => !c.joined) ?? [],
    [activeChallenges],
  );

  const completedChallenges = useMemo(
    () => myChallenges?.filter((c) => c.completed) ?? [],
    [myChallenges],
  );

  const inProgressChallenges = useMemo(
    () => myChallenges?.filter((c) => !c.completed) ?? [],
    [myChallenges],
  );

  // Check if there's an active seasonal event
  const seasonalEvent = useMemo(() => {
    const seasonal = activeChallenges?.find((c: Challenge) => c.is_seasonal && c.season_name);
    return seasonal?.season_name ?? null;
  }, [activeChallenges]);

  return (
    <PageTransition>
    <div className="space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Challenges</h1>
        <p className="mt-1 text-zinc-300">
          Complete challenges to earn rewards and climb the leaderboard.
        </p>
      </div>

      {/* Seasonal event banner */}
      {seasonalEvent ? (
        <Card className="glass glass-highlight border border-primary bg-gradient-to-r from-primary/10 to-primary/5">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20">
              <Flame className="h-6 w-6 text-primary" aria-hidden="true" />
            </div>
            <div>
              <p className="text-lg font-bold">{seasonalEvent}</p>
              <p className="text-sm text-zinc-300">
                Seasonal event is live. Complete seasonal challenges for bonus rewards.
              </p>
            </div>
            <Badge variant="default" className="glass-badge ml-auto shrink-0">
              Live
            </Badge>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="available" className="space-y-4">
        <TabsList className="glass glass-highlight">
          <TabsTrigger value="available" className="min-h-[44px]">
            Available
            {availableChallenges.length > 0 ? (
              <Badge variant="secondary" className="glass-badge ml-2 text-xs">
                {String(availableChallenges.length)}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="in-progress" className="min-h-[44px]">
            In Progress
            {inProgressChallenges.length > 0 ? (
              <Badge variant="secondary" className="glass-badge ml-2 text-xs">
                {String(inProgressChallenges.length)}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="completed" className="min-h-[44px]">
            Completed
            {completedChallenges.length > 0 ? (
              <Badge variant="secondary" className="glass-badge ml-2 text-xs">
                {String(completedChallenges.length)}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* Available challenges */}
        <TabsContent value="available" className="space-y-4">
          {activeLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={`skel-avail-${String(i)}`} className="h-64 rounded-xl" />
              ))}
            </div>
          ) : availableChallenges.length === 0 ? (
            <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
              <CardContent className="flex flex-col items-center gap-3 py-12">
                <Trophy className="h-10 w-10 text-zinc-300" aria-hidden="true" />
                <p className="text-sm text-zinc-300">
                  No new challenges available right now. Check back soon.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {availableChallenges.map((challenge: Challenge) => (
                <ChallengeCard
                  key={challenge.id}
                  challenge={challenge}
                  onJoin={handleJoin}
                  joining={joiningId === challenge.id}
                  showLeaderboard={false}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* In-progress challenges */}
        <TabsContent value="in-progress" className="space-y-4">
          {myLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={`skel-prog-${String(i)}`} className="h-64 rounded-xl" />
              ))}
            </div>
          ) : inProgressChallenges.length === 0 ? (
            <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
              <CardContent className="flex flex-col items-center gap-3 py-12">
                <Trophy className="h-10 w-10 text-zinc-300" aria-hidden="true" />
                <p className="text-sm text-zinc-300">
                  You haven't joined any challenges yet. Browse available challenges to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {inProgressChallenges.map((challenge) => (
                <ChallengeCard
                  key={challenge.id}
                  challenge={{
                    ...challenge,
                    participant_count: 0,
                    max_participants: null,
                    joined: true,
                    my_progress: {
                      current_progress: challenge.current_progress,
                      percent_complete: challenge.percent_complete,
                      completed: challenge.completed,
                      reward_claimed: challenge.reward_claimed,
                      completed_at: challenge.completed_at,
                      joined_at: challenge.joined_at,
                    },
                  }}
                  showLeaderboard={false}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Completed challenges */}
        <TabsContent value="completed" className="space-y-4">
          {myLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={`skel-done-${String(i)}`} className="h-48 rounded-xl" />
              ))}
            </div>
          ) : completedChallenges.length === 0 ? (
            <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
              <CardContent className="flex flex-col items-center gap-3 py-12">
                <Trophy className="h-10 w-10 text-zinc-300" aria-hidden="true" />
                <p className="text-sm text-zinc-300">
                  No completed challenges yet. Keep working toward your goals.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {completedChallenges.map((challenge) => (
                <ChallengeCard
                  key={challenge.id}
                  challenge={{
                    ...challenge,
                    participant_count: 0,
                    max_participants: null,
                    joined: true,
                    my_progress: {
                      current_progress: challenge.current_progress,
                      percent_complete: challenge.percent_complete,
                      completed: challenge.completed,
                      reward_claimed: challenge.reward_claimed,
                      completed_at: challenge.completed_at,
                      joined_at: challenge.joined_at,
                    },
                  }}
                  showLeaderboard={false}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
    </PageTransition>
  );
}
