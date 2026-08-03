'use client';

import { CheckCircle2, FileText, Lock, Upload, X } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useImageUpload } from '@/hooks/useImageUpload';
import {
  indexDocumentsByType,
  isDocumentResubmissionLocked,
  MAX_DOCUMENT_RESUBMISSIONS,
  resubmissionLockoutMessage,
  useProviderVerificationDocuments,
  useUploadVerificationDocument,
} from '@/hooks/useProviderProfile';
import { ApiError, getApiErrorMessage } from '@/lib/api';
import {
  ACCEPTED_DOCUMENT_EXTENSIONS,
  ACCEPTED_DOCUMENT_MIME_TYPES,
  type DocumentTypeConfig,
  documentTypeLabel,
  daysUntilExpiry,
  formatDocStatus,
  formatDocumentSize,
  isDocumentExpired,
  isDocumentExpiringSoon,
  MAX_DOCUMENT_SIZE_BYTES,
  PROVIDER_DOCUMENT_TYPES,
} from '@/lib/provider-verification-docs';
import { cn } from '@/lib/utils';
import type { ProviderVerificationDocument } from '@/types';

interface DocumentFile {
  file: File;
  name: string;
}

/**
 * Durable provider verification center (list + upload + FR-2.10 lockout).
 * Mirrors iOS `VerificationDocumentsView` using the same hooks as onboarding.
 */
