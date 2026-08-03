'use client';

import { AlertTriangle, Check, CheckCheck, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useChannel,
  useMarkRead,
  useMessages,
  useRespondToTerms,
} from '@/hooks/useChannels';
import { getApiErrorMessage } from '@/lib/api';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { CHANNEL_STATUS, MESSAGE_TYPE } from '@/types';
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

function normalizedMessageType(message: ChatMessage): string {
  return (message.message_type ?? '').trim().toLowerCase();
}

/** True for system-style pills including terms accept/reject outcomes. */
function isSystemStyleMessage(message: ChatMessage): boolean {
  const t = normalizedMessageType(message);
  return (
    t === MESSAGE_TYPE.SYSTEM ||
    t === MESSAGE_TYPE.TERMS_ACCEPTED ||
    t === MESSAGE_TYPE.TERMS_REJECTED
  );
}

/**
 * Local-terms proposal (FR-8.9 / FR-5.4). Native path uses `message_type=proposed_terms`;
 * legacy web path may encode as plain text with a `[Proposed Terms]` body prefix.
 */
function isProposedTermsMessage(message: ChatMessage): boolean {
  if (normalizedMessageType(message) === MESSAGE_TYPE.PROPOSED_TERMS) return true;
  return message.content.trimStart().startsWith('[Proposed Terms]');
}

interface ParsedTerms {
  paymentType: string;
  amount: string;
  milestones: string | null;
  description: string;
}

