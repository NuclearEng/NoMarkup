'use client';

import { AlertTriangle, Check, CheckCheck, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMarkRead, useMessages } from '@/hooks/useChannels';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { MESSAGE_TYPE } from '@/types';
import type { ChatMessage } from '@/types';

function formatDateSeparator(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (messageDate.getTime() === today.getTime()) return 'Today';
  if (messageDate.getTime() === yesterday.getTime()) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function isSameDay(a: string, b: string): boolean {
  const dateA = new Date(a);
  const dateB = new Date(b);
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

function isProposedTermsMessage(content: string): boolean {
  return content.startsWith('[Proposed Terms]');
}

interface ParsedTerms {
  paymentType: string;
  amount: string;
  milestones: string | null;
  description: string;
}

function parseProposedTerms(content: string): ParsedTerms | null {
  if (!isProposedTermsMessage(content)) return null;

  const lines = content.split('\n');
  let paymentType = '';
  let amount = '';
  let milestones: string | null = null;
  let description = '';
  let inMilestones = false;
  const milestoneLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('Payment Type: ')) {
      paymentType = line.replace('Payment Type: ', '');
      inMilestones = false;
    } else if (line.startsWith('Amount: ')) {
      amount = line.replace('Amount: ', '');
      inMilestones = false;
    } else if (line.startsWith('Milestones:')) {
      inMilestones = true;
    } else if (line.startsWith('Description: ')) {
      description = line.replace('Description: ', '');
      inMilestones = false;
    } else if (inMilestones && line.trim()) {
      milestoneLines.push(line.trim());
    }
  }

  if (milestoneLines.length > 0) {
    milestones = milestoneLines.join('\n');
  }

  return { paymentType, amount, milestones, description };
}

