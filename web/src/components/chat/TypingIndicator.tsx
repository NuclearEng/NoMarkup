'use client';

import { useChatStore } from '@/stores/chat-store';

// Stable empty-array reference. Returning a fresh `[]` literal from the selector
// makes useSyncExternalStore see a new snapshot every render → infinite loop
// ("getSnapshot should be cached" / "Maximum update depth exceeded").
const EMPTY_TYPING_USERS: string[] = [];

export function TypingIndicator({ channelId }: { channelId: string }) {
  const typingUsers = useChatStore(
    (state) => state.typingUsers[channelId] ?? EMPTY_TYPING_USERS,
  );

  if (typingUsers.length === 0) return null;

  const firstUser = typingUsers[0] ?? 'Someone';
  const label =
    typingUsers.length === 1
      ? `${firstUser} is typing`
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
