'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Upload } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useFileInsuranceClaim } from '@/hooks/useInsurance';
import { formatCents } from '@/lib/utils';

// Values MUST match the insurance_claims.claim_type DB CHECK constraint
// (migration 022): property_damage, workmanship_defect, incomplete_work,
// liability_incident. Any other value fails the insert with a 500.
const CLAIM_TYPES = [
  { value: 'property_damage', label: 'Property Damage' },
  { value: 'workmanship_defect', label: 'Workmanship Defect' },
  { value: 'incomplete_work', label: 'Incomplete Work' },
  { value: 'liability_incident', label: 'Liability Incident' },
] as const;

const claimSchema = z.object({
  claim_type: z.string().min(1, 'Select a claim type'),
  description: z.string().min(100, 'Description must be at least 100 characters'),
  claimed_amount_dollars: z.string().refine(
    (val) => {
      const num = parseFloat(val);
      return !Number.isNaN(num) && num > 0;
    },
    { message: 'Enter a valid amount' },
  ),
});

type ClaimFormValues = z.infer<typeof claimSchema>;

interface InsuranceClaimFormProps {
  policyId: string;
  coverageAmountCents: number;
  onSuccess?: () => void;
  className?: string;
}

export function InsuranceClaimForm({
  policyId,
  coverageAmountCents,
  onSuccess,
  className,
}: InsuranceClaimFormProps) {
  const fileClaim = useFileInsuranceClaim();
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ClaimFormValues>({
    resolver: zodResolver(claimSchema),
    defaultValues: {
      claim_type: '',
      description: '',
      claimed_amount_dollars: '',
    },
  });

  const claimType = watch('claim_type');
  const claimedAmountDollars = watch('claimed_amount_dollars');
  const claimedAmountCents = Math.round(parseFloat(claimedAmountDollars || '0') * 100);
  const exceedsCoverage = claimedAmountCents > coverageAmountCents;

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    // In production, this would upload to S3 via the image pipeline
    // For now, we create object URLs as placeholders for the upload flow
    const newUrls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file) {
        newUrls.push(URL.createObjectURL(file));
      }
    }
    setEvidenceUrls((prev) => [...prev, ...newUrls]);
    setUploading(false);
  }, []);

  function onSubmit(data: ClaimFormValues) {
    const amountCents = Math.round(parseFloat(data.claimed_amount_dollars) * 100);

    if (amountCents > coverageAmountCents) {
      return;
    }

    fileClaim.mutate(
      {
        policy_id: policyId,
        claim_type: data.claim_type,
        description: data.description,
        evidence_urls: evidenceUrls,
        claimed_amount_cents: amountCents,
      },
      {
        onSuccess: () => {
          onSuccess?.();
        },
      },
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">File a Claim</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="space-y-4"
        >
          {/* Claim Type */}
          <div className="space-y-2">
            <Label htmlFor="claim-type">Claim Type</Label>
            <Select
              value={claimType}
              onValueChange={(val) => {
                setValue('claim_type', val, { shouldValidate: true });
              }}
            >
              <SelectTrigger
                id="claim-type"
                className="min-h-[44px]"
                aria-label="Select claim type"
                aria-invalid={errors.claim_type ? true : undefined}
                aria-describedby={errors.claim_type ? 'claim-type-error' : undefined}
              >
                <SelectValue placeholder="Select claim type" />
              </SelectTrigger>
              <SelectContent>
                {CLAIM_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.claim_type ? (
              <p id="claim-type-error" className="text-xs text-destructive" role="alert">
                {errors.claim_type.message}
              </p>
            ) : null}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="claim-description">
              Description
              <span className="ml-1 text-xs text-zinc-400">(min 100 characters)</span>
            </Label>
            <Textarea
              id="claim-description"
              rows={5}
              className="min-h-[120px]"
              placeholder="Describe what happened in detail..."
              {...register('description')}
              aria-describedby={errors.description ? 'claim-description-error' : undefined}
            />
            {errors.description ? (
              <p id="claim-description-error" className="text-xs text-destructive" role="alert">
                {errors.description.message}
              </p>
            ) : null}
          </div>

          {/* Evidence Upload */}
          <div className="space-y-2">
            <Label htmlFor="claim-evidence">Evidence Photos</Label>
            <div className="flex items-center gap-3">
              <label
                htmlFor="claim-evidence"
                className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-dashed px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/[0.02]"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-4 w-4" aria-hidden="true" />
                )}
                Upload Photos
              </label>
              <input
                id="claim-evidence"
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => { handleFileUpload(e); }}
              />
              {evidenceUrls.length > 0 ? (
                <span className="text-xs text-zinc-400">
                  {String(evidenceUrls.length)} file{evidenceUrls.length !== 1 ? 's' : ''} attached
                </span>
              ) : null}
            </div>
          </div>

          {/* Claimed Amount */}
          <div className="space-y-2">
            <Label htmlFor="claimed-amount">
              Claimed Amount ($)
              <span className="ml-1 text-xs text-zinc-400">
                max: {formatCents(coverageAmountCents)}
              </span>
            </Label>
            <Input
              id="claimed-amount"
              type="number"
              min="1"
              step="0.01"
              placeholder="0.00"
              className="min-h-[44px]"
              {...register('claimed_amount_dollars')}
              aria-describedby={
                errors.claimed_amount_dollars
                  ? 'claimed-amount-error'
                  : exceedsCoverage
                    ? 'claimed-amount-warning'
                    : undefined
              }
            />
            {errors.claimed_amount_dollars ? (
              <p id="claimed-amount-error" className="text-xs text-destructive" role="alert">
                {errors.claimed_amount_dollars.message}
              </p>
            ) : null}
            {exceedsCoverage ? (
              <p id="claimed-amount-warning" className="text-xs text-destructive" role="alert">
                Amount exceeds coverage limit of {formatCents(coverageAmountCents)}
              </p>
            ) : null}
          </div>

          {/* Submit */}
          <Button
            type="submit"
            className="min-h-[44px] w-full"
            disabled={fileClaim.isPending || exceedsCoverage}
          >
            {fileClaim.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Submit Claim
          </Button>

          {fileClaim.isError ? (
            <p className="text-sm text-destructive">Failed to file claim. Please try again.</p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
