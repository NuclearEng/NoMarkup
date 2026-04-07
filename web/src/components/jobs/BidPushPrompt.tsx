'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface BidPushPromptProps {
  jobId: string;
  isJobOwner: boolean;
  bidCount: number;
  status: string;
  className?: string;
}

/**
 * Prompts the job owner to enable browser push notifications for incoming bids.
 *
 * Conditions for rendering:
 *  - Current user is the job owner
 *  - Job is active
 *  - No bids have been placed yet (bid_count === 0)
 *  - Browser supports the Notifications API
 *  - Permission is still 'default' (not yet granted or denied)
 *  - The user has not already been prompted for this job (localStorage flag)
 */
export function BidPushPrompt({ jobId, isJobOwner, bidCount, status, className }: BidPushPromptProps) {
  const storageKey = `nm_push_prompted_${jobId}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Evaluate all conditions on mount (client-only — Notification is not in SSR scope).
    if (!isJobOwner) return;
    if (status !== 'active') return;
    if (bidCount !== 0) return;
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(storageKey) === 'true') return;

    setVisible(true);
  }, [isJobOwner, status, bidCount, storageKey]);

  if (!visible) return null;

  const handleEnable = async () => {
    // Record that we have prompted, regardless of the outcome.
    localStorage.setItem(storageKey, 'true');
    setVisible(false);

    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
      toast.success('Notifications enabled — we\'ll let you know when bids come in');
    }
    // Denied or dismissed: silently hide, do not show an error.
  };

  return (
    <Card
      className={cn(
        'border-border/60 bg-muted/30',
        className,
      )}
    >
      <CardContent className="flex items-start gap-3 p-4">
        <div className="mt-0.5 shrink-0 rounded-full bg-primary/10 p-1.5">
          <Bell className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Get notified when bids come in</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Receive a browser notification the moment a provider places a bid.
          </p>
          <Button
            size="sm"
            className="mt-3 min-h-[36px]"
            onClick={() => {
              void handleEnable();
            }}
          >
            Enable Notifications
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
