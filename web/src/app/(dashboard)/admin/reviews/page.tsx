'use client';

import { useState } from 'react';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';
import type { Column } from '@/components/admin/DataTable';
import { DataTable } from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  useAdminFlaggedReviews,
  useResolveReviewFlag,
} from '@/hooks/useAdmin';
import { cn } from '@/lib/utils';
import type { FlaggedReview, FlagStatus } from '@/types';
import { FLAG_STATUS } from '@/types';

const ALL_FILTER = '__all__';

const FLAG_STATUS_CLASSES: Record<FlagStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  upheld: 'bg-red-100 text-red-800 border-red-200',
  dismissed: 'bg-green-100 text-green-800 border-green-200',
};

const FLAG_STATUS_LABELS: Record<FlagStatus, string> = {
  pending: 'Pending',
  upheld: 'Upheld',
  dismissed: 'Dismissed',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function renderStars(rating: number): string {
  return '\u2605'.repeat(rating) + '\u2606'.repeat(5 - rating);
}

export default function AdminReviewsPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(
    FLAG_STATUS.PENDING,
  );
  const [page, setPage] = useState(1);
  const [actionTarget, setActionTarget] = useState<{
    flag: FlaggedReview;
    action: 'uphold' | 'dismiss';
  } | null>(null);
  const [notes, setNotes] = useState('');

  const { data, isLoading, isError } = useAdminFlaggedReviews({
    status: statusFilter,
    page,
    page_size: 20,
  });

  const resolveMutation = useResolveReviewFlag();

  async function handleConfirmAction() {
    if (!actionTarget) return;
    await resolveMutation.mutateAsync({
      flagId: actionTarget.flag.id,
      action: actionTarget.action,
      notes,
    });
    setActionTarget(null);
    setNotes('');
  }

  const columns: Column<FlaggedReview>[] = [
    {
      key: 'review',
      header: 'Review Content',
      render: (flag) => (
        <div className="max-w-xs">
          <p className="line-clamp-2 text-sm">{flag.review_content}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            By {flag.reviewer_name} {renderStars(flag.review_rating)}
          </p>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Flag Reason',
      render: (flag) => (
        <span className="capitalize text-sm">{flag.reason.replace(/_/g, ' ')}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (flag) => (
        <Badge
          variant="outline"
          className={cn('text-xs', FLAG_STATUS_CLASSES[flag.status])}
        >
          {FLAG_STATUS_LABELS[flag.status]}
        </Badge>
      ),
    },
    {
      key: 'flagged_at',
      header: 'Flagged',
      render: (flag) => (
        <span className="text-muted-foreground">{formatDate(flag.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (flag) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="destructive"
            size="sm"
            className="min-h-[44px]"
            disabled={flag.status !== FLAG_STATUS.PENDING}
            onClick={(e) => {
              e.stopPropagation();
              setActionTarget({ flag, action: 'uphold' });
            }}
            aria-label="Uphold flag and remove review"
          >
            Uphold
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px]"
            disabled={flag.status !== FLAG_STATUS.PENDING}
            onClick={(e) => {
              e.stopPropagation();
              setActionTarget({ flag, action: 'dismiss' });
            }}
            aria-label="Dismiss flag and keep review"
          >
            Dismiss
          </Button>
        </div>
      ),
    },
  ];

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Flagged Reviews</h1>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load flagged reviews. Please try refreshing the page.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Flagged Reviews</h1>
        <p className="mt-1 text-muted-foreground">
          Review flagged content and take action on policy violations.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Status:</span>
        <Select
          value={statusFilter ?? ALL_FILTER}
          onValueChange={(v) => {
            setStatusFilter(v === ALL_FILTER ? undefined : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px] min-h-[44px]" aria-label="Filter flags by status">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>All Statuses</SelectItem>
            {Object.entries(FLAG_STATUS).map(([key, value]) => (
              <SelectItem key={key} value={value}>
                {FLAG_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={data?.flags ?? []}
        rowKey={(flag) => flag.id}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        loading={isLoading}
        emptyMessage="No flagged reviews found."
      />

      <ActionConfirmDialog
        open={actionTarget !== null}
        onClose={() => {
          setActionTarget(null);
          setNotes('');
        }}
        onConfirm={() => { void handleConfirmAction(); }}
        title={
          actionTarget?.action === 'uphold'
            ? 'Uphold Flag & Remove Review'
            : 'Dismiss Flag'
        }
        description={
          actionTarget?.action === 'uphold'
            ? 'This will remove the review from the platform. The reviewer will be notified.'
            : 'This will dismiss the flag. The review will remain on the platform.'
        }
        confirmLabel={actionTarget?.action === 'uphold' ? 'Remove Review' : 'Dismiss Flag'}
        destructive={actionTarget?.action === 'uphold'}
        loading={resolveMutation.isPending}
      >
        <div className="space-y-2">
          <label htmlFor="flag-notes" className="text-sm font-medium">
            Notes
          </label>
          <Textarea
            id="flag-notes"
            placeholder="Add notes for this decision..."
            value={notes}
            onChange={(e) => { setNotes(e.target.value); }}
            rows={3}
          />
        </div>
      </ActionConfirmDialog>
    </div>
  );
}
