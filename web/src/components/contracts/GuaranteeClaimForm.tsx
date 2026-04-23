'use client';

import { ImagePlus, Loader2, X } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useRef, useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useSubmitGuaranteeClaim } from '@/hooks/useGuarantee';

const CLAIM_REASONS = {
  QUALITY: 'quality',
  INCOMPLETE_WORK: 'incomplete_work',
  DAMAGE: 'damage',
  NO_SHOW: 'no_show',
} as const;

const CLAIM_REASON_LABELS: Record<string, string> = {
  quality: 'Quality Issue',
  incomplete_work: 'Incomplete Work',
  damage: 'Property Damage',
  no_show: 'No-Show',
};

const claimSchema = z.object({
  reason: z.string().min(1, 'Claim type is required'),
  description: z.string().min(50, 'Description must be at least 50 characters').max(5000),
  evidence_urls: z.array(z.string().url()).min(1, 'At least 1 photo is required'),
});

interface GuaranteeClaimFormProps {
  contractId: string;
  onSuccess: () => void;
  className?: string;
}

export function GuaranteeClaimForm({ contractId, onSuccess, className }: GuaranteeClaimFormProps) {
  const submitClaim = useSubmitGuaranteeClaim();

  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  const imageUpload = useImageUpload({
    context: 'document',
    onSuccess: (result) => {
      setEvidenceUrls((prev) => [...prev, result.confirmedUrl]);
      if (errors['evidence_urls']) {
        setErrors((prev) => {
          const next = { ...prev };
          delete next['evidence_urls'];
          return next;
        });
      }
    },
    onError: (errorMsg) => {
      setErrors((prev) => ({ ...prev, upload: errorMsg }));
    },
  });

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset input so the same file can be re-selected.
      e.target.value = '';
      await imageUpload.upload(file);
    },
    [imageUpload],
  );

  function handleRemoveEvidence(index: number) {
    setEvidenceUrls((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setErrors({});

    const result = claimSchema.safeParse({
      reason,
      description,
      evidence_urls: evidenceUrls,
    });

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string') {
          fieldErrors[key] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    submitClaim.mutate(
      {
        contractId,
        reason: result.data.reason,
        description: result.data.description,
        evidence_urls: result.data.evidence_urls,
      },
      { onSuccess },
    );
  }

  const isUploading =
    imageUpload.status === 'getting_url' ||
    imageUpload.status === 'uploading' ||
    imageUpload.status === 'confirming';

  return (
    <Card className={className}>
      <CardHeader>
        <h3 className="text-lg font-semibold">File Guarantee Claim</h3>
        <p className="text-sm text-muted-foreground">
          Describe the issue you experienced. Our team will review your claim and respond within 48
          hours.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Claim Type */}
          <div className="space-y-2">
            <Label htmlFor="claim-reason">Claim Type</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="claim-reason" className="min-h-[44px]" aria-label="Select claim type">
                <SelectValue placeholder="Select a claim type" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CLAIM_REASONS).map(([key, value]) => (
                  <SelectItem key={key} value={value}>
                    {CLAIM_REASON_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors['reason'] ? (
              <p className="text-sm text-destructive" role="alert">
                {errors['reason']}
              </p>
            ) : null}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="claim-description">Description</Label>
            <Textarea
              id="claim-description"
              placeholder="Describe the issue in detail (minimum 50 characters)..."
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (errors['description']) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next['description'];
                    return next;
                  });
                }
              }}
              className="min-h-[120px]"
              aria-describedby={errors['description'] ? 'desc-error' : undefined}
            />
            <div className="flex items-center justify-between">
              {errors['description'] ? (
                <p id="desc-error" className="text-sm text-destructive" role="alert">
                  {errors['description']}
                </p>
              ) : (
                <span />
              )}
              <span className="text-xs text-muted-foreground tabular-nums">
                {String(description.length)} / 50 min
              </span>
            </div>
          </div>

          {/* Photo Evidence */}
          <div className="space-y-2">
            <Label>Photo Evidence</Label>
            <p className="text-xs text-muted-foreground">
              Upload at least 1 photo showing the issue. Accepted formats: JPEG, PNG, WebP.
            </p>

            {/* Thumbnail Grid */}
            {evidenceUrls.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {evidenceUrls.map((url, index) => (
                  <div
                    key={url}
                    className="group relative aspect-square overflow-hidden rounded-md border"
                  >
                    <Image
                      src={url}
                      alt={`Evidence photo ${String(index + 1)}`}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 33vw, 25vw"
                    />
                    <button
                      type="button"
                      onClick={() => { handleRemoveEvidence(index); }}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      aria-label={`Remove photo ${String(index + 1)}`}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Upload Button */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => { void handleFileSelect(e); }}
              className="sr-only"
              aria-label="Upload evidence photo"
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] gap-2"
              disabled={isUploading}
              onClick={() => { fileInputRef.current?.click(); }}
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
              )}
              {isUploading
                ? `Uploading... ${String(imageUpload.progress)}%`
                : 'Add Photo'}
            </Button>

            {errors['evidence_urls'] ? (
              <p className="text-sm text-destructive" role="alert">
                {errors['evidence_urls']}
              </p>
            ) : null}
            {errors['upload'] ? (
              <p className="text-sm text-destructive" role="alert">
                {errors['upload']}
              </p>
            ) : null}
            {imageUpload.error ? (
              <p className="text-sm text-destructive" role="alert">
                {imageUpload.error}
              </p>
            ) : null}
          </div>

          {/* Submit */}
          <Button
            type="submit"
            className="min-h-[44px] w-full"
            disabled={submitClaim.isPending || isUploading}
          >
            {submitClaim.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Submit Claim
          </Button>

          {submitClaim.isError ? (
            <p className="text-sm text-destructive" role="alert">
              Failed to submit claim. Please try again.
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
