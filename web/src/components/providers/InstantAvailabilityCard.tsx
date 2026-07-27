'use client';

import { Loader2, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  type AvailabilityWindowInput,
  useProviderProfile,
  useSetAvailability,
} from '@/hooks/useProviderProfile';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const WEEK_DAYS = [
  { code: 'mon', label: 'Monday' },
  { code: 'tue', label: 'Tuesday' },
  { code: 'wed', label: 'Wednesday' },
  { code: 'thu', label: 'Thursday' },
  { code: 'fri', label: 'Friday' },
  { code: 'sat', label: 'Saturday' },
  { code: 'sun', label: 'Sunday' },
] as const;

type DayCode = (typeof WEEK_DAYS)[number]['code'];

interface DayDraft {
  enabled: boolean;
  start: string;
  end: string;
}

function blankWeek(): Record<DayCode, DayDraft> {
  const out = {} as Record<DayCode, DayDraft>;
  for (const d of WEEK_DAYS) {
    out[d.code] = { enabled: false, start: '09:00', end: '17:00' };
  }
  return out;
}

function hydrateFromSchedule(
  schedule: { day: string; start_time: string; end_time: string }[] | undefined,
): Record<DayCode, DayDraft> {
  const next = blankWeek();
  if (!schedule?.length) return next;
  for (const w of schedule) {
    const day = w.day.trim().toLowerCase() as DayCode;
    if (!(day in next)) continue;
    const start = w.start_time.trim();
    const end = w.end_time.trim();
    if (!start || !end) continue;
    next[day] = { enabled: true, start, end };
  }
  return next;
}

function buildWindows(draft: Record<DayCode, DayDraft>): AvailabilityWindowInput[] {
  const windows: AvailabilityWindowInput[] = [];
  for (const d of WEEK_DAYS) {
    const row = draft[d.code];
    if (!row.enabled) continue;
    if (row.start >= row.end) {
      throw new Error(`${d.label}: end time must be after start time.`);
    }
    windows.push({
      day: d.code,
      start_time: row.start,
      end_time: row.end,
    });
  }
  return windows;
}

/**
 * Provider Instant program: available-now toggle + weekly schedule editor.
 * PUT `/providers/me/availability` with correct wire keys (`enabled`,
 * `available_now`, `schedule`). Always re-sends schedule so toggles do not
 * wipe saved windows.
 */
