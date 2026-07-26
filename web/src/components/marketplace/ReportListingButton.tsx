'use client';

// Report-a-listing control for App Store safety (ASR-1.2.b). Mirrors the
// chat ReportButton pattern: ghost trigger + dialog with reason select and
// optional description. Posts to POST /api/v1/listings/{id}/report.

import { Flag, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type ListingReportReason,
  LISTING_REPORT_REASONS,
  useReportListing,
} from '@/hooks/useListingReports';
import { getApiErrorMessage } from '@/lib/api';

interface ReportListingButtonProps {
  listingId: string;
  listingTitle?: string;
  className?: string;
}

export function ReportListingButton({
  listingId,
  listingTitle,
  className,
}: ReportListingButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ListingReportReason | ''>('');
  const [description, setDescription] = useState('');
  const reportMutation = useReportListing();

  function handleSubmit() {
    if (!reason || reportMutation.isPending) return;
    reportMutation.mutate(
      {
        listingId,
        reason,
        description: description.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          setOpen(false);
          setReason('');
          setDescription('');
          toast.success(
            res.status === 'already_reported'
              ? "You've already reported this listing — our team is reviewing it."
              : 'Report submitted. Thanks for keeping the marketplace safe.',
          );
        },
        onError: (err) => {
          toast.error(getApiErrorMessage(err, 'Could not submit report'));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={className ?? 'min-h-[44px]'}
          aria-label="Report listing"
        >
          <Flag className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Report {listingTitle ? `"${listingTitle}"` : 'this listing'}
          </DialogTitle>
          <DialogDescription>
            Tell us what&apos;s wrong. Our moderation team reviews every report.
            Listings with multiple reports may be temporarily hidden.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="listing-report-reason"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Reason
            </label>
            <Select
              value={reason}
              onValueChange={(v) => {
                setReason(v as ListingReportReason);
              }}
            >
              <SelectTrigger
                id="listing-report-reason"
                className="min-h-[44px]"
                aria-label="Reason for report"
              >
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {LISTING_REPORT_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label
              htmlFor="listing-report-description"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Details (optional)
            </label>
            <Textarea
              id="listing-report-description"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              rows={3}
              maxLength={2000}
              placeholder="Add anything that helps us understand the issue…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleSubmit}
            disabled={!reason || reportMutation.isPending}
          >
            {reportMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                Submitting…
              </>
            ) : (
              'Submit report'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
