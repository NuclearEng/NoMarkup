'use client';

// Per-thread block/report control. Renders an inline button + a confirm
// dialog with an optional reason field. Closes audit Section F.
//
// The reason field is intentionally optional — abuse reporting is the
// cheap path; we don't want to gate the UX on a multi-step form. The
// gateway clamps the reason to 500 chars.

import { Ban, Loader2, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

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
import { Textarea } from '@/components/ui/textarea';
import { useBlockUser, useUnblockUser } from '@/hooks/useUserBlocks';

interface BlockButtonProps {
  /** The user being blocked / unblocked (the OTHER party in the thread). */
  userId: string;
  /** Their display name (used in the dialog title). */
  displayName?: string;
  /** Whether the current user has already blocked this user. */
  isBlocked?: boolean;
  className?: string;
}

export function BlockButton({
  userId,
  displayName,
  isBlocked = false,
  className,
}: BlockButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const blockMutation = useBlockUser();
  const unblockMutation = useUnblockUser();

  function handleBlock() {
    if (blockMutation.isPending) return;
    blockMutation.mutate(
      { userId, reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          setOpen(false);
          setReason('');
        },
      },
    );
  }

  function handleUnblock() {
    if (unblockMutation.isPending) return;
    unblockMutation.mutate(userId);
  }

  if (isBlocked) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleUnblock}
        disabled={unblockMutation.isPending}
        className={className}
        aria-label="Unblock user"
      >
        {unblockMutation.isPending ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <ShieldAlert className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        )}
        Unblock
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={className}
          aria-label="Block user"
        >
          <Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Block
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Block {displayName ?? 'this user'}?
          </DialogTitle>
          <DialogDescription>
            They will no longer be able to message you, and they cannot
            bid on your listings. You can unblock them anytime from
            Settings.
          </DialogDescription>
        </DialogHeader>
        <div>
          <label
            htmlFor="block-reason"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Reason (optional)
          </label>
          <Textarea
            id="block-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            rows={3}
            maxLength={500}
            placeholder="Spam, harassment, off-platform contact attempt…"
          />
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
            onClick={handleBlock}
            disabled={blockMutation.isPending}
          >
            {blockMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                Blocking…
              </>
            ) : (
              'Block user'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
