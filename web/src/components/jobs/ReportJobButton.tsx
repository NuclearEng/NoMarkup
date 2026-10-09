'use client';

// Report-a-job control for App Store safety (ASR-1.2.b). Mirrors
// ReportListingButton: ghost trigger + dialog with reason select and
// optional description. Posts to POST /api/v1/jobs/{id}/report.

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
  type JobReportReason,
  JOB_REPORT_REASONS,
  useReportJob,
} from '@/hooks/useJobReports';
import { getApiErrorMessage } from '@/lib/api';

interface ReportJobButtonProps {
  jobId: string;
  jobTitle?: string;
  className?: string;
}

export function ReportJobButton({ jobId, jobTitle, className }: ReportJobButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<JobReportReason | ''>('');
  const [description, setDescription] = useState('');
  const reportMutation = useReportJob();

  function handleSubmit() {
    if (!reason || reportMutation.isPending) return;
    reportMutation.mutate(
      {
        jobId,
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
              ? "You've already reported this job — our team is reviewing it."
              : 'Report submitted. Thanks for keeping jobs safe.',
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
          aria-label="Report job"
        >
          <Flag className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report {jobTitle ? `"${jobTitle}"` : 'this job'}</DialogTitle>
          <DialogDescription>
            Tell us what&apos;s wrong. Our moderation team reviews every report. Jobs with
            multiple reports may be temporarily hidden.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="job-report-reason"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Reason
            </label>
            <Select
              value={reason}
              onValueChange={(v) => {
                setReason(v as JobReportReason);
              }}
            >
              <SelectTrigger
                id="job-report-reason"
                className="min-h-[44px]"
                aria-label="Reason for report"
              >
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {JOB_REPORT_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label
              htmlFor="job-report-description"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Details (optional)
            </label>
            <Textarea
              id="job-report-description"
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
