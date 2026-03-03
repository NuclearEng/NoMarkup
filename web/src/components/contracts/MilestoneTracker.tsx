'use client';

import { Check, CircleDot, Clock, Loader2, MessageSquare, RotateCcw, Send } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useApproveMilestone, useRequestRevision, useSubmitMilestone } from '@/hooks/useContracts';
import { cn, formatCents } from '@/lib/utils';
import { revisionNotesSchema } from '@/lib/validations';
import { useAuthStore } from '@/stores/auth-store';
import type { Milestone } from '@/types';
import { MILESTONE_STATUS } from '@/types';

interface MilestoneTrackerProps {
  milestones: Milestone[];
  contractId: string;
  customerId: string;
  providerId: string;
}

const MAX_REVISIONS = 3;

function getMilestoneStatusColor(status: string): string {
  switch (status) {
    case MILESTONE_STATUS.PENDING:
      return 'bg-gray-400';
    case MILESTONE_STATUS.IN_PROGRESS:
      return 'bg-blue-500';
    case MILESTONE_STATUS.SUBMITTED:
      return 'bg-yellow-500';
    case MILESTONE_STATUS.APPROVED:
      return 'bg-green-500';
    case MILESTONE_STATUS.REVISION_REQUESTED:
      return 'bg-orange-500';
    case MILESTONE_STATUS.DISPUTED:
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
}

function getMilestoneStatusBadgeVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case MILESTONE_STATUS.APPROVED:
      return 'default';
    case MILESTONE_STATUS.IN_PROGRESS:
    case MILESTONE_STATUS.SUBMITTED:
      return 'secondary';
    case MILESTONE_STATUS.DISPUTED:
      return 'destructive';
    default:
      return 'outline';
  }
}

function getMilestoneStatusLabel(status: string): string {
  switch (status) {
    case MILESTONE_STATUS.PENDING:
      return 'Pending';
    case MILESTONE_STATUS.IN_PROGRESS:
      return 'In Progress';
    case MILESTONE_STATUS.SUBMITTED:
      return 'Submitted';
    case MILESTONE_STATUS.APPROVED:
      return 'Approved';
    case MILESTONE_STATUS.REVISION_REQUESTED:
      return 'Revision Requested';
    case MILESTONE_STATUS.DISPUTED:
      return 'Disputed';
    default:
      return status.replace(/_/g, ' ');
  }
}

function getMilestoneIcon(status: string) {
  switch (status) {
    case MILESTONE_STATUS.APPROVED:
      return <Check className="h-4 w-4 text-white" aria-hidden="true" />;
    case MILESTONE_STATUS.IN_PROGRESS:
      return <CircleDot className="h-4 w-4 text-white" aria-hidden="true" />;
    case MILESTONE_STATUS.SUBMITTED:
      return <Send className="h-4 w-4 text-white" aria-hidden="true" />;
    case MILESTONE_STATUS.REVISION_REQUESTED:
      return <RotateCcw className="h-4 w-4 text-white" aria-hidden="true" />;
    default:
      return <Clock className="h-4 w-4 text-white" aria-hidden="true" />;
  }
}

