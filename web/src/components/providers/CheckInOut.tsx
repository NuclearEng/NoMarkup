'use client';

import { CheckCircle, Clock, LogIn, LogOut, MapPin } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCheckIn, useCheckOut, useWorkSession, WORK_SESSION_STATUS } from '@/hooks/useWorkspace';

interface CheckInOutProps {
  contractId: string;
  className?: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${String(h)}h ${String(m)}m`;
  if (h > 0) return `${String(h)}h`;
  return `${String(m)} min`;
}

export function CheckInOut({ contractId, className }: CheckInOutProps) {
  const { data: session, isLoading } = useWorkSession(contractId);
  const checkIn = useCheckIn(contractId);
  const checkOut = useCheckOut(contractId);

  const isWorking = checkIn.isPending || checkOut.isPending;

  if (isLoading) {
    return (
      <div className={className}>
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }

  // Checked-out state
  if (session?.status === WORK_SESSION_STATUS.CHECKED_OUT && session.duration_minutes !== null) {
    return (
      <div className={className}>
        <div
          className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
          role="status"
          aria-label={`Work complete — worked ${formatDuration(session.duration_minutes)}`}
        >
          <CheckCircle className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-300">Work session complete</p>
            <p className="text-zinc-400 text-xs">
              {session.checked_in_at ? formatTime(session.checked_in_at) : '—'}&nbsp;–&nbsp;
              {session.checked_out_at ? formatTime(session.checked_out_at) : '—'}
            </p>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 border-emerald-500/40 text-emerald-300 tabular-nums"
          >
            <Clock className="mr-1 h-3 w-3" aria-hidden="true" />
            {formatDuration(session.duration_minutes)}
          </Badge>
        </div>
      </div>
    );
  }

  // Checked-in state
  if (session?.status === WORK_SESSION_STATUS.CHECKED_IN && session.checked_in_at) {
    return (
      <div className={className}>
        <div className="flex items-center gap-3">
          <div
            className="flex flex-1 items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3"
            role="status"
            aria-label={`Checked in at ${formatTime(session.checked_in_at)}`}
          >
            <MapPin className="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-sky-300">Checked in</p>
              <p className="text-zinc-400 text-xs">Since {formatTime(session.checked_in_at)}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px] shrink-0 border-zinc-600 hover:border-red-500/50 hover:text-red-400"
            onClick={() => { checkOut.mutate(); }}
            disabled={isWorking}
            aria-label="Check out from this job"
          >
            {checkOut.isPending ? (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-label="Checking out…"
              />
            ) : (
              <>
                <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Check Out
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // Not started — ASR-5.1.5: purpose string before GPS check-in.
  // No manual / note-only check-in API exists; GPS is required.
  return (
    <div className={className}>
      <p className="mb-2 text-xs text-zinc-400">
        Location confirms you arrived at the job site. It is stored with the
        contract for dispute protection. GPS is required to check in.
      </p>
      <Button
        className="min-h-[44px] w-full"
        onClick={() => { checkIn.mutate(); }}
        disabled={isWorking}
        aria-label="Check in to this job using your current location"
      >
        {checkIn.isPending ? (
          <>
            <span
              className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            Getting location…
          </>
        ) : (
          <>
            <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
            Check In
          </>
        )}
      </Button>
    </div>
  );
}
