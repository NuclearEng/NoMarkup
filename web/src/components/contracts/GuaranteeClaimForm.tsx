'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useOpenDispute } from '@/hooks/useContracts';

const CLAIM_TYPES = {
  QUALITY_ISSUE: 'quality_issue',
  INCOMPLETE_WORK: 'incomplete_work',
  NO_SHOW: 'no_show',
  ABANDONMENT: 'abandonment',
  OTHER: 'other',
} as const;

const CLAIM_TYPE_LABELS: Record<string, string> = {
  quality_issue: 'Quality Issue',
  incomplete_work: 'Incomplete Work',
  no_show: 'No-Show',
  abandonment: 'Abandonment',
  other: 'Other',
};

const claimSchema = z.object({
  dispute_type: z.string().min(1, 'Claim type is required'),
  description: z.string().min(50, 'Description must be at least 50 characters').max(5000),
});

interface GuaranteeClaimFormProps {
  contractId: string;
  onSuccess: () => void;
  className?: string;
}

export function GuaranteeClaimForm({ contractId, onSuccess, className }: GuaranteeClaimFormProps) {
  const openDispute = useOpenDispute();

  const [claimType, setClaimType] = useState('');
  const [description, setDescription] = useState('');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>(['']);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleAddEvidence() {
    setEvidenceUrls((prev) => [...prev, '']);
  }

  function handleEvidenceChange(index: number, value: string) {
    setEvidenceUrls((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function handleRemoveEvidence(index: number) {
    setEvidenceUrls((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const result = claimSchema.safeParse({
      dispute_type: claimType,
      description,
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

    const filteredUrls = evidenceUrls.filter((url) => url.trim().length > 0);
    const fullDescription = filteredUrls.length > 0
      ? `${description}\n\nEvidence URLs:\n${filteredUrls.join('\n')}`
      : description;

    openDispute.mutate(
      {
        contractId,
        dispute_type: claimType,
        description: fullDescription,
        is_guarantee_claim: true,
      },
      { onSuccess },
    );
  }

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
            <Label htmlFor="claim-type">Claim Type</Label>
            <Select value={claimType} onValueChange={setClaimType}>
              <SelectTrigger id="claim-type" className="min-h-[44px]" aria-label="Select claim type">
                <SelectValue placeholder="Select a claim type" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CLAIM_TYPES).map(([key, value]) => (
                  <SelectItem key={key} value={value}>
                    {CLAIM_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors['dispute_type'] ? (
              <p className="text-sm text-destructive" role="alert">
                {errors['dispute_type']}
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

          {/* Evidence URLs */}
          <div className="space-y-2">
            <Label>Evidence URLs (optional)</Label>
            {evidenceUrls.map((url, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  placeholder="https://..."
                  value={url}
                  onChange={(e) => { handleEvidenceChange(index, e.target.value); }}
                  className="min-h-[44px]"
                />
                {evidenceUrls.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-[44px] shrink-0"
                    onClick={() => { handleRemoveEvidence(index); }}
                    aria-label={`Remove evidence URL ${String(index + 1)}`}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px]"
              onClick={handleAddEvidence}
            >
              Add Another URL
            </Button>
          </div>

          {/* Submit */}
          <Button
            type="submit"
            className="min-h-[44px] w-full"
            disabled={openDispute.isPending}
          >
            {openDispute.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Submit Claim
          </Button>

          {openDispute.isError ? (
            <p className="text-sm text-destructive" role="alert">
              Failed to submit claim. Please try again.
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