function ProposedTermsCard({ content }: { content: string }) {
  const terms = parseProposedTerms(content);
  if (!terms) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-2 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Proposed Terms
        </p>
        <div className="grid gap-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Payment</span>
            <span className="font-medium capitalize">{terms.paymentType.replace(/_/g, ' ')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-semibold">{terms.amount}</span>
          </div>
          {terms.milestones ? (
            <div>
              <span className="text-muted-foreground">Milestones</span>
              <div className="mt-1 space-y-0.5 pl-2 text-xs">
                {terms.milestones.split('\n').map((m, i) => (
                  <p key={`ms-${String(i)}`}>{m}</p>
                ))}
              </div>
            </div>
          ) : null}
          {terms.description ? (
            <div>
              <span className="text-muted-foreground">Scope</span>
              <p className="mt-0.5 text-xs">{terms.description}</p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ReadReceipt({ isOwnMessage, isRead }: { isOwnMessage: boolean; isRead: boolean }) {
  if (!isOwnMessage) return null;

  return (
    <span
      className="ml-1 inline-flex items-center"
      title={isRead ? 'Read' : 'Sent'}
      aria-label={isRead ? 'Message read' : 'Message sent'}
    >
      {isRead ? (
        <CheckCheck className="h-3 w-3 text-primary" aria-hidden="true" />
      ) : (
        <Check className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      )}
    </span>
  );
}

function MessageBubble({
  message,
  isOwnMessage,
  isLastRead,
}: {
  message: ChatMessage;
  isOwnMessage: boolean;
  isLastRead: boolean;
}) {
  if (message.message_type === MESSAGE_TYPE.SYSTEM) {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {message.content}
        </span>
      </div>
    );
  }

  const isTermsProposal = isProposedTermsMessage(message.content);

  return (
    <div
      className={cn('flex items-start gap-2', isOwnMessage ? 'flex-row-reverse' : 'flex-row')}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
        aria-hidden="true"
      >
        {message.sender_id.charAt(0).toUpperCase()}
      </div>
      <div className={cn('min-w-0 max-w-[85%] sm:max-w-[70%]', isOwnMessage ? 'items-end' : 'items-start')}>
        <div className="mb-0.5 flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-muted-foreground">{message.sender_id}</span>
        </div>
        {message.is_deleted ? (
          <div
            className={cn(
              'rounded-lg px-3 py-2 text-sm',
              isOwnMessage
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground',
            )}
          >
            <span className="italic text-muted-foreground">This message was deleted</span>
          </div>
        ) : isTermsProposal ? (
          <ProposedTermsCard content={message.content} />
        ) : (
          <div
            className={cn(
              'rounded-lg px-3 py-2 text-sm',
              isOwnMessage
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground',
            )}
          >
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        )}
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(new Date(message.created_at))}
          </span>
          <ReadReceipt isOwnMessage={isOwnMessage} isRead={isLastRead} />
          {message.flagged_contact_info ? (
            <span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400" title="May contain contact information">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">May contain contact information</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function MessageThread({ channelId }: { channelId: string }) {
  const [beforeCursor, setBeforeCursor] = useState<string | undefined>(undefined);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const user = useAuthStore((state) => state.user);
  const markRead = useMarkRead();

  const { data, isLoading, isError } = useMessages(channelId, {
    before: beforeCursor,
    page_size: 20,
  });

  const messages = data?.messages ?? [];
  const hasMore = data?.has_more ?? false;

  // Determine the last message read by the other party.
  // For simplicity, consider all non-own messages as "read" indicators.
  // The last own message before any non-own message is considered "read".
  const lastReadOwnMessageId = (() => {
    if (!user) return null;
    let lastOwnId: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.sender_id !== user.id) {
        // Found a message from the other party, mark the last own message before it as read
        for (let j = i - 1; j >= 0; j--) {
          const ownMsg = messages[j];
          if (ownMsg && ownMsg.sender_id === user.id) {
            lastOwnId = ownMsg.id;
            break;
          }
        }
        break;
      }
    }
    // If the last message is our own and there are prior non-own messages, it's read
    if (!lastOwnId && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.sender_id === user.id) {
        // Check if there are other participant messages before
        const hasOtherMessages = messages.some((m) => m.sender_id !== user.id);
        if (hasOtherMessages) {
          lastOwnId = lastMsg.id;
        }
      }
    }
    return lastOwnId;
  })();

  // Mark channel as read when viewing
  useEffect(() => {
    if (channelId) {
      void markRead.mutateAsync(channelId).catch(() => {
        // Silently handle mark-read failures
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current && !beforeCursor) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, beforeCursor]);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (!isLoading && messages.length > 0 && !beforeCursor) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [isLoading, messages.length, beforeCursor]);

  function handleLoadOlder() {
    const oldestMessage = messages[0];
    if (oldestMessage) {
      setBeforeCursor(oldestMessage.id);
    }
  }

  if (isLoading && !beforeCursor) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading messages</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-destructive">Failed to load messages.</p>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">No messages yet. Start the conversation.</p>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
      {hasMore ? (
        <div className="mb-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px]"
            onClick={handleLoadOlder}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Loading...
              </>
            ) : (
              'Load older messages'
            )}
          </Button>
        </div>
      ) : null}

      <div className="space-y-3" role="log" aria-label="Message history" aria-live="polite">
        {messages.map((message, index) => {
          const prevMessage = index > 0 ? messages[index - 1] : undefined;
          const showDateSeparator =
            !prevMessage || !isSameDay(prevMessage.created_at, message.created_at);

          return (
            <div key={message.id}>
              {showDateSeparator ? (
                <div className="my-4 flex items-center gap-3" role="separator">
                  <div className="flex-1 border-t" />
                  <span className="text-xs font-medium text-muted-foreground">
                    {formatDateSeparator(message.created_at)}
                  </span>
                  <div className="flex-1 border-t" />
                </div>
              ) : null}
              <MessageBubble
                message={message}
                isOwnMessage={user?.id === message.sender_id}
                isLastRead={message.id === lastReadOwnMessageId}
              />
            </div>
          );
        })}
      </div>

      <div ref={bottomRef} />
    </div>
  );
}
