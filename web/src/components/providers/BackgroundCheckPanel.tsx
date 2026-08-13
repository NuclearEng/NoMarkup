'use client';

import { ExternalLink, Shield } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  backgroundCheckErrorMessage,
  backgroundCheckInvitationURL,
  canStartBackgroundCheck,
  formatBackgroundCheckStatus,
  useBackgroundCheck,
  useStartBackgroundCheck,
} from '@/hooks/useBackgroundCheck';
import { useFeatureFlag } from '@/hooks/useFeatureFlags';
import { ApiError } from '@/lib/api';

function statusBadgeVariant(
  status: string,
): 'pending' | 'completed' | 'cancelled' | 'secondary' | 'in-progress' {
  switch (status) {
    case 'clear':
    case 'consider':
      return 'completed';
    case 'pending':
    case 'complete':
      return 'pending';
    case 'suspended':
    case 'canceled':
    case 'cancelled':
    case 'dispute':
      return 'cancelled';
    case 'not_started':
      return 'secondary';
    default:
      return 'in-progress';
  }
}

/**
 * FR-2.9 / F4 Checkr live path. Status is whatever the gateway stored from
 * Checkr — this panel never invents a pass.
 */
export function BackgroundCheckPanel() {
  const flagOn = useFeatureFlag('background_checks');
  const { data, isLoading, isError, error, refetch, isFetching } = useBackgroundCheck(flagOn);
  const start = useStartBackgroundCheck();

  if (!flagOn) {
    return null;
  }

  const status = (data?.status ?? 'not_started').toLowerCase();
  const invitationURL = backgroundCheckInvitationURL(data);
  const canStart = canStartBackgroundCheck(data?.status) && !start.isPending;
  const unavailable =
    isError && error instanceof ApiError && (error.status === 503 || error.status === 401);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-2">
          <Shield className="mt-0.5 h-5 w-5 text-[var(--brand-gold)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <CardTitle className="text-lg">Background check</CardTitle>
            <CardDescription>
              Start a Checkr invitation when the platform is configured. Status comes from Checkr
              — this page never invents a pass.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : unavailable ? (
          <p className="text-sm text-zinc-300" role="status">
            {backgroundCheckErrorMessage(
              error,
              'Background checks are not available right now.',
            )}
          </p>
        ) : isError ? (
          <div className="space-y-3">
            <p className="text-sm text-red-400" role="alert">
              {backgroundCheckErrorMessage(error, 'Could not load background check status.')}
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-zinc-400">Status</span>
              <Badge variant={statusBadgeVariant(status)}>{formatBackgroundCheckStatus(status)}</Badge>
            </div>

            {start.isError ? (
              <p className="text-sm text-red-400" role="alert">
                {backgroundCheckErrorMessage(
                  start.error,
                  'Could not start a background check.',
                )}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="min-h-[44px]"
                disabled={!canStart}
                onClick={() => start.mutate()}
              >
                {start.isPending ? 'Starting…' : 'Start background check'}
              </Button>
              {invitationURL ? (
                <Button variant="outline" asChild className="min-h-[44px]">
                  <a href={invitationURL} target="_blank" rel="noopener noreferrer">
                    Open Checkr
                    <ExternalLink className="ml-1.5 h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                className="min-h-[44px]"
                onClick={() => void refetch()}
                disabled={isFetching || start.isPending}
              >
                Refresh status
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
