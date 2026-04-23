'use client';

import { Briefcase, CalendarDays, Clock, MapPin, Wrench } from 'lucide-react';

import { CheckInOut } from '@/components/providers/CheckInOut';
import { CompletionPhotos } from '@/components/providers/CompletionPhotos';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { useContracts } from '@/hooks/useContracts';
import { formatCents } from '@/lib/utils';
import { CONTRACT_STATUS } from '@/types';
import type { Contract } from '@/types';

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function formatScheduledDate(dateStr: string | undefined | null): string {
  if (!dateStr) return 'Flexible';
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatScheduledTime(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Returns date key like "2026-04-06" for grouping. */
function toDateKey(dateStr: string | undefined | null): string {
  if (!dateStr) return 'no-date';
  return new Date(dateStr).toISOString().slice(0, 10);
}

function isToday(dateStr: string | undefined | null): boolean {
  if (!dateStr) return false;
  const today = new Date().toISOString().slice(0, 10);
  return toDateKey(dateStr) === today;
}

function _isUpcoming(dateStr: string | undefined | null): boolean {
  if (!dateStr) return false;
  const now = new Date();
  const target = new Date(dateStr);
  const todayStart = new Date(now.toISOString().slice(0, 10));
  const sevenDaysOut = new Date(todayStart);
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  return target > todayStart && target <= sevenDaysOut;
}

function groupByDate(contracts: Contract[]): Array<{ dateKey: string; label: string; items: Contract[] }> {
  const map = new Map<string, Contract[]>();
  for (const c of contracts) {
    // Use created_at as a fallback date proxy for grouping
    const key = toDateKey(c.started_at ?? c.created_at);
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({
      dateKey: key,
      label:
        key === 'no-date'
          ? 'Flexible schedule'
          : new Date(key + 'T12:00:00').toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            }),
      items,
    }));
}

// ----------------------------------------------------------------
// JobCard — used in both Today and Upcoming sections
// ----------------------------------------------------------------

interface JobCardProps {
  contract: Contract;
  showWorkSession?: boolean;
}

function JobCard({ contract, showWorkSession = false }: JobCardProps) {
  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardContent className="space-y-4 p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-zinc-100">
              {contract.job_title}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-400">
              Contract #{contract.contract_number}
            </p>
          </div>
          <Badge
            variant="outline"
            className={
              contract.status === CONTRACT_STATUS.ACTIVE
                ? 'border-sky-500/40 text-sky-300'
                : 'border-amber-500/40 text-amber-300'
            }
          >
            {contract.status === CONTRACT_STATUS.ACTIVE ? 'In Progress' : 'Awarded'}
          </Badge>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
          {contract.started_at ? (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {formatScheduledTime(contract.started_at) || formatScheduledDate(contract.started_at)}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              {formatScheduledDate(contract.created_at)}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
            {formatCents(contract.amount_cents)}
          </span>
        </div>

        {/* Workspace actions — only shown for today's jobs */}
        {showWorkSession ? (
          <div className="space-y-3 border-t border-zinc-800 pt-3">
            <CheckInOut contractId={contract.id} />
            <CompletionPhotos contractId={contract.id} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------
// Skeletons
// ----------------------------------------------------------------

function JobCardSkeleton() {
  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-10 w-full rounded-lg" />
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------
// Main page
// ----------------------------------------------------------------

export default function ProviderWorkspacePage() {
  const { data: contractsData, isLoading } = useContracts({
    status: 'active',
    page: 1,
    page_size: 50,
  });

  const allContracts = contractsData?.contracts ?? [];

  // Split into today vs upcoming (next 7 days excl. today)
  const todayContracts = allContracts.filter(
    (c) =>
      c.status === CONTRACT_STATUS.ACTIVE &&
      (isToday(c.started_at) || isToday(c.created_at)),
  );

  const upcomingContracts = allContracts.filter(
    (c) =>
      c.status === CONTRACT_STATUS.ACTIVE &&
      !isToday(c.started_at) &&
      !isToday(c.created_at),
  );

  const upcomingGroups = groupByDate(upcomingContracts);

  return (
    <PageTransition>
      <div className="space-y-8">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <Wrench className="h-6 w-6 text-[var(--brand-gold)]" aria-hidden="true" />
          <div>
            <h1 className="gold-text text-2xl font-bold tracking-tight">Workspace</h1>
            <p className="text-zinc-400 text-sm">Check in, upload photos, and mark jobs complete.</p>
          </div>
        </div>

        {/* ── Today's Jobs ── */}
        <section aria-labelledby="today-heading">
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base" id="today-heading">
                <CalendarDays className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                Today&apos;s Jobs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <>
                  <JobCardSkeleton />
                  <JobCardSkeleton />
                </>
              ) : todayContracts.length === 0 ? (
                <div className="py-8 text-center">
                  <MapPin
                    className="mx-auto mb-3 h-8 w-8 text-zinc-600"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium text-zinc-400">
                    No jobs scheduled for today
                  </p>
                  <p className="mt-1 text-xs text-zinc-600">
                    Active jobs will appear here when they&apos;re scheduled for today.
                  </p>
                </div>
              ) : (
                todayContracts.map((contract) => (
                  <JobCard key={contract.id} contract={contract} showWorkSession />
                ))
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Upcoming (next 7 days) ── */}
        <section aria-labelledby="upcoming-heading">
          <div className="mb-4 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            <h2
              className="text-base font-semibold text-zinc-200"
              id="upcoming-heading"
            >
              Upcoming — Next 7 Days
            </h2>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-32" />
              <JobCardSkeleton />
              <JobCardSkeleton />
            </div>
          ) : upcomingGroups.length === 0 ? (
            <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
              <CardContent className="py-8 text-center">
                <CalendarDays
                  className="mx-auto mb-3 h-8 w-8 text-zinc-600"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-zinc-400">
                  No upcoming jobs in the next 7 days
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  New job awards will appear here automatically.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {upcomingGroups.map((group) => (
                <div key={group.dateKey} className="space-y-3">
                  <h3 className="text-sm font-semibold text-zinc-400">{group.label}</h3>
                  {group.items.map((contract) => (
                    <JobCard key={contract.id} contract={contract} showWorkSession={false} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </PageTransition>
  );
}
