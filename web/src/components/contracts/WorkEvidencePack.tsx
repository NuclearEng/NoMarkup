'use client';

import { Camera, Clock, Loader2, LockOpen } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePayments, useReleaseEscrow } from '@/hooks/usePayments';
import {
  parseProofOfWorkMissing,
  proofOfWorkBlockedMessage,
  proofOfWorkMissingListLabel,
  useWorkEvidence,
  type WorkEvidencePhoto,
  type WorkEvidenceSession,
} from '@/hooks/useWorkEvidence';
import { getApiErrorMessage } from '@/lib/api';
import { isAllowedChatMediaUrl } from '@/lib/chat-media';
import { formatCents } from '@/lib/utils';
import { PAYMENT_STATUS } from '@/types';

interface WorkEvidencePackProps {
  contractId: string;
  isCustomer: boolean;
  isProvider: boolean;
}

function formatSessionTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0 min';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${String(hours)}h ${String(mins)}m`;
  return `${String(mins)} min`;
}

function SessionRow({ session }: { session: WorkEvidenceSession }) {
  const inProgress = !session.checked_out_at;
  return (
    <li className="rounded-lg border border-[var(--brand-gold)]/10 bg-zinc-900/40 px-3 py-3">
      <div className="flex items-start gap-2">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-gold)]" aria-hidden="true" />
        <div className="min-w-0 space-y-1 text-sm">
          <p>
            <span className="text-zinc-400">Checked in </span>
            <time dateTime={session.checked_in_at}>{formatSessionTime(session.checked_in_at)}</time>
          </p>
          {session.checked_out_at ? (
            <p>
              <span className="text-zinc-400">Checked out </span>
              <time dateTime={session.checked_out_at}>
                {formatSessionTime(session.checked_out_at)}
              </time>
            </p>
          ) : (
            <p className="text-zinc-400">Still on site</p>
          )}
          <p className="tabular-nums text-zinc-300">
            {inProgress ? 'In progress' : formatDuration(session.duration_minutes)}
          </p>
        </div>
      </div>
    </li>
  );
}

function PhotoThumb({ photo }: { photo: WorkEvidencePhoto }) {
  const allowed = isAllowedChatMediaUrl(photo.url);
  const phaseLabel = photo.phase === 'after' ? 'After' : photo.phase === 'before' ? 'Before' : photo.phase;
  return (
    <li className="min-w-0">
      {allowed ? (
        // eslint-disable-next-line @next/next/no-img-element -- allowlisted object-storage / fixture hosts only
        <img
          src={photo.url.trim()}
          alt={`${phaseLabel} completion photo`}
          className="h-28 w-full rounded-lg border border-[var(--brand-gold)]/10 object-cover"
        />
      ) : (
        <div className="flex h-28 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 text-center text-xs text-zinc-400">
          {phaseLabel} photo unavailable
        </div>
      )}
      <p className="mt-1 text-xs text-zinc-400">
        {phaseLabel}
        {photo.uploaded_at ? ` · ${formatSessionTime(photo.uploaded_at)}` : ''}
      </p>
    </li>
  );
}

export function WorkEvidencePack({
  contractId,
  isCustomer,
  isProvider,
}: WorkEvidencePackProps) {
  const { data, isLoading, isError, refetch } = useWorkEvidence(contractId);
  const { data: paymentsData } = usePayments({
    status: PAYMENT_STATUS.ESCROW,
    per_page: 50,
  });
  const release = useReleaseEscrow();
  const [releaseError, setReleaseError] = useState<string | null>(null);

  const escrowPayments = (paymentsData?.payments ?? []).filter(
    (payment) => payment.contract_id === contractId && payment.status === PAYMENT_STATUS.ESCROW,
  );

  if (isLoading) {
    return (
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardContent className="space-y-3 py-6" role="status" aria-label="Loading work evidence">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader>
          <h3 className="gold-text text-sm font-medium">Proof of work</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-zinc-300">Could not load work evidence. Please try again.</p>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            onClick={() => {
              void refetch();
            }}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const ready = data.ready_for_release;
  const missing = data.missing ?? [];
  const blockedCopy = proofOfWorkBlockedMessage(missing);
  const sessions = data.sessions ?? [];
  const photos = data.photos ?? [];

  function handleRelease(paymentId: string) {
    setReleaseError(null);
    release.mutate(
      { paymentId, reason: 'customer approved completion' },
      {
        onError: (err) => {
          const tokens = parseProofOfWorkMissing(err);
          setReleaseError(
            tokens !== null
              ? proofOfWorkBlockedMessage(tokens)
              : getApiErrorMessage(err, 'Failed to release escrow'),
          );
        },
      },
    );
  }

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader>
        <h3 className="gold-text text-sm font-medium">Proof of work</h3>
        <p className="text-xs text-zinc-400">
          Check-in times and completion photos. Location is not shown.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <section aria-labelledby="work-evidence-sessions">
          <h4 id="work-evidence-sessions" className="mb-2 text-sm font-medium">
            Work sessions
          </h4>
          {sessions.length === 0 ? (
            <p className="text-sm text-zinc-400">No check-in recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((session, index) => (
                <SessionRow
                  key={`${session.checked_in_at}-${String(index)}`}
                  session={session}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="work-evidence-photos">
          <h4 id="work-evidence-photos" className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Camera className="h-4 w-4" aria-hidden="true" />
            Completion photos
          </h4>
          {photos.length === 0 ? (
            <p className="text-sm text-zinc-400">No completion photos uploaded yet.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((photo, index) => (
                <PhotoThumb key={`${photo.phase}-${photo.uploaded_at}-${String(index)}`} photo={photo} />
              ))}
            </ul>
          )}
        </section>

        {!ready && missing.length > 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-sm text-amber-200">{blockedCopy}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-100/90">
              {missing.map((token) => (
                <li key={token}>{proofOfWorkMissingListLabel(token)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {ready ? (
          <p className="text-sm text-emerald-400">Check-in and after photo are on file.</p>
        ) : null}

        {isCustomer && escrowPayments.length > 0
          ? escrowPayments.map((payment) => (
              <div key={payment.id} className="space-y-2">
                <Button
                  type="button"
                  className="min-h-[44px] w-full gap-2"
                  disabled={!ready || release.isPending}
                  aria-disabled={!ready || release.isPending}
                  onClick={() => {
                    handleRelease(payment.id);
                  }}
                >
                  {release.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <LockOpen className="h-4 w-4" aria-hidden="true" />
                  )}
                  Release escrow · {formatCents(payment.amount_cents)}
                </Button>
                {!ready ? (
                  <p className="text-sm text-zinc-400" role="status">
                    {blockedCopy}
                  </p>
                ) : null}
              </div>
            ))
          : null}

        {isProvider && escrowPayments.length > 0 ? (
          <p className="text-sm text-zinc-400">
            Waiting for the customer to release escrow. You cannot release your own payout.
          </p>
        ) : null}

        {releaseError ? (
          <p className="text-destructive text-sm" role="alert">
            {releaseError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
