'use client';

import { useState } from 'react';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';
import type { Column } from '@/components/admin/DataTable';
import { DataTable } from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useReviewDocument, useVerificationQueue } from '@/hooks/useAdmin';
import type { VerificationDocument } from '@/types';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'approved':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'rejected':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

export default function AdminVerificationPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useVerificationQueue(page, 20);
  const reviewMutation = useReviewDocument();

  const [reviewTarget, setReviewTarget] = useState<{
    doc: VerificationDocument;
    approved: boolean;
  } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  async function handleConfirmReview() {
    if (!reviewTarget) return;
    await reviewMutation.mutateAsync({
      documentId: reviewTarget.doc.id,
      approved: reviewTarget.approved,
      rejection_reason: reviewTarget.approved ? undefined : rejectionReason,
    });
    setReviewTarget(null);
    setRejectionReason('');
  }

  const columns: Column<VerificationDocument>[] = [
    {
      key: 'user',
      header: 'User',
      render: (doc) => (
        <div>
          <p className="font-medium">{doc.user_name}</p>
          <p className="text-xs text-muted-foreground font-mono">{doc.user_id.slice(0, 8)}...</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Document Type',
      render: (doc) => (
        <span className="capitalize">
          {doc.document_type.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (doc) => (
        <Badge variant="outline" className={statusBadgeClass(doc.status)}>
          {doc.status}
        </Badge>
      ),
    },
    {
      key: 'submitted',
      header: 'Submitted',
      render: (doc) => (
        <span className="text-muted-foreground">{formatDate(doc.submitted_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (doc) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="default"
            size="sm"
            className="min-h-[44px]"
            disabled={doc.status !== 'pending'}
            onClick={(e) => {
              e.stopPropagation();
              setReviewTarget({ doc, approved: true });
            }}
            aria-label={`Approve document from ${doc.user_name}`}
          >
            Approve
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="min-h-[44px]"
            disabled={doc.status !== 'pending'}
            onClick={(e) => {
              e.stopPropagation();
              setReviewTarget({ doc, approved: false });
            }}
            aria-label={`Reject document from ${doc.user_name}`}
          >
            Reject
          </Button>
        </div>
      ),
    },
  ];

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Verification Queue</h1>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load verification queue. Please try refreshing the page.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Verification Queue</h1>
        <p className="mt-1 text-muted-foreground">
          Review and approve provider verification documents.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={data?.documents ?? []}
        rowKey={(doc) => doc.id}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        loading={isLoading}
        emptyMessage="No documents pending review."
      />

      <ActionConfirmDialog
        open={reviewTarget !== null}
        onClose={() => {
          setReviewTarget(null);
          setRejectionReason('');
        }}
        onConfirm={() => { void handleConfirmReview(); }}
        title={
          reviewTarget?.approved
            ? 'Approve Verification Document'
            : 'Reject Verification Document'
        }
        description={
          reviewTarget?.approved
            ? `Approve the ${reviewTarget.doc.document_type.replace(/_/g, ' ')} for ${reviewTarget.doc.user_name}?`
            : `Reject the ${reviewTarget?.doc.document_type.replace(/_/g, ' ') ?? ''} for ${reviewTarget?.doc.user_name ?? ''}? Please provide a reason.`
        }
        confirmLabel={reviewTarget?.approved ? 'Approve' : 'Reject'}
        destructive={!reviewTarget?.approved}
        loading={reviewMutation.isPending}
      >
        {!reviewTarget?.approved ? (
          <div className="space-y-2">
            <label htmlFor="rejection-reason" className="text-sm font-medium">
              Rejection Reason
            </label>
            <Textarea
              id="rejection-reason"
              placeholder="Explain why this document was rejected..."
              value={rejectionReason}
              onChange={(e) => { setRejectionReason(e.target.value); }}
              rows={3}
            />
          </div>
        ) : null}
      </ActionConfirmDialog>
    </div>
  );
}
