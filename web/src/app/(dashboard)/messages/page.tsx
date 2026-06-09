'use client';

import { ArrowLeft } from 'lucide-react';

import { BlockButton } from '@/components/chat/BlockButton';
import { ChannelList } from '@/components/chat/ChannelList';
import { MessageInput } from '@/components/chat/MessageInput';
import { MessageThread } from '@/components/chat/MessageThread';
import { RelayBanner } from '@/components/chat/RelayBanner';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { useChannel } from '@/hooks/useChannels';
import { useMyBlocks } from '@/hooks/useUserBlocks';
import { CONNECTION_STATUS } from '@/lib/websocket';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { useChatStore } from '@/stores/chat-store';

const STATUS_LABEL: Record<string, string> = {
  [CONNECTION_STATUS.CONNECTED]: 'Connected',
  [CONNECTION_STATUS.CONNECTING]: 'Connecting',
  [CONNECTION_STATUS.DISCONNECTED]: 'Disconnected',
};

const STATUS_COLOR: Record<string, string> = {
  [CONNECTION_STATUS.CONNECTED]: 'bg-green-500',
  [CONNECTION_STATUS.CONNECTING]: 'bg-yellow-500',
  [CONNECTION_STATUS.DISCONNECTED]: 'bg-red-500',
};

function ConnectionStatusDot() {
  const connectionStatus = useChatStore((s) => s.connectionStatus);
  const label = STATUS_LABEL[connectionStatus] ?? 'Unknown';
  const color = STATUS_COLOR[connectionStatus] ?? 'bg-gray-400';

  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className={cn('inline-block h-2 w-2 rounded-full', color)} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ActiveThread({ channelId }: { channelId: string }) {
  const { data } = useChannel(channelId);
  const channelStatus = data?.channel.status ?? 'active';
  const me = useAuthStore((s) => s.user);
  const blocksQuery = useMyBlocks();

  // The "other party" is whoever isn't us. With both sides redacted,
  // the BlockButton hides itself.
  const otherPartyId = (() => {
    if (!data?.channel || !me) return null;
    if (data.channel.customer_id === me.id) return data.channel.provider_id;
    return data.channel.customer_id;
  })();

  // The other party's display name (resolved by the gateway). Falls back to a
  // friendly placeholder, never a raw UUID.
  const otherPartyName = (() => {
    if (!data?.channel || !me) return null;
    const name =
      data.channel.customer_id === me.id
        ? data.channel.provider_name
        : data.channel.customer_name;
    return name && name.trim() ? name : 'Conversation';
  })();

  const isBlocked = (() => {
    if (!otherPartyId) return false;
    return (blocksQuery.data?.blocks ?? []).some(
      (b) => b.blocked_id === otherPartyId,
    );
  })();

  return (
    <div className="flex h-full flex-col">
      <RelayBanner />
      {otherPartyId ? (
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-sm font-medium"
              aria-hidden="true"
            >
              {(otherPartyName ?? 'C').charAt(0).toUpperCase()}
            </div>
            <span className="truncate text-sm font-medium">{otherPartyName}</span>
          </div>
          <BlockButton userId={otherPartyId} isBlocked={isBlocked} />
        </div>
      ) : null}
      <MessageThread channelId={channelId} />
      <TypingIndicator channelId={channelId} otherPartyName={otherPartyName} />
      <MessageInput channelId={channelId} channelStatus={channelStatus} />
    </div>
  );
}

function NoConversationSelected() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={<AnimatedIllustration type="no-messages" size="sm" />}
        title="Select a conversation"
        description="Choose a conversation from the list to start messaging."
        className="border-none bg-transparent"
      />
    </div>
  );
}

export default function MessagesPage() {
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const setActiveChannel = useChatStore((state) => state.setActiveChannel);

  return (
    <PageTransition>
    <div className="flex h-[calc(100dvh-theme(spacing.24))] flex-col">
      <div className="mb-4 flex items-center gap-2">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Messages</h1>
          <p className="mt-1 text-zinc-300">Communicate with customers and providers.</p>
        </div>
        <div className="ml-auto">
          <ConnectionStatusDot />
        </div>
      </div>

      <div className="glass glass-highlight flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--brand-gold)]/10">
        {/* Desktop: side-by-side layout */}
        {/* Mobile: show either channel list or thread */}

        {/* Channel list sidebar — glass panel */}
        <div
          className={cn(
            'w-full md:block md:w-80',
            'border-r border-white/[0.06]',
            'bg-white/[0.02]',
            activeChannelId ? 'hidden md:block' : 'block',
          )}
        >
          <ChannelList />
        </div>

        {/* Main thread area */}
        <div className={cn('min-w-0 flex-1', activeChannelId ? 'block' : 'hidden md:block')}>
          {activeChannelId ? (
            <div className="flex h-full flex-col">
              {/* Mobile back button */}
              <div className="flex items-center border-b border-white/[0.06] p-2 md:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => {
                    setActiveChannel(null);
                  }}
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ActiveThread channelId={activeChannelId} />
              </div>
            </div>
          ) : (
            <NoConversationSelected />
          )}
        </div>
      </div>
    </div>
    </PageTransition>
  );
}
