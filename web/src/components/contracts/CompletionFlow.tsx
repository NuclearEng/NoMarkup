'use client';

import { Check, CheckCircle, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useApproveCompletion, useMarkComplete, useRequestRevision } from '@/hooks/useContracts';
import { formatCents } from '@/lib/utils';
import { revisionNotesSchema } from '@/lib/validations';
import { useAuthStore } from '@/stores/auth-store';
import type { Contract } from '@/types';
import { MILESTONE_STATUS } from '@/types';

import { AutoReleaseTimer } from './AutoReleaseTimer';

interface CompletionFlowProps {
  contract: Contract;
}

export function CompletionFlow({ contract }: CompletionFlowProps) {
  const user = useAuthStore((state) => state.user);
  const isCustomer = user?.id === contract.customer_id;
  const isProvider = user?.id === contract.provider_id;

  const markComplete = useMarkComplete();
  const approveCompletion = useApproveCompletion();

  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Find a submitted milestone to use for revision requests (last one)
  const lastMilestone = contract.milestones.length > 0
    ? [...contract.milestones].sort((a, b) => b.sort_order - a.sort_order)[0]
    : undefined;

  const requestRevision = useRequestRevision();

  const allMilestonesApproved =
    contract.milestones.length > 0 &&
    contract.milestones.every((m) => m.status === MILESTONE_STATUS.APPROVED);

  const providerMarkedComplete = !!contract.completed_at;

  const approvedAmount = contract.milestones
    .filter((m) => m.status === MILESTONE_STATUS.APPROVED)
    .reduce((sum, m) => sum + m.amount_cents, 0);

  function handleMarkComplete() {
    markComplete.mutate(contract.id);
  }

  function handleApproveCompletion() {
    approveCompletion.mutate(contract.id);
  }

  function handleRequestRevision() {
    const result = revisionNotesSchema.safeParse(revisionNotes);
    if (!result.success) {
      setValidationError(result.error.errors[0]?.message ?? 'Invalid revision notes');
      return;
    }
    if (!lastMilestone) return;
    setValidationError(null);
    requestRevision.mutate(
      {
        milestoneId: lastMilestone.id,
        contractId: contract.id,
        revisionNotes,
      },
      {
        onSuccess: () => {
          setShowRevisionForm(false);
          setRevisionNotes('');
        },
      },
    );
  }

  if (!isCustomer && !isProvider) return null;

  // Provider view: show mark complete button when all milestones approved
  if (isProvider && !providerMarkedComplete && allMilestonesApproved) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Job Completion</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border bg-green-50 p-3 text-sm text-green-700">
            <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            All milestones have been approved.
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Approved</span>
              <span className="text-sm font-bold">{formatCents(approvedAmount)}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Milestones</span>
              <Badge variant="default">
                {String(contract.milestones.length)} / {String(contract.milestones.length)} Approved
              </Badge>
            </div>
          </div>

          <Button
            className="min-h-[44px] w-full"
            onClick={handleMarkComplete}
            disabled={markComplete.isPending}
          >
            {markComplete.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-4 w-4" aria-hidden="true" />
            )}
            Mark Work Complete
          </Button>
          {markComplete.isError ? (
            <p className="text-sm text-destructive">
              Failed to mark as complete. Please try again.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  // Provider view: already marked complete, waiting for customer
  if (isProvider && providerMarkedComplete) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Job Completion</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border bg-green-50 p-3 text-sm text-green-700">
            <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            You have marked this work as complete. Waiting for customer approval.
          </div>
          {contract.completed_at ? (
            <AutoReleaseTimer completedAt={contract.completed_at} />
          ) : null}
        </CardContent>
      </Card>
    );
  }

  // Customer view: provider has marked complete
  if (isCustomer && providerMarkedComplete) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Job Completion</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border bg-blue-50 p-3 text-sm text-blue-700">
            <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            The provider has marked this work as complete. Please review and approve or request a revision.
          </div>

          {/* Contract completion summary */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Contract Amount</span>
              <span className="text-sm font-bold">{formatCents(contract.amount_cents)}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Milestones Approved</span>
              <span className="text-sm font-medium">
                {String(contract.milestones.filter((m) => m.status === MILESTONE_STATUS.APPROVED).length)}{' '}
                / {String(contract.milestones.length)}
              </span>
            </div>
            {contract.completed_at ? (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Marked Complete</span>
                  <span className="text-sm font-medium">
                    {new Date(contract.completed_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </>
            ) : null}
          </div>

          {contract.completed_at ? (
            <AutoReleaseTimer completedAt={contract.completed_at} />
          ) : null}

          {/* Actions */}
          {showRevisionForm ? (
            <div className="space-y-3 border-t pt-4">
              <Textarea
                placeholder="Describe what changes are needed (minimum 10 characters)..."
                value={revisionNotes}
                onChange={(e) => {
                  setRevisionNotes(e.target.value);
                  setValidationError(null);
                }}
                className="min-h-[80px]"
              />
              {validationError ? (
                <p className="text-sm text-destructive">{validationError}</p>
              ) : null}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="min-h-[44px] flex-1"
                  onClick={handleRequestRevision}
                  disabled={requestRevision.isPending || !lastMilestone}
                >
                  {requestRevision.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  )}
                  Submit Revision Request
                </Button>
                <Button
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => {
                    setShowRevisionForm(false);
                    setRevisionNotes('');
                    setValidationError(null);
                  }}
                  disabled={requestRevision.isPending}
                >
                  Cancel
                </Button>
              </div>
              {requestRevision.isError ? (
                <p className="text-sm text-destructive">
                  Failed to request revision. Please try again.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex gap-3 border-t pt-4">
              <Button
                className="min-h-[44px] flex-1"
                onClick={handleApproveCompletion}
                disabled={approveCompletion.isPending}
              >
                {approveCompletion.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-4 w-4" aria-hidden="true" />
                )}
                Approve Completion
              </Button>
              <Button
                variant="outline"
                className="min-h-[44px]"
                onClick={() => { setShowRevisionForm(true); }}
                disabled={approveCompletion.isPending}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Request Revision
              </Button>
            </div>
          )}
          {approveCompletion.isError ? (
            <p className="text-sm text-destructive">
              Failed to approve completion. Please try again.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return null;
}