function MilestoneCard({
  milestone,
  contractId,
  isCustomer,
  isProvider,
  isLast,
}: {
  milestone: Milestone;
  contractId: string;
  isCustomer: boolean;
  isProvider: boolean;
  isLast: boolean;
}) {
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submitMilestone = useSubmitMilestone();
  const approveMilestone = useApproveMilestone();
  const requestRevision = useRequestRevision();

  function handleSubmit() {
    submitMilestone.mutate({ milestoneId: milestone.id, contractId });
  }

  function handleApprove() {
    approveMilestone.mutate({ milestoneId: milestone.id, contractId });
  }

  function handleRequestRevision() {
    const result = revisionNotesSchema.safeParse(revisionNotes);
    if (!result.success) {
      setValidationError(result.error.errors[0]?.message || 'Invalid revision notes');
      return;
    }
    setValidationError(null);
    requestRevision.mutate(
      { milestoneId: milestone.id, contractId, revisionNotes },
      {
        onSuccess: () => {
          setShowRevisionForm(false);
          setRevisionNotes('');
        },
      },
    );
  }

  const statusColor = getMilestoneStatusColor(milestone.status);

  return (
    <div className="flex gap-4">
      {/* Timeline indicator */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            statusColor,
          )}
        >
          {getMilestoneIcon(milestone.status)}
        </div>
        {!isLast ? (
          <div className={cn('w-0.5 flex-1 min-h-[24px]', statusColor === 'bg-green-500' ? 'bg-green-300' : 'bg-gray-200')} />
        ) : null}
      </div>

      {/* Milestone content */}
      <Card className="mb-4 flex-1">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                Milestone {String(milestone.sort_order)}
              </p>
              <p className="text-base font-semibold">{milestone.description}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Badge variant={getMilestoneStatusBadgeVariant(milestone.status)}>
                {getMilestoneStatusLabel(milestone.status)}
              </Badge>
              <span className="text-sm font-bold">{formatCents(milestone.amount_cents)}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Revision count */}
          {milestone.revision_count > 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              {String(milestone.revision_count)}/{String(MAX_REVISIONS)} revisions used
            </div>
          ) : null}

          {/* Revision notes from last request */}
          {milestone.status === MILESTONE_STATUS.REVISION_REQUESTED && milestone.revision_notes ? (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-orange-700">
                <MessageSquare className="h-3 w-3" aria-hidden="true" />
                Revision Notes
              </div>
              <p className="mt-1 text-sm text-orange-800">{milestone.revision_notes}</p>
            </div>
          ) : null}

          {/* Approved date */}
          {milestone.status === MILESTONE_STATUS.APPROVED && milestone.approved_at ? (
            <p className="text-xs text-muted-foreground">
              Approved on {new Date(milestone.approved_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          ) : null}

          {/* Submitted date */}
          {milestone.status === MILESTONE_STATUS.SUBMITTED && milestone.submitted_at ? (
            <p className="text-xs text-muted-foreground">
              Submitted on {new Date(milestone.submitted_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          ) : null}

          {/* Provider actions */}
          {isProvider && milestone.status === MILESTONE_STATUS.IN_PROGRESS ? (
            <div className="border-t pt-3">
              <Button
                className="min-h-[44px] w-full"
                onClick={handleSubmit}
                disabled={submitMilestone.isPending}
              >
                {submitMilestone.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
                Submit for Review
              </Button>
              {submitMilestone.isError ? (
                <p className="mt-2 text-sm text-destructive">
                  Failed to submit milestone. Please try again.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Provider can also submit revision_requested milestones */}
          {isProvider && milestone.status === MILESTONE_STATUS.REVISION_REQUESTED ? (
            <div className="border-t pt-3">
              <Button
                className="min-h-[44px] w-full"
                onClick={handleSubmit}
                disabled={submitMilestone.isPending}
              >
                {submitMilestone.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
                Resubmit for Review
              </Button>
              {submitMilestone.isError ? (
                <p className="mt-2 text-sm text-destructive">
                  Failed to submit milestone. Please try again.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Customer actions */}
          {isCustomer && milestone.status === MILESTONE_STATUS.SUBMITTED ? (
            <div className="space-y-3 border-t pt-3">
              {showRevisionForm ? (
                <div className="space-y-3">
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
                      disabled={requestRevision.isPending || milestone.revision_count >= MAX_REVISIONS}
                    >
                      {requestRevision.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      )}
                      Request Revision
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
                <div className="flex gap-3">
                  <Button
                    className="min-h-[44px] flex-1"
                    onClick={handleApprove}
                    disabled={approveMilestone.isPending}
                  >
                    {approveMilestone.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                    Approve
                  </Button>
                  {milestone.revision_count < MAX_REVISIONS ? (
                    <Button
                      variant="outline"
                      className="min-h-[44px]"
                      onClick={() => { setShowRevisionForm(true); }}
                      disabled={approveMilestone.isPending}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      Request Revision
                    </Button>
                  ) : null}
                </div>
              )}
              {approveMilestone.isError ? (
                <p className="text-sm text-destructive">
                  Failed to approve milestone. Please try again.
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function MilestoneTracker({ milestones, contractId, customerId, providerId }: MilestoneTrackerProps) {
  const user = useAuthStore((state) => state.user);
  const isCustomer = user?.id === customerId;
  const isProvider = user?.id === providerId;

  const sortedMilestones = [...milestones].sort((a, b) => a.sort_order - b.sort_order);

  if (sortedMilestones.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <p className="text-muted-foreground">No milestones defined for this contract.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">Milestones</h3>
      <div>
        {sortedMilestones.map((milestone, index) => (
          <MilestoneCard
            key={milestone.id}
            milestone={milestone}
            contractId={contractId}
            isCustomer={isCustomer}
            isProvider={isProvider}
            isLast={index === sortedMilestones.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