export function InstantAvailabilityCard({ className }: { className?: string }) {
  const { data: profile, isLoading } = useProviderProfile();
  const setAvailability = useSetAvailability();

  const [availableNow, setAvailableNow] = useState(false);
  const [days, setDays] = useState<Record<DayCode, DayDraft>>(() => blankWeek());
  // Track last hydrated profile identity so we re-seed after query invalidation
  // without fighting in-progress local edits on every render.
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    const key = `${profile.id}|${String(profile.instant_available)}|${JSON.stringify(profile.schedule ?? [])}`;
    if (key === hydratedKey) return;
    setAvailableNow(Boolean(profile.instant_available));
    setDays(hydrateFromSchedule(profile.schedule));
    setHydratedKey(key);
  }, [profile, hydratedKey]);

  const enabledDays = useMemo(
    () => WEEK_DAYS.filter((d) => days[d.code].enabled).length,
    [days],
  );

  async function persist(nextAvailable: boolean, nextDays: Record<DayCode, DayDraft>) {
    let schedule: AvailabilityWindowInput[];
    try {
      schedule = buildWindows(nextDays);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid schedule');
      return;
    }

    const enabled =
      nextAvailable || schedule.length > 0 || Boolean(profile?.instant_enabled);

    try {
      await setAvailability.mutateAsync({
        enabled,
        available_now: nextAvailable,
        schedule,
      });
      toast.success(
        nextAvailable
          ? 'You are available for Instant match'
          : schedule.length > 0
            ? 'Weekly Instant schedule saved'
            : 'Instant availability updated',
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update Instant availability'));
    }
  }

  async function onToggleAvailable(checked: boolean) {
    setAvailableNow(checked);
    await persist(checked, days);
  }

  async function onSaveSchedule() {
    await persist(availableNow, days);
  }

  if (isLoading && !profile) {
    return (
      <Card className={cn('glass glass-highlight border border-[var(--brand-gold)]/10', className)}>
        <CardContent className="flex min-h-[120px] items-center justify-center p-6">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" aria-hidden="true" />
          <span className="sr-only">Loading Instant availability</span>
        </CardContent>
      </Card>
    );
  }

  if (!profile) {
    return null;
  }

  const busy = setAvailability.isPending;

  return (
    <Card className={cn('glass glass-highlight border border-[var(--brand-gold)]/10', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
            <Zap className="h-4 w-4 text-amber-400" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base text-zinc-100">Instant availability</CardTitle>
            <CardDescription className="text-zinc-400">
              Mark available now and optional weekly windows for emergency Instant match offers.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3">
          <div className="min-w-0">
            <Label htmlFor="instant-available-now" className="text-sm font-medium text-zinc-100">
              Available now
            </Label>
            <p className="text-xs text-zinc-400">
              Show as ready for Instant match job offers.
              {profile.instant_enabled ? ' Instant program enabled.' : ' Program enables when you go live or save a schedule.'}
            </p>
          </div>
          <Switch
            id="instant-available-now"
            checked={availableNow}
            disabled={busy}
            onCheckedChange={(checked) => {
              void onToggleAvailable(checked);
            }}
            aria-label="Available now for Instant match"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-zinc-200">Weekly schedule</p>
            <p className="text-xs text-zinc-500">
              {enabledDays === 0 ? 'No days set' : `${String(enabledDays)} day${enabledDays === 1 ? '' : 's'}`}
            </p>
          </div>
          <ul className="space-y-2" aria-label="Weekly Instant availability windows">
            {WEEK_DAYS.map((d) => {
              const row = days[d.code];
              return (
                <li
                  key={d.code}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-white/[0.04] px-2 py-2"
                >
                  <div className="flex min-w-[7.5rem] items-center gap-2">
                    <Switch
                      id={`instant-day-${d.code}`}
                      checked={row.enabled}
                      disabled={busy}
                      onCheckedChange={(checked) => {
                        setDays((prev) => ({
                          ...prev,
                          [d.code]: { ...prev[d.code], enabled: checked },
                        }));
                      }}
                      aria-label={`${d.label} available`}
                    />
                    <Label
                      htmlFor={`instant-day-${d.code}`}
                      className="text-sm text-zinc-200"
                    >
                      {d.label}
                    </Label>
                  </div>
                  {row.enabled ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Label htmlFor={`instant-start-${d.code}`} className="sr-only">
                        {d.label} start
                      </Label>
                      <Input
                        id={`instant-start-${d.code}`}
                        type="time"
                        value={row.start}
                        disabled={busy}
                        className="min-h-[44px] w-[7.5rem]"
                        onChange={(e) => {
                          const v = e.target.value;
                          setDays((prev) => ({
                            ...prev,
                            [d.code]: { ...prev[d.code], start: v },
                          }));
                        }}
                      />
                      <span className="text-xs text-zinc-500">to</span>
                      <Label htmlFor={`instant-end-${d.code}`} className="sr-only">
                        {d.label} end
                      </Label>
                      <Input
                        id={`instant-end-${d.code}`}
                        type="time"
                        value={row.end}
                        disabled={busy}
                        className="min-h-[44px] w-[7.5rem]"
                        onChange={(e) => {
                          const v = e.target.value;
                          setDays((prev) => ({
                            ...prev,
                            [d.code]: { ...prev[d.code], end: v },
                          }));
                        }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <Button
            type="button"
            className="min-h-[48px] w-full sm:w-auto"
            disabled={busy}
            onClick={() => {
              void onSaveSchedule();
            }}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              'Save weekly schedule'
            )}
          </Button>
          <p className="text-xs text-zinc-500">
            Local time windows (HH:MM). Available now still works without a schedule.
            Empty schedule clears previously saved windows.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
