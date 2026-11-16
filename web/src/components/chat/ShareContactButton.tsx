'use client';

// FR-8.8 — explicit opt-in Share Contact Info.
// Posts phone and/or email to POST /channels/{id}/share-contact after a confirm
// dialog. Does not bypass free-text contact filtering; only this path is the
// intentional share. Fail closed on empty fields and API errors.

import { Loader2, UserRoundPlus } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useShareContact } from '@/hooks/useChannels';
import { getApiErrorMessage } from '@/lib/api';

interface ShareContactButtonProps {
  channelId: string;
  className?: string;
}

export function ShareContactButton({ channelId, className }: ShareContactButtonProps) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const shareMutation = useShareContact();

  const phoneTrim = phone.trim();
  const emailTrim = email.trim();
  const canSubmit = (phoneTrim.length > 0 || emailTrim.length > 0) && !shareMutation.isPending;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setPhone('');
      setEmail('');
      shareMutation.reset();
    }
  }

  function handleSubmit() {
    if (!canSubmit) return;
    shareMutation.mutate(
      {
        channelId,
        input: {
          ...(phoneTrim ? { phone: phoneTrim } : {}),
          ...(emailTrim ? { email: emailTrim } : {}),
        },
      },
      {
        onSuccess: () => {
          handleOpenChange(false);
          toast.success('Contact shared in this thread.');
        },
        onError: (err) => {
          toast.error(getApiErrorMessage(err, 'Could not share contact'));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={className ?? 'min-h-[44px]'}
          aria-label="Share contact info"
        >
          <UserRoundPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Share contact
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share contact info?</DialogTitle>
          <DialogDescription>
            This posts your phone and/or email in the thread as an explicit share. Only do this when
            you are ready to go off-platform or coordinate handoff. At least one field is required.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="share-contact-phone">Phone (optional)</Label>
            <Input
              id="share-contact-phone"
              type="tel"
              autoComplete="tel"
              placeholder="Phone number"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
              }}
              className="min-h-[44px]"
              disabled={shareMutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="share-contact-email">Email (optional)</Label>
            <Input
              id="share-contact-email"
              type="email"
              autoComplete="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              className="min-h-[44px]"
              disabled={shareMutation.isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            onClick={() => {
              handleOpenChange(false);
            }}
            disabled={shareMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-[44px]"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-busy={shareMutation.isPending}
          >
            {shareMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Sharing…
              </>
            ) : (
              'Share'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
