'use client';

import { useState } from 'react';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';
import type { Column } from '@/components/admin/DataTable';
import { DataTable } from '@/components/admin/DataTable';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { type AdminJobReport, useAdminJobReports, useResolveJobReport } from '@/hooks/useAdmin';

const ALL_FILTER = '__all__';
const REPORT_STATUSES = ['open', 'reviewed', 'actioned', 'dismissed'] as const;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const REASON_LABEL: Record<string, string> = {
  prohibited: 'Prohibited',
  misleading: 'Misleading',
  spam: 'Spam',
  scam: 'Scam',
  harassment: 'Harassment',
  other: 'Other',
};

type ResolveAction = 'dismiss' | 'actioned' | 'review';

export default function AdminJobReportsPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>('open');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<{ report: AdminJobReport; action: ResolveAction } | null>(
    null,
  );
  const [notes, setNotes] = useState('');

  const { data, isLoading, isError } = useAdminJobReports({
    status: statusFilter,
    page,
    page_size: 20,
  });
  const resolveMutation = useResolveJobReport();

  async function handleConfirm() {
    if (!target) return;
    await resolveMutation.mutateAsync({
      reportId: target.report.id,
      action: target.action,
      notes,
    });
    setTarget(null);
    setNotes('');
  }

  const pagination = data?.pagination
    ? {
        totalCount: data.pagination.total,
        page: data.pagination.page,
        pageSize: data.pagination.page_size,
        totalPages: Math.max(
          1,
          Math.ceil(data.pagination.total / Math.max(1, data.pagination.page_size)),
        ),
        hasNext: data.pagination.page * data.pagination.page_size < data.pagination.total,
      }
    : undefined;

  const columns: Column<AdminJobReport>[] = [
    {
      key: 'job',
      header: 'Job',
      render: (r) => (
        <div>
          <p className="font-medium">{r.job_title || r.job_id.slice(0, 8)}</p>
          <p className="text-xs text-zinc-300">
            Reporter: {r.reporter_email ?? (r.reporter_id ? r.reporter_id.slice(0, 8) : 'anonymous')}
          </p>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      className: 'whitespace-nowrap',
      render: (r) => (
        <Badge variant="outline" className="capitalize">
          {REASON_LABEL[r.reason] ?? r.reason}
        </Badge>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (r) => (
        <span className="line-clamp-2 text-sm text-zinc-300">
          {r.description || <em className="text-zinc-500">no details</em>}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      className: 'whitespace-nowrap',
      render: (r) => (
        <Badge variant="outline" className="text-xs capitalize">
          {r.status}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Reported',
      className: 'whitespace-nowrap',
      render: (r) => <span className="text-zinc-300">{formatDate(r.created_at)}</span>,
    },
    {
      key: 'actions',
      sticky: true,
      header: 'Actions',
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px]"
            disabled={r.status !== 'open'}
            onClick={(e) => {
              e.stopPropagation();
              setTarget({ report: r, action: 'dismiss' });
            }}
          >
            Dismiss
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="min-h-[44px]"
            disabled={r.status !== 'open'}
            onClick={(e) => {
              e.stopPropagation();
              setTarget({ report: r, action: 'actioned' });
            }}
          >
            Take Action
          </Button>
        </div>
      ),
    },
  ];

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="gold-text text-2xl font-bold tracking-tight">Job Reports</h1>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load reports"
          description="Please try refreshing the page."
        />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Job Reports</h1>
          <p className="mt-1 text-zinc-300">
            Flagged jobs: prohibited, misleading, spam, scam, harassment.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-300">Status:</span>
          <Select
            value={statusFilter ?? ALL_FILTER}
            onValueChange={(v) => {
              setStatusFilter(v === ALL_FILTER ? undefined : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="min-h-[44px] w-[160px]" aria-label="Filter by status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All Statuses</SelectItem>
              {REPORT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DataTable
          columns={columns}
          data={data?.reports ?? []}
          rowKey={(r) => r.id}
          pagination={pagination}
          page={page}
          onPageChange={setPage}
          loading={isLoading}
          emptyMessage="No reports."
        />

        <ActionConfirmDialog
          open={target !== null}
          onClose={() => {
            setTarget(null);
            setNotes('');
          }}
          onConfirm={() => {
            void handleConfirm();
          }}
          title={target?.action === 'actioned' ? 'Take Action on Report' : 'Dismiss Report'}
          description={
            target?.action === 'actioned'
              ? 'This will mark the report as actioned. Pair with a job suspend/remove from /admin/jobs.'
              : 'This dismisses the report — the job remains visible.'
          }
          confirmLabel={target?.action === 'actioned' ? 'Take Action' : 'Dismiss'}
          destructive={target?.action === 'actioned'}
          loading={resolveMutation.isPending}
        >
          <div className="space-y-2">
            <label htmlFor="report-notes" className="text-sm font-medium">
              Notes (optional)
            </label>
            <Textarea
              id="report-notes"
              placeholder="Internal notes for the audit log..."
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              rows={3}
            />
          </div>
        </ActionConfirmDialog>
      </div>
    </PageTransition>
  );
}