function parseProposedTerms(content: string): ParsedTerms | null {
  if (!content.trimStart().startsWith('[Proposed Terms]')) return null;

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

function ProposedTermsCard({
  content,
  canRespond,
  isResponding,
  onAccept,
  onReject,
}: {
  content: string;
  canRespond: boolean;
  isResponding: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const terms = parseProposedTerms(content);

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-2 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Proposed Terms
        </p>
        {terms ? (
          <div className="grid gap-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Payment</span>
              <span className="font-medium capitalize">
                {terms.paymentType.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="flex justify-between gap-3">
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
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm">{content}</p>
        )}

        {canRespond ? (
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] flex-1"
              disabled={isResponding}
              onClick={onReject}
              aria-label="Reject proposed terms"
            >
              Reject
            </Button>
            <Button
              type="button"
              size="sm"
              className="min-h-[44px] flex-1"
              disabled={isResponding}
              onClick={onAccept}
              aria-label="Accept proposed terms"
            >
              {isResponding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                'Accept'
              )}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReadReceipt({
  show,
  isRead,
}: {
  /** Only the caller's last own message shows a receipt (iOS parity). */
  show: boolean;
  isRead: boolean;
}) {
  if (!show) return null;

  return (
    <span
      className="ml-1 inline-flex items-center gap-0.5"
      title={isRead ? 'Seen' : 'Sent'}
      aria-label={isRead ? 'Message seen' : 'Message sent'}
    >
      {isRead ? (
        <>
          <CheckCheck className="h-3 w-3 text-primary" aria-hidden="true" />
          <span className="text-[10px] leading-none text-primary">Seen</span>
        </>
      ) : (
        <>
          <Check className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          <span className="text-[10px] leading-none text-muted-foreground">Sent</span>
        </>
      )}
    </span>
  );
}

/**
 * Peer MarkRead watermark for the current viewer (customer sees provider's
 * watermark and vice versa). Null when channel/role/watermark missing.
 */
export function peerLastReadAtISO(
  channel:
    | {
        customer_id?: string;
        provider_id?: string;
        customer_last_read_at?: string;
        provider_last_read_at?: string;
      }
    | null
    | undefined,
  viewerUserId: string | null | undefined,
): string | null {
  if (!channel || !viewerUserId) return null;
  if (viewerUserId === channel.customer_id) {
    return channel.provider_last_read_at ?? null;
  }
  if (viewerUserId === channel.provider_id) {
    return channel.customer_last_read_at ?? null;
  }
  return null;
}

/**
 * Id of the caller's last own message that should show a receipt, and whether
 * the peer has Seen it. Prefers peer last_read watermark (works without a
 * reply); falls back to a later peer message (implies they opened the thread).
 */
export function computeLastOwnReceipt(
  messages: { id: string; sender_id: string; created_at: string }[],
  viewerUserId: string | null | undefined,
  peerLastReadISO: string | null,
): { messageId: string; isRead: boolean } | null {
  if (!viewerUserId) return null;
  let lastOwnIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.sender_id === viewerUserId) {
      lastOwnIdx = i;
      break;
    }
  }
  if (lastOwnIdx < 0) return null;
  const lastOwn = messages[lastOwnIdx];
  if (!lastOwn) return null;

  // (1) Peer watermark ≥ message created_at → Seen without requiring a reply.
  if (peerLastReadISO) {
    const peerMs = Date.parse(peerLastReadISO);
    const createdMs = Date.parse(lastOwn.created_at);
    if (!Number.isNaN(peerMs) && !Number.isNaN(createdMs) && peerMs >= createdMs) {
      return { messageId: lastOwn.id, isRead: true };
    }
  }

  // (2) Fallback: any later peer message implies they opened the thread.
  for (let i = lastOwnIdx + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg && msg.sender_id !== viewerUserId) {
      return { messageId: lastOwn.id, isRead: true };
    }
  }

  return { messageId: lastOwn.id, isRead: false };
}

function MessageBubble({
  message,
  isOwnMessage,
  senderLabel,
  showReceipt,
  isRead,
  canRespondToTerms,
  isRespondingToTerms,
  onAcceptTerms,
  onRejectTerms,
}: {
  message: ChatMessage;
  isOwnMessage: boolean;
  senderLabel: string;
  showReceipt: boolean;
  isRead: boolean;
  canRespondToTerms: boolean;
  isRespondingToTerms: boolean;
  onAcceptTerms: () => void;
  onRejectTerms: () => void;
}) {
  if (isSystemStyleMessage(message)) {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {message.content}
        </span>
      </div>
    );
  }

  const isTermsProposal = isProposedTermsMessage(message);

  return (
    <div
      className={cn('flex items-start gap-2', isOwnMessage ? 'flex-row-reverse' : 'flex-row')}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
        aria-hidden="true"
      >
        {(senderLabel.charAt(0) || '?').toUpperCase()}
      </div>
      <div className={cn('min-w-0 max-w-[85%] sm:max-w-[70%]', isOwnMessage ? 'items-end' : 'items-start')}>
        <div className="mb-0.5 flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-muted-foreground">{senderLabel}</span>
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
          <ProposedTermsCard
            content={message.content}
            canRespond={canRespondToTerms}
            isResponding={isRespondingToTerms}
            onAccept={onAcceptTerms}
            onReject={onRejectTerms}
          />
        ) : normalizedMessageType(message) === MESSAGE_TYPE.IMAGE ? (
          <div
            className={cn(
              'overflow-hidden rounded-lg',
              isOwnMessage ? 'bg-primary/10' : 'bg-muted',
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- chat CDN URLs are dynamic */}
            <img
              src={message.content}
              alt="Shared image"
              className="max-h-64 max-w-full object-contain"
            />
          </div>
        ) : normalizedMessageType(message) === MESSAGE_TYPE.FILE
          || normalizedMessageType(message) === MESSAGE_TYPE.CONTACT_SHARE ? (
          <div
            className={cn(
              'rounded-lg px-3 py-2 text-sm',
              isOwnMessage
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground',
            )}
          >
            {normalizedMessageType(message) === MESSAGE_TYPE.FILE
              && /^https?:\/\//i.test(message.content.trim()) ? (
              <a
                href={message.content.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-2 underline underline-offset-2"
              >
                Open attached file
              </a>
            ) : (
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            )}
          </div>
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
          <ReadReceipt show={isOwnMessage && showReceipt} isRead={isRead} />
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

/**
 * Customer may Accept/Reject only the latest open proposed-terms card that is
 * not theirs. Hides controls once any later terms_accepted/terms_rejected exists
 * (explicit response). Server re-enforces customer-only + membership.
 */
function canRespondToProposedTerms(
  message: ChatMessage,
  messages: ChatMessage[],
  opts: {
    isChannelCustomer: boolean;
    channelComposable: boolean;
    currentUserId: string | undefined;
  },
): boolean {
  if (!opts.channelComposable || !opts.isChannelCustomer || !opts.currentUserId) {
    return false;
  }
  if (message.sender_id === opts.currentUserId) return false;
  if (!isProposedTermsMessage(message)) return false;

  const idx = messages.findIndex((m) => m.id === message.id);
  if (idx < 0) return false;

  const later = messages.slice(idx + 1);
  const alreadyResponded = later.some((msg) => {
    const t = normalizedMessageType(msg);
    return t === MESSAGE_TYPE.TERMS_ACCEPTED || t === MESSAGE_TYPE.TERMS_REJECTED;
  });
  if (alreadyResponded) return false;

  // Prefer only the newest proposed-terms message.
  const laterProposal = later.some((msg) => isProposedTermsMessage(msg));
  return !laterProposal;
}

export function MessageThread({ channelId }: { channelId: string }) {
  const [beforeCursor, setBeforeCursor] = useState<string | undefined>(undefined);
  const [respondingMessageId, setRespondingMessageId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const prevLastMessageIdRef = useRef<string | null>(null);
  const didInitialScrollRef = useRef(false);
  const user = useAuthStore((state) => state.user);
  const markRead = useMarkRead();
  const respondToTerms = useRespondToTerms();
  // A channel has exactly two parties, so label incoming bubbles with the other
  // party's display name (own bubbles say "You") instead of the raw sender UUID.
  const { data: channelData } = useChannel(channelId);
  const channel = channelData?.channel;
  const otherPartyName =
    (user?.id === channel?.customer_id ? channel?.provider_name : channel?.customer_name) ??
    'Member';

  const isChannelCustomer = !!user?.id && !!channel?.customer_id && user.id === channel.customer_id;
  const channelComposable =
    channel?.status !== CHANNEL_STATUS.CLOSED && channel?.status !== CHANNEL_STATUS.READ_ONLY;

  const { data, isLoading, isError } = useMessages(channelId, {
    before: beforeCursor,
    page_size: 20,
  });

  // The gateway returns messages newest-first (ORDER BY created_at DESC).
  // Conventional chat renders oldest→newest with the newest at the bottom, so
  // normalize to ascending order here. This also makes messages[0] the OLDEST
  // message (the correct `before` cursor for load-older pagination) and makes
  // the bottom sentinel line up with the newest message (the scroll target).
  const messages = useMemo(() => {
    return [...(data?.messages ?? [])].sort((a, b) => {
      const delta = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      // Stable tiebreak on id so equal timestamps keep a deterministic order.
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    });
  }, [data?.messages]);
  const hasMore = data?.has_more ?? false;

  // Peer Seen/Sent: prefer channel last_read watermarks (iOS parity); reply fallback.
  const peerLastReadISO = peerLastReadAtISO(channel, user?.id);
  const lastOwnReceipt = useMemo(
    () => computeLastOwnReceipt(messages, user?.id, peerLastReadISO),
    [messages, user?.id, peerLastReadISO],
  );

  const lastMessage = messages[messages.length - 1];
  const lastMessageId = lastMessage?.id ?? null;
  const lastMessageIsOwn = !!lastMessage && lastMessage.sender_id === user?.id;
  const prevChannelIdForReadRef = useRef<string | null>(null);

  // Mark channel as read when the thread is open. Always fire on channel
  // switch; re-fire when the newest message id changes and that message is
  // from the peer (inbound) so unread clears without leaving the thread.
  // Skip own-outbound last messages to avoid thrash / loops with send.
  useEffect(() => {
    if (!channelId) return;

    const channelChanged = prevChannelIdForReadRef.current !== channelId;
    prevChannelIdForReadRef.current = channelId;

    if (!channelChanged && (lastMessageIsOwn || !lastMessageId)) return;

    void markRead.mutateAsync(channelId).catch(() => {
      // Silently handle mark-read failures
    });
    // markRead identity is unstable; channelId + last message identity drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, lastMessageId, lastMessageIsOwn]);

  // Auto-scroll the newest message into view when a new one arrives.
  //
  // Messages are ordered oldest→newest, so the bottom sentinel sits just below
  // the newest message — scrolling it into view reveals what was just sent.
  // We scope the scroll to the message-list container (not the page) and run it
  // after paint so the new bubble exists in the DOM before we scroll to it.
  //
  // Standard chat etiquette: always follow your OWN sent message, but only
  // auto-follow an INCOMING message if the reader is already near the bottom —
  // otherwise we'd rudely yank someone reading older history back down.
  useEffect(() => {
    const grew = messages.length > prevMessageCountRef.current;
    const lastChanged = lastMessageId !== prevLastMessageIdRef.current;
    prevMessageCountRef.current = messages.length;
    prevLastMessageIdRef.current = lastMessageId;

    // Loading an older page prepends messages — never scroll to the bottom then.
    if (beforeCursor || !grew || !lastChanged || !lastMessageId) return;

    const container = scrollContainerRef.current;
    const nearBottom =
      !container ||
      container.scrollHeight - container.scrollTop - container.clientHeight < 120;

    if (lastMessageIsOwn || nearBottom) {
      // Defer to the next frame so the new bubble has painted before we scroll.
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }, [messages.length, lastMessageId, lastMessageIsOwn, beforeCursor]);

  // Scroll to bottom on initial load only (the newest message), without
  // animation. Subsequent new messages are handled by the effect above so this
  // one-shot jump never fights the incoming-message near-bottom guard.
  useEffect(() => {
    if (!didInitialScrollRef.current && !isLoading && messages.length > 0 && !beforeCursor) {
      didInitialScrollRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [isLoading, messages.length, beforeCursor]);

  function handleLoadOlder() {
    const oldestMessage = messages[0];
    if (oldestMessage) {
      setBeforeCursor(oldestMessage.id);
    }
  }

  async function handleRespondToTerms(message: ChatMessage, accepted: boolean) {
    if (
      !canRespondToProposedTerms(message, messages, {
        isChannelCustomer,
        channelComposable,
        currentUserId: user?.id,
      })
    ) {
      return;
    }
    setRespondingMessageId(message.id);
    try {
      await respondToTerms.mutateAsync({ channelId, accepted });
      toast.success(accepted ? 'Terms accepted.' : 'Terms rejected.');
      // Best-effort mark-read after consent message lands.
      void markRead.mutateAsync(channelId).catch(() => {
        // Unread badges may lag; respond already succeeded.
      });
    } catch (err) {
      toast.error(
        getApiErrorMessage(
          err,
          accepted ? 'Failed to accept terms.' : 'Failed to reject terms.',
        ),
      );
    } finally {
      setRespondingMessageId(null);
    }
  }

  if (isLoading && !beforeCursor) {
    return (
      <div
        className="flex flex-1 flex-col justify-end gap-3 p-4"
        role="status"
        aria-label="Loading messages"
      >
        <span className="sr-only">Loading messages</span>
        <Skeleton className="h-10 w-3/5 self-start rounded-2xl" />
        <Skeleton className="h-10 w-1/2 self-end rounded-2xl" />
        <Skeleton className="h-10 w-2/3 self-start rounded-2xl" />
        <Skeleton className="h-10 w-2/5 self-end rounded-2xl" />
        <Skeleton className="h-10 w-1/2 self-start rounded-2xl" />
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
          const canRespond = canRespondToProposedTerms(message, messages, {
            isChannelCustomer,
            channelComposable,
            currentUserId: user?.id,
          });

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
                senderLabel={user?.id === message.sender_id ? 'You' : otherPartyName}
                showReceipt={!!lastOwnReceipt && message.id === lastOwnReceipt.messageId}
                isRead={!!lastOwnReceipt?.isRead && message.id === lastOwnReceipt.messageId}
                canRespondToTerms={canRespond}
                isRespondingToTerms={respondingMessageId === message.id}
                onAcceptTerms={() => {
                  void handleRespondToTerms(message, true);
                }}
                onRejectTerms={() => {
                  void handleRespondToTerms(message, false);
                }}
              />
            </div>
          );
        })}
      </div>

      <div ref={bottomRef} />
    </div>
  );
}
