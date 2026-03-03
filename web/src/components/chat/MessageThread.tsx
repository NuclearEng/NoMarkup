'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
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

function MessageBubble({
  message,
  isOwnMessage,
}: {
  message: ChatMessage;
  isOwnMessage: boolean;
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
      <div className={cn('max-w-[70%]', isOwnMessage ? 'items-end' : 'items-start')}>
        <div className="mb-0.5 flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{message.sender_id}</span>
        </div>
        <div
          className={cn(
            'rounded-lg px-3 py-2 text-sm',
            isOwnMessage
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground',
          )}
        >
          {message.is_deleted ? (
            <span className="italic text-muted-foreground">This message was deleted</span>
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(new Date(message.created_at))}
          </span>
          {message.flagged_contact_info ? (
            <span className="flex items-center gap-0.5 text-[10px] text-amber-600" title="May contain contact information">
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
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-3">
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
              />
            </div>
          );
        })}
      </div>

      <div ref={bottomRef} />
    </div>
  );
}