export function VerificationDocumentsPanel() {
  const {
    data: existingDocs = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useProviderVerificationDocuments();

  const existingByType = indexDocumentsByType(existingDocs);
  const lockedTypes = PROVIDER_DOCUMENT_TYPES.filter((dt) =>
    isDocumentResubmissionLocked(existingByType[dt.key]?.resubmission_count),
  );

  const [pending, setPending] = useState<Record<string, DocumentFile>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const uploadImage = useImageUpload({
    context: 'document',
    maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES,
    acceptedTypes: [...ACCEPTED_DOCUMENT_MIME_TYPES],
  });
  const uploadDocument = useUploadVerificationDocument();

  const expiredDocs = existingDocs.filter((d) => isDocumentExpired(d.expires_at));
  const expiringSoonDocs = existingDocs.filter(
    (d) => isDocumentExpiringSoon(d.expires_at) && !isDocumentExpired(d.expires_at),
  );

  function handleFileSelect(docKey: string, file: File | undefined) {
    if (!file) return;

    if (isDocumentResubmissionLocked(existingByType[docKey]?.resubmission_count)) {
      setFieldErrors((prev) => ({
        ...prev,
        [docKey]:
          'This document type has no re-uploads left (maximum 3). Contact support to continue verification.',
      }));
      return;
    }

    if (!(ACCEPTED_DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
      setFieldErrors((prev) => ({
        ...prev,
        [docKey]: 'Please upload a JPG, PNG, WebP, or PDF file.',
      }));
      return;
    }

    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      setFieldErrors((prev) => ({
        ...prev,
        [docKey]: `File exceeds the ${formatDocumentSize(MAX_DOCUMENT_SIZE_BYTES)} limit.`,
      }));
      return;
    }

    setFieldErrors((prev) => {
      const { [docKey]: _removed, ...next } = prev;
      return next;
    });
    setPending((prev) => ({
      ...prev,
      [docKey]: { file, name: file.name },
    }));
  }

  function handleRemove(docKey: string) {
    setPending((prev) => {
      const { [docKey]: _removed, ...next } = prev;
      return next;
    });
    setFieldErrors((prev) => {
      const { [docKey]: _removed, ...next } = prev;
      return next;
    });
  }

  async function handleSubmit() {
    const entries = Object.entries(pending);
    if (entries.length === 0) {
      setSubmitError('Select at least one file to upload.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      for (const [docKey, docFile] of entries) {
        if (isDocumentResubmissionLocked(existingByType[docKey]?.resubmission_count)) {
          setFieldErrors((prev) => ({
            ...prev,
            [docKey]:
              'This document type has no re-uploads left (maximum 3). Contact support to continue verification.',
          }));
          setIsSubmitting(false);
          return;
        }

        const uploadOutcome = await uploadImage.upload(docFile.file);
        if (!uploadOutcome.ok) {
          setFieldErrors((prev) => ({
            ...prev,
            [docKey]: `Could not upload ${docFile.name}: ${uploadOutcome.error}`,
          }));
          setIsSubmitting(false);
          return;
        }

        try {
          await uploadDocument.mutateAsync({
            document_type: docKey,
            file_url: uploadOutcome.result.confirmedUrl,
            file_name: docFile.name,
            mime_type: docFile.file.type,
            size_bytes: docFile.file.size,
          });
        } catch (err) {
          if (err instanceof ApiError && err.status === 422) {
            const msg = resubmissionLockoutMessage(err);
            setFieldErrors((prev) => ({ ...prev, [docKey]: msg }));
            setSubmitError(msg);
          } else {
            setFieldErrors((prev) => ({
              ...prev,
              [docKey]: getApiErrorMessage(err, `Could not register ${docFile.name}.`),
            }));
            setSubmitError(getApiErrorMessage(err, 'Failed to upload documents. Please try again.'));
          }
          setIsSubmitting(false);
          return;
        }
      }

      setPending({});
      toast.success(
        entries.length === 1
          ? 'Document submitted for review'
          : `${String(entries.length)} documents submitted for review`,
      );
      void refetch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setSubmitError(resubmissionLockoutMessage(err));
      } else {
        setSubmitError(getApiErrorMessage(err, 'Failed to upload documents. Please try again.'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading verification documents">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        title="Couldn’t load documents"
        description={getApiErrorMessage(error, 'Something went wrong loading verification documents.')}
        action={
          <Button
            type="button"
            className="min-h-[44px]"
            onClick={() => {
              void refetch();
            }}
            disabled={isFetching}
          >
            Try again
          </Button>
        }
      />
    );
  }

  const hasPending = Object.keys(pending).length > 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-300">
        Upload a photo or PDF of your ID, insurance, or licenses for platform review. Accepted
        formats: JPG, PNG, WebP, PDF (max {formatDocumentSize(MAX_DOCUMENT_SIZE_BYTES)}). After a
        rejection you may re-upload up to {String(MAX_DOCUMENT_RESUBMISSIONS)} times per document
        type; after that, contact support — further uploads for that type are blocked. MIME type is
        re-checked server-side.
      </p>

      {expiredDocs.length > 0 || expiringSoonDocs.length > 0 ? (
        <div
          className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
          role="status"
        >
          {expiredDocs.length > 0 ? (
            <p className="font-medium text-destructive">
              {expiredDocs.length === 1
                ? '1 document has expired. Upload a renewed copy to restore verified status for new bids.'
                : `${String(expiredDocs.length)} documents have expired. Upload renewed copies to restore verified status for new bids.`}
            </p>
          ) : null}
          {expiringSoonDocs.length > 0 ? (
            <p className="text-amber-200">
              {expiringSoonDocs.length === 1
                ? '1 document expires within 30 days. Renew it before it lapses.'
                : `${String(expiringSoonDocs.length)} documents expire within 30 days. Renew them before they lapse.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {lockedTypes.length > 0 ? (
        <div
          className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            {lockedTypes.length === 1
              ? `${lockedTypes[0]?.label ?? 'One document type'} has no re-uploads left. Contact support to continue verification for that type.`
              : `${String(lockedTypes.length)} document types have no re-uploads left. Contact support to continue verification for those types.`}
          </p>
        </div>
      ) : null}

      {existingDocs.length > 0 ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">On file</CardTitle>
            <CardDescription className="text-zinc-400">
              {String(existingDocs.length)} document
              {existingDocs.length === 1 ? '' : 's'} submitted
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {existingDocs.map((doc) => (
              <ExistingDocumentRow key={doc.id ?? `${doc.document_type}-${doc.status}`} doc={doc} />
            ))}
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={<FileText className="h-8 w-8" aria-hidden="true" />}
          title="No documents yet"
          description="Upload a photo or PDF of your driver’s license, insurance, or trade license for platform review."
        />
      )}

      <div className="space-y-4">
        <h2 className="gold-text text-lg font-semibold">Upload or re-submit</h2>
        {PROVIDER_DOCUMENT_TYPES.map((docType) => (
          <DocumentUploadField
            key={docType.key}
            config={docType}
            document={pending[docType.key]}
            existing={existingByType[docType.key]}
            error={fieldErrors[docType.key]}
            locked={isDocumentResubmissionLocked(existingByType[docType.key]?.resubmission_count)}
            onFileSelect={(file) => {
              handleFileSelect(docType.key, file);
            }}
            onRemove={() => {
              handleRemove(docType.key);
            }}
          />
        ))}
      </div>

      {submitError ? (
        <p className="text-sm text-destructive" role="alert">
          {submitError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={isSubmitting || !hasPending}
          className="min-h-[44px]"
        >
          {isSubmitting ? 'Uploading…' : hasPending ? 'Submit for review' : 'Select files to upload'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          onClick={() => {
            void refetch();
          }}
          disabled={isFetching || isSubmitting}
        >
          Refresh status
        </Button>
      </div>
    </div>
  );
}

function ExistingDocumentRow({ doc }: { doc: ProviderVerificationDocument }) {
  const locked = isDocumentResubmissionLocked(doc.resubmission_count);
  const status = doc.status?.toLowerCase() ?? '';
  const resubmissionCount = doc.resubmission_count ?? 0;
  const showResubmission = resubmissionCount > 0 || status === 'rejected';
  const remaining = Math.max(0, MAX_DOCUMENT_RESUBMISSIONS - resubmissionCount);
  const days = daysUntilExpiry(doc.expires_at);
  const expired = isDocumentExpired(doc.expires_at);
  const expiringSoon = isDocumentExpiringSoon(doc.expires_at) && !expired;

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        locked ? 'border-destructive/30 bg-destructive/5' : 'border-[var(--brand-gold)]/10 bg-white/[0.03]',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100">{documentTypeLabel(doc.document_type)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {doc.status ? (
              <Badge
                variant={status === 'rejected' || status === 'expired' ? 'destructive' : 'secondary'}
                className="glass-badge text-xs capitalize"
              >
                {formatDocStatus(doc.status)}
              </Badge>
            ) : null}
            {locked ? (
              <Badge variant="destructive" className="glass-badge text-xs">
                Locked
              </Badge>
            ) : null}
          </div>
          {showResubmission ? (
            <p
              className={cn(
                'mt-1 text-xs',
                locked ? 'font-medium text-destructive' : 'text-zinc-400',
              )}
            >
              Resubmissions: {String(resubmissionCount)} of {String(MAX_DOCUMENT_RESUBMISSIONS)}
              {locked
                ? ' — contact support to continue'
                : remaining > 0
                  ? ` · ${String(remaining)} re-upload${remaining === 1 ? '' : 's'} left`
                  : null}
            </p>
          ) : null}
          {doc.rejection_reason ? (
            <p className="mt-1 text-xs text-destructive" role="status">
              {doc.rejection_reason}
            </p>
          ) : null}
          {doc.expires_at ? (
            <p
              className={cn(
                'mt-1 text-xs',
                expired
                  ? 'font-medium text-destructive'
                  : expiringSoon
                    ? 'font-medium text-amber-300'
                    : 'text-zinc-400',
              )}
            >
              {expired
                ? `Expired ${new Date(doc.expires_at).toLocaleDateString()}`
                : expiringSoon && days !== null
                  ? `Expires ${new Date(doc.expires_at).toLocaleDateString()} · ${String(days)} day${days === 1 ? '' : 's'} left`
                  : `Expires ${new Date(doc.expires_at).toLocaleDateString()}`}
            </p>
          ) : null}
        </div>
        {status === 'verified' ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" aria-label="Verified" />
        ) : null}
      </div>
    </div>
  );
}

function DocumentUploadField({
  config,
  document,
  existing,
  error,
  locked,
  onFileSelect,
  onRemove,
}: {
  config: DocumentTypeConfig;
  document: DocumentFile | undefined;
  existing: ProviderVerificationDocument | undefined;
  error: string | undefined;
  locked: boolean;
  onFileSelect: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!locked) setIsDragging(true);
    },
    [locked],
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (locked) return;
      const file = e.dataTransfer.files[0];
      onFileSelect(file);
    },
    [onFileSelect, locked],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (locked) return;
      const file = e.target.files?.[0];
      onFileSelect(file);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [onFileSelect, locked],
  );

  const openFilePicker = useCallback(() => {
    if (locked) return;
    fileInputRef.current?.click();
  }, [locked]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (locked) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openFilePicker();
      }
    },
    [openFilePicker, locked],
  );

  const isPdf = document?.file.type === 'application/pdf';
  const resubmissionCount = existing?.resubmission_count ?? 0;
  const showResubmission =
    resubmissionCount > 0 || existing?.status?.toLowerCase() === 'rejected';
  const remaining = Math.max(0, MAX_DOCUMENT_RESUBMISSIONS - resubmissionCount);

  return (
    <div
      className={cn(
        'glass rounded-lg border p-4',
        locked ? 'border-destructive/30 opacity-95' : 'border-[var(--brand-gold)]/10',
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={inputId} className="text-sm font-medium">
              {config.label}
            </label>
            <Badge variant={config.required ? 'default' : 'secondary'} className="glass-badge text-xs">
              {config.required ? 'Required' : 'Optional'}
            </Badge>
            {existing?.status ? (
              <Badge
                variant={existing.status.toLowerCase() === 'rejected' ? 'destructive' : 'secondary'}
                className="glass-badge text-xs capitalize"
              >
                {formatDocStatus(existing.status)}
              </Badge>
            ) : null}
            {locked ? (
              <Badge variant="destructive" className="glass-badge text-xs">
                Locked
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-zinc-300">{config.description}</p>
          {showResubmission ? (
            <p
              className={cn(
                'mt-1 text-xs',
                locked ? 'font-medium text-destructive' : 'text-zinc-400',
              )}
            >
              Resubmissions: {String(resubmissionCount)} of {String(MAX_DOCUMENT_RESUBMISSIONS)}
              {locked
                ? ' — contact support to continue'
                : remaining > 0
                  ? ` · ${String(remaining)} re-upload${remaining === 1 ? '' : 's'} left`
                  : null}
            </p>
          ) : null}
          {existing?.rejection_reason ? (
            <p className="mt-1 text-xs text-destructive" role="status">
              {existing.rejection_reason}
            </p>
          ) : null}
        </div>
        {document || (existing && !locked && existing.status?.toLowerCase() === 'verified') ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-label="Uploaded" />
        ) : null}
      </div>

      {locked ? (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="status"
        >
          Re-upload disabled for this document type after {String(MAX_DOCUMENT_RESUBMISSIONS)}{' '}
          rejections. Contact support to continue verification.
        </div>
      ) : document ? (
        <div className="flex items-center gap-3 rounded-md border border-[var(--brand-gold)]/10 bg-white/[0.04] p-3">
          <FileText className="h-8 w-8 shrink-0 text-zinc-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{document.name}</p>
            <p className="text-xs text-zinc-300">
              {formatDocumentSize(document.file.size)}
              {isPdf ? ' - PDF' : ` - ${document.file.type.replace('image/', '').toUpperCase()}`}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="min-h-[44px] min-w-[44px] shrink-0"
            aria-label={`Remove ${config.label}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Upload ${config.label}`}
          aria-disabled={locked}
          className={cn(
            'flex min-h-[80px] cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-4 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            isDragging
              ? 'border-[var(--brand-gold)]/40 bg-[var(--brand-gold)]/5'
              : 'border-white/10 hover:border-[var(--brand-gold)]/30 hover:bg-white/[0.04]',
          )}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={openFilePicker}
          onKeyDown={handleKeyDown}
        >
          <input
            ref={fileInputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED_DOCUMENT_EXTENSIONS}
            className="sr-only"
            onChange={handleInputChange}
            aria-hidden="true"
            tabIndex={-1}
            disabled={locked}
          />
          <Upload className="mb-1 h-5 w-5 text-zinc-300" aria-hidden="true" />
          <p className="text-sm text-zinc-300">
            {isDragging ? 'Drop file here' : 'Click or drag file to upload'}
          </p>
        </div>
      )}

      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert" aria-describedby={inputId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
