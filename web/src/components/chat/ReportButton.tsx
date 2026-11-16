'use client';

// Report-a-user control. Renders an inline "Report" button + a dialog with a
// reason select and an optional description, posting to the owner-scoped
// report endpoint. Sits beside the BlockButton in the chat header (and is
// reusable on a profile page) so flagging an abusive user is a first-class
// action, not just a block.
//
// Block hides the other party from YOU; Report escalates to moderation. The
// two are complementary, so we surface both.

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
import { type ReportReason, REPORT_REASONS, useReportUser } from '@/hooks/useUserReports';
import { getApiErrorMessage } from '@/lib/api';

interface ReportButtonProps {
  /** The user being reported (the OTHER party). */
  userId: string;
  /** Their display name (shown in the dialog title). */
  displayName?: string;
  /** Optional chat context, forwarded so moderators can find the thread. */
  channelId?: string;
  messageId?: string;
  className?: string;
}

export function ReportButton({
  userId,
  displayName,
  channelId,
  messageId,
  className,
}: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [description, setDescription] = useState('');
  const reportMutation = useReportUser();

  function handleSubmit() {
    if (!reason || reportMutation.isPending) return;
    reportMutation.mutate(
      {
        userId,
        reason,
        description: description.trim() || undefined,
        channelId,
        messageId,
      },
      {
        onSuccess: (res) => {
          setOpen(false);
          setReason('');
          setDescription('');
          toast.success(
            res.status === 'already_reported'
              ? "You've already reported this — our team is reviewing it."
              : 'Report submitted. Thanks for keeping the community safe.',
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
          aria-label="Report user"
        >
          <Flag className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report {displayName ?? 'this user'}</DialogTitle>
          <DialogDescription>
            Tell us what's wrong. Our moderation team reviews every report.
            This is separate from blocking — you can do both.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="report-reason"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Reason
            </label>
            <Select
              value={reason}
              onValueChange={(v) => {
                setReason(v as ReportReason);
              }}
            >
              <SelectTrigger
                id="report-reason"
                className="min-h-[44px]"
                aria-label="Reason for report"
              >
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {REPORT_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label
              htmlFor="report-description"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Details (optional)
            </label>
            <Textarea
              id="report-description"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              rows={3}
              maxLength={2000}
              placeholder="Add anything that helps us understand what happened…"
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
