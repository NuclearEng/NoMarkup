'use client';

import {
  Award,
  Calendar,
  CheckCircle2,
  Circle,
  Plus,
  Target,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAdminChallenges, useCreateChallenge } from '@/hooks/useChallenges';
import type { AdminChallenge, ChallengeType, CreateChallengeInput, RewardType } from '@/types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ChallengeRow({ challenge }: { challenge: AdminChallenge }) {
  return (
    <div className="flex items-center gap-4 rounded-md border p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        {challenge.is_active ? (
          <CheckCircle2 className="h-5 w-5 text-trust-high" aria-hidden="true" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium">{challenge.title}</p>
          {challenge.is_seasonal ? (
            <Badge variant="secondary">{challenge.season_name}</Badge>
          ) : null}
          <Badge variant={challenge.is_active ? 'default' : 'outline'}>
            {challenge.is_active ? 'Active' : 'Ended'}
          </Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{challenge.description}</p>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" aria-hidden="true" />
            {formatDate(challenge.starts_at)} - {formatDate(challenge.ends_at)}
          </span>
          <span className="flex items-center gap-1">
            <Target className="h-3 w-3" aria-hidden="true" />
            Target: {String(challenge.target_value)}
          </span>
          <span className="flex items-center gap-1">
            <Award className="h-3 w-3" aria-hidden="true" />
            {challenge.reward_type.replace(/_/g, ' ')}: {challenge.reward_value}
          </span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="flex items-center gap-1 text-sm">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{String(challenge.participant_count)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {String(challenge.completed_count)} completed
        </p>
      </div>
    </div>
  );
}

