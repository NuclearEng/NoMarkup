'use client';

import { useChatStore } from '@/stores/chat-store';

// Stable empty-array reference. Returning a fresh `[]` literal from the selector
// makes useSyncExternalStore see a new snapshot every render → infinite loop
// ("getSnapshot should be cached" / "Maximum update depth exceeded").
const EMPTY_TYPING_USERS: string[] = [];

export function TypingIndicator({
  channelId,
  otherPartyName,
}: {
  channelId: string;
  /**
   * Display name of the conversation partner. The WS typing payload carries
   * only the sender's raw user UUID, so we render the resolved name the parent
   * already has (a channel has exactly two parties, so any typing event here is
   * the other party). Falls back to a generic label — never the raw UUID.
   */
  otherPartyName?: string | null;
}) {
  const typingUsers = useChatStore(
    (state) => state.typingUsers[channelId] ?? EMPTY_TYPING_USERS,
  );

  if (typingUsers.length === 0) return null;

  const name = otherPartyName && otherPartyName.trim() ? otherPartyName : null;
  const label =
    typingUsers.length === 1
      ? name
        ? `${name} is typing`
        : 'Typing…'
      : `${String(typingUsers.length)} people are typing`;

  return (
    <div className="px-4 py-1" aria-live="polite" aria-atomic="true">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="flex gap-0.5" aria-hidden="true">
          <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
        </span>
      </div>
    </div>
  );
}
