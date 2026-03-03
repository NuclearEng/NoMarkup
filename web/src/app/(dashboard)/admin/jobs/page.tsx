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
import { useAdminJobs, useRemoveJob, useSuspendJob } from '@/hooks/useAdmin';
import { cn, formatCents } from '@/lib/utils';
import type { Job } from '@/types';
import { JOB_STATUS } from '@/types';

const ALL_FILTER = '__all__';

const STATUS_CLASSES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 border-gray-200',
  active: 'bg-blue-100 text-blue-800 border-blue-200',
  closed: 'bg-gray-100 text-gray-800 border-gray-200',
  awarded: 'bg-green-100 text-green-800 border-green-200',
  in_progress: 'bg-purple-100 text-purple-800 border-purple-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200',
  suspended: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  expired: 'bg-gray-100 text-gray-800 border-gray-200',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AdminJobsPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [actionTarget, setActionTarget] = useState<{
    job: Job;
    action: 'suspend' | 'remove';
  } | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading, isError } = useAdminJobs({
    status: statusFilter,
    page,
    page_size: 20,
  });

  const suspendMutation = useSuspendJob();
  const removeMutation = useRemoveJob();

  async function handleConfirmAction() {
    if (!actionTarget) return;
    const mutation =
      actionTarget.action === 'suspend' ? suspendMutation : removeMutation;
    await mutation.mutateAsync({
      jobId: actionTarget.job.id,
      reason,
    });
    setActionTarget(null);
    setReason('');
  }

  const columns: Column<Job>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (job) => (
        <div>
          <p className="font-medium">{job.title}</p>
          <p className="text-xs text-muted-foreground">{job.category_name}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (job) => (
        <Badge
          variant="outline"
          className={cn('text-xs', STATUS_CLASSES[job.status] ?? '')}
        >
          {job.status.replace(/_/g, ' ')}
        </Badge>
      ),
    },
    {
      key: 'bids',
      header: 'Bids',
      render: (job) => (
        <span className="tabular-nums">{String(job.bid_count)}</span>
      ),
    },
    {
      key: 'lowest_bid',
      header: 'Lowest Bid',
      render: (job) => (
        <span className="tabular-nums">
          {job.lowest_bid_cents !== null
            ? formatCents(job.lowest_bid_cents)
            : '--'}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (job) => (
        <span className="text-muted-foreground">{formatDate(job.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (job) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px]"
            disabled={job.status === JOB_STATUS.SUSPENDED}
            onClick={(e) => {
              e.stopPropagation();
              setActionTarget({ job, action: 'suspend' });
            }}
            aria-label={`Suspend job: ${job.title}`}
          >
            Suspend
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="min-h-[44px]"
            onClick={(e) => {
              e.stopPropagation();
              setActionTarget({ job, action: 'remove' });
            }}
            aria-label={`Remove job: ${job.title}`}
          >
            Remove
          </Button>
        </div>
      ),
    },
  ];

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Job Management</h1>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load jobs. Please try refreshing the page.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Job Management</h1>
        <p className="mt-1 text-muted-foreground">
          Monitor and manage jobs across the platform.
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
          <SelectTrigger className="w-[180px] min-h-[44px]" aria-label="Filter jobs by status">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>All Statuses</SelectItem>
            {Object.entries(JOB_STATUS).map(([key, value]) => (
              <SelectItem key={key} value={value}>
                {value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={data?.jobs ?? []}
        rowKey={(job) => job.id}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        loading={isLoading}
        emptyMessage="No jobs found matching the current filters."
      />

      <ActionConfirmDialog
        open={actionTarget !== null}
        onClose={() => {
          setActionTarget(null);
          setReason('');
        }}
        onConfirm={() => { void handleConfirmAction(); }}
        title={
          actionTarget?.action === 'remove'
            ? 'Remove Job'
            : 'Suspend Job'
        }
        description={
          actionTarget?.action === 'remove'
            ? `Remove "${actionTarget.job.title}" from the platform? This cannot be undone.`
            : `Suspend "${actionTarget?.job.title ?? ''}"? The job will not be visible to providers.`
        }
        confirmLabel={actionTarget?.action === 'remove' ? 'Remove Job' : 'Suspend Job'}
        destructive
        loading={suspendMutation.isPending || removeMutation.isPending}
      >
        <div className="space-y-2">
          <label htmlFor="job-action-reason" className="text-sm font-medium">
            Reason
          </label>
          <Textarea
            id="job-action-reason"
            placeholder="Provide a reason for this action..."
            value={reason}
            onChange={(e) => { setReason(e.target.value); }}
            rows={3}
          />
        </div>
      </ActionConfirmDialog>
    </div>
  );
}
