'use client';

import {
  Award,
  Clock,
  Crown,
  Flame,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useCountdown } from '@/hooks/useCountdown';
import type { Challenge, ChallengeType, LeaderboardEntry, RewardType } from '@/types';

function getChallengeIcon(type: ChallengeType) {
  switch (type) {
    case 'jobs_completed':
      return Target;
    case 'five_star_reviews':
      return Star;
    case 'response_time':
      return Zap;
    case 'bid_win_rate':
      return Trophy;
    case 'revenue_milestone':
      return Crown;
    case 'category_specialist':
      return Award;
    default:
      return Target;
  }
}

function getRewardLabel(type: RewardType, value: string): string {
  switch (type) {
    case 'badge':
      return `Badge: ${value}`;
    case 'priority_placement':
      return `Priority Placement (${value.replace(/_/g, ' ')})`;
    case 'fee_discount':
      return `Fee Discount (${value.replace(/_/g, ' ')})`;
    case 'profile_highlight':
      return `Profile Highlight (${value.replace(/_/g, ' ')})`;
    default:
      return value;
  }
}

function getRewardIcon(type: RewardType) {
  switch (type) {
    case 'badge':
      return Award;
    case 'priority_placement':
      return Flame;
    case 'fee_discount':
      return Sparkles;
    case 'profile_highlight':
      return Star;
    default:
      return Award;
  }
}

interface ChallengeCardProps {
  challenge: Challenge;
  onJoin?: (challengeId: string) => void;
  joining?: boolean;
  leaderboard?: LeaderboardEntry[];
  showLeaderboard?: boolean;
}

export function ChallengeCard({
  challenge,
  onJoin,
  joining = false,
  leaderboard,
  showLeaderboard = true,
}: ChallengeCardProps) {
  const ChallengeIcon = getChallengeIcon(challenge.challenge_type);
  const RewardIcon = getRewardIcon(challenge.reward_type);

  const endTime = useMemo(
    () => new Date(Date.now() + challenge.time_remaining_seconds * 1000),
    [challenge.time_remaining_seconds],
  );
  const { timeLeft, isExpired, totalSeconds: timeRemaining } = useCountdown(endTime);

  const handleJoin = useCallback(() => {
    if (onJoin) {
      onJoin(challenge.id);
    }
  }, [onJoin, challenge.id]);

  const progress = challenge.my_progress;
  const isCompleted = progress?.completed ?? false;
  const percentComplete = progress?.percent_complete ?? 0;

  return (
    <Card className={challenge.is_seasonal ? 'border-primary/30 bg-primary/5' : ''}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${
              isCompleted
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-primary/10 text-primary'
            }`}
          >
            <ChallengeIcon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">{challenge.title}</CardTitle>
            {challenge.is_seasonal && challenge.season_name ? (
              <Badge variant="secondary" className="mt-1">
                {challenge.season_name}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" aria-hidden="true" />
          <span>{isExpired ? 'Ended' : `${timeLeft} left`}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{challenge.description}</p>

        {/* Reward */}
        <div className="flex items-center gap-2 text-sm">
          <RewardIcon className="h-4 w-4 text-amber-500" aria-hidden="true" />
          <span className="font-medium">
            {getRewardLabel(challenge.reward_type, challenge.reward_value)}
          </span>
        </div>

        {/* Progress or join */}
        {challenge.joined && progress ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {String(progress.current_progress)} / {String(challenge.target_value)}
              </span>
              <span className="font-medium">
                {isCompleted ? (
                  <span className="text-green-600 dark:text-green-400">Completed</span>
                ) : (
                  `${percentComplete.toFixed(0)}%`
                )}
              </span>
            </div>
            <Progress
              value={percentComplete}
              className="h-2"
              aria-label={`Challenge progress: ${percentComplete.toFixed(0)}%`}
            />
            {isCompleted && !progress.reward_claimed ? (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                Reward available to claim
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" aria-hidden="true" />
              <span>
                {String(challenge.participant_count)} participant
                {challenge.participant_count !== 1 ? 's' : ''}
              </span>
              {challenge.max_participants ? (
                <span> / {String(challenge.max_participants)} max</span>
              ) : null}
            </div>
            {onJoin ? (
              <Button
                size="sm"
                className="min-h-[44px]"
                onClick={handleJoin}
                disabled={joining || timeRemaining <= 0}
              >
                {joining ? 'Joining...' : 'Join Challenge'}
              </Button>
            ) : null}
          </div>
        )}

        {/* Leaderboard preview (top 3) */}
        {showLeaderboard && leaderboard && leaderboard.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Top Participants
            </p>
            <div className="space-y-1.5">
              {leaderboard.slice(0, 3).map((entry) => (
                <div
                  key={entry.provider_id}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="w-5 text-center text-xs font-bold text-muted-foreground">
                    {String(entry.rank)}
                  </span>
                  <Avatar className="h-6 w-6">
                    <AvatarImage
                      src={entry.avatar_url ?? undefined}
                      alt={entry.display_name}
                    />
                    <AvatarFallback className="text-xs">
                      {entry.display_name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate">{entry.display_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {String(entry.current_progress)} / {String(challenge.target_value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
