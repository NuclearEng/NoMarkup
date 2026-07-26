'use client';

// Lightweight flag-a-review control for surfaces that do not use full
// ReviewCard (e.g. public provider profile review list). Uses useFlagReview.

import { Flag, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFlagReview } from '@/hooks/useReviews';
import { getApiErrorMessage } from '@/lib/api';
import { FLAG_REASON } from '@/types';

const FLAG_REASON_LABELS: { value: string; label: string }[] = [
  { value: FLAG_REASON.INAPPROPRIATE, label: 'Inappropriate' },
  { value: FLAG_REASON.FAKE, label: 'Fake' },
  { value: FLAG_REASON.HARASSMENT, label: 'Harassment' },
  { value: FLAG_REASON.SPAM, label: 'Spam' },
  { value: FLAG_REASON.IRRELEVANT, label: 'Irrelevant' },
];

interface FlagReviewButtonProps {
  reviewId: string;
  className?: string;
}

export function FlagReviewButton({ reviewId, className }: FlagReviewButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const flagReview = useFlagReview();

  function handleFlag() {
    if (!reason || flagReview.isPending) return;
    flagReview.mutate(
      { reviewId, reason },
      {
        onSuccess: () => {
          setOpen(false);
          setReason('');
          toast.success('Review flagged for moderation. Thanks for reporting.');
        },
        onError: (err) => {
          toast.error(getApiErrorMessage(err, 'Could not flag review'));
        },
      },
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className={
          className ??
          'flex min-h-[44px] items-center gap-1 text-xs text-muted-foreground hover:text-destructive'
        }
        onClick={() => {
          setOpen(true);
        }}
        aria-label="Flag review"
      >
        <Flag className="h-3 w-3" aria-hidden="true" />
        Report
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
      <Select value={reason} onValueChange={setReason}>
        <SelectTrigger className="min-h-[44px] min-w-[10rem] flex-1" aria-label="Flag reason">
          <SelectValue placeholder="Select reason" />
        </SelectTrigger>
        <SelectContent>
          {FLAG_REASON_LABELS.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="destructive"
        className="min-h-[44px] shrink-0"
        onClick={handleFlag}
        disabled={!reason || flagReview.isPending}
      >
        {flagReview.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : null}
        Flag
      </Button>
      <Button
        type="button"
        variant="outline"
        className="min-h-[44px] shrink-0"
        onClick={() => {
          setOpen(false);
          setReason('');
        }}
        disabled={flagReview.isPending}
      >
        Cancel
      </Button>
    </div>
  );
}
