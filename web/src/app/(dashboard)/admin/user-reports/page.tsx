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
import {
  type AdminUserReport,
  useAdminUserReports,
  useResolveUserReport,
} from '@/hooks/useAdmin';

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
  harassment: 'Harassment',
  spam: 'Spam',
  scam: 'Scam',
  inappropriate: 'Inappropriate',
  other: 'Other',
};

type ResolveAction = 'dismiss' | 'actioned' | 'review';

export default function AdminUserReportsPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>('open');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<{
    report: AdminUserReport;
    action: ResolveAction;
  } | null>(null);
  const [notes, setNotes] = useState('');

  const { data, isLoading, isError } = useAdminUserReports({
    status: statusFilter,
    page,
    page_size: 20,
  });
  const resolveMutation = useResolveUserReport();

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

  const columns: Column<AdminUserReport>[] = [
    {
      key: 'target',
      header: 'Reported user',
      render: (r) => (
        <div>
          <p className="font-medium">
            {r.reported_user_email ?? r.reported_user_id.slice(0, 8)}
          </p>
          <p className="text-xs text-zinc-300">
            By: {r.reporter_email ?? r.reporter_id.slice(0, 8)}
            {r.channel_id ? ' · from chat' : ''}
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
      header: 'Details',
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
        <h1 className="gold-text text-2xl font-bold tracking-tight">User Reports</h1>
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
          <h1 className="gold-text text-2xl font-bold tracking-tight">User Reports</h1>
          <p className="mt-1 text-zinc-300">
            User-flagged abuse: harassment, spam, scams, inappropriate behavior.
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
              ? 'This marks the report as actioned. Pair with a user suspend/ban from /admin/users.'
              : 'This dismisses the report — no action is taken against the user.'
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