export function ChallengeManager() {
  const { data: challenges, isLoading } = useAdminChallenges();
  const createChallenge = useCreateChallenge();

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [challengeType, setChallengeType] = useState<ChallengeType>('jobs_completed');
  const [targetValue, setTargetValue] = useState('');
  const [rewardType, setRewardType] = useState<RewardType>('badge');
  const [rewardValue, setRewardValue] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [isSeasonal, setIsSeasonal] = useState(false);
  const [seasonName, setSeasonName] = useState('');
  const [maxParticipants, setMaxParticipants] = useState('');

  const resetForm = useCallback(() => {
    setTitle('');
    setDescription('');
    setChallengeType('jobs_completed');
    setTargetValue('');
    setRewardType('badge');
    setRewardValue('');
    setStartsAt('');
    setEndsAt('');
    setIsSeasonal(false);
    setSeasonName('');
    setMaxParticipants('');
    setShowForm(false);
  }, []);

  const handleSubmit = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      if (!title || !description || !targetValue || !rewardValue || !startsAt || !endsAt) {
        return;
      }

      const input: CreateChallengeInput = {
        title,
        description,
        challenge_type: challengeType,
        target_value: Number(targetValue),
        reward_type: rewardType,
        reward_value: rewardValue,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        is_seasonal: isSeasonal,
      };
      if (isSeasonal && seasonName) {
        input.season_name = seasonName;
      }
      if (maxParticipants) {
        input.max_participants = Number(maxParticipants);
      }

      createChallenge.mutate(input, {
        onSuccess: () => { resetForm(); },
      });
    },
    [
      title, description, challengeType, targetValue,
      rewardType, rewardValue, startsAt, endsAt,
      isSeasonal, seasonName, maxParticipants,
      createChallenge, resetForm,
    ],
  );

  const activeCount = challenges?.filter((c: AdminChallenge) => c.is_active).length ?? 0;
  const totalParticipants = challenges?.reduce(
    (sum: number, c: AdminChallenge) => sum + c.participant_count, 0,
  ) ?? 0;

  return (
    <div className="space-y-6">
      {/* Summary metrics */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Challenges
            </CardTitle>
            <Trophy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-2xl font-bold tabular-nums">
                {String(challenges?.length ?? 0)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Now
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-2xl font-bold tabular-nums">{String(activeCount)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Participants
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-2xl font-bold tabular-nums">{String(totalParticipants)}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create new / list */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">All Challenges</h2>
        <Button
          className="min-h-[44px]"
          onClick={() => { setShowForm(!showForm); }}
        >
          {showForm ? (
            <>
              <X className="mr-2 h-4 w-4" aria-hidden="true" />
              Cancel
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              New Challenge
            </>
          )}
        </Button>
      </div>

      {/* Create form */}
      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create Challenge</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="challenge-title">Title</Label>
                  <Input
                    id="challenge-title"
                    value={title}
                    onChange={(e) => { setTitle(e.target.value); }}
                    placeholder="e.g. Speed Demon"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="challenge-type">Challenge Type</Label>
                  <Select
                    value={challengeType}
                    onValueChange={(v) => { setChallengeType(v as ChallengeType); }}
                  >
                    <SelectTrigger id="challenge-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="jobs_completed">Jobs Completed</SelectItem>
                      <SelectItem value="five_star_reviews">Five Star Reviews</SelectItem>
                      <SelectItem value="response_time">Response Time</SelectItem>
                      <SelectItem value="bid_win_rate">Bid Win Rate</SelectItem>
                      <SelectItem value="revenue_milestone">Revenue Milestone</SelectItem>
                      <SelectItem value="category_specialist">Category Specialist</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="challenge-description">Description</Label>
                <Textarea
                  id="challenge-description"
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); }}
                  placeholder="Describe what the provider needs to achieve..."
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="target-value">Target Value</Label>
                  <Input
                    id="target-value"
                    type="number"
                    min="1"
                    value={targetValue}
                    onChange={(e) => { setTargetValue(e.target.value); }}
                    placeholder="e.g. 10"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reward-type">Reward Type</Label>
                  <Select
                    value={rewardType}
                    onValueChange={(v) => { setRewardType(v as RewardType); }}
                  >
                    <SelectTrigger id="reward-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="badge">Badge</SelectItem>
                      <SelectItem value="priority_placement">Priority Placement</SelectItem>
                      <SelectItem value="fee_discount">Fee Discount</SelectItem>
                      <SelectItem value="profile_highlight">Profile Highlight</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reward-value">Reward Value</Label>
                  <Input
                    id="reward-value"
                    value={rewardValue}
                    onChange={(e) => { setRewardValue(e.target.value); }}
                    placeholder="e.g. Rising Star"
                    required
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="starts-at">Starts At</Label>
                  <Input
                    id="starts-at"
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => { setStartsAt(e.target.value); }}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ends-at">Ends At</Label>
                  <Input
                    id="ends-at"
                    type="datetime-local"
                    value={endsAt}
                    onChange={(e) => { setEndsAt(e.target.value); }}
                    required
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex items-center gap-3">
                  <Switch
                    id="is-seasonal"
                    checked={isSeasonal}
                    onCheckedChange={setIsSeasonal}
                  />
                  <Label htmlFor="is-seasonal">Seasonal Event</Label>
                </div>
                {isSeasonal ? (
                  <div className="space-y-2">
                    <Label htmlFor="season-name">Season Name</Label>
                    <Input
                      id="season-name"
                      value={seasonName}
                      onChange={(e) => { setSeasonName(e.target.value); }}
                      placeholder="e.g. Spring Sprint 2026"
                    />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="max-participants">Max Participants (optional)</Label>
                  <Input
                    id="max-participants"
                    type="number"
                    min="1"
                    value={maxParticipants}
                    onChange={(e) => { setMaxParticipants(e.target.value); }}
                    placeholder="Unlimited"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={resetForm}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="min-h-[44px]"
                  disabled={createChallenge.isPending}
                >
                  {createChallenge.isPending ? 'Creating...' : 'Create Challenge'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* Challenge list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={`skel-admin-${String(i)}`} className="h-24" />
          ))}
        </div>
      ) : !challenges || challenges.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Trophy className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              No challenges created yet. Click "New Challenge" to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {challenges.map((challenge: AdminChallenge) => (
            <ChallengeRow key={challenge.id} challenge={challenge} />
          ))}
        </div>
      )}
    </div>
  );
}
