'use client';

import { ArrowLeft, MessageSquare } from 'lucide-react';

import { ChannelList } from '@/components/chat/ChannelList';
import { MessageInput } from '@/components/chat/MessageInput';
import { MessageThread } from '@/components/chat/MessageThread';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { Button } from '@/components/ui/button';
import { useChannel } from '@/hooks/useChannels';
import { CONNECTION_STATUS } from '@/lib/websocket';
import { cn } from '@/lib/utils';
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
      <span
        className={cn('inline-block h-2 w-2 rounded-full', color)}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ActiveThread({ channelId }: { channelId: string }) {
  const { data } = useChannel(channelId);
  const channelStatus = data?.channel.status ?? 'active';

  return (
    <div className="flex h-full flex-col">
      <MessageThread channelId={channelId} />
      <TypingIndicator channelId={channelId} />
      <MessageInput channelId={channelId} channelStatus={channelStatus} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <MessageSquare className="h-16 w-16 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-4 text-lg font-medium">Select a conversation</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose a conversation from the list to start messaging.
      </p>
    </div>
  );
}

export default function MessagesPage() {
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const setActiveChannel = useChatStore((state) => state.setActiveChannel);

  return (
    <div className="flex h-[calc(100vh-theme(spacing.24))] flex-col">
      <div className="mb-4 flex items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
          <p className="mt-1 text-muted-foreground">
            Communicate with customers and providers.
          </p>
        </div>
        <div className="ml-auto">
          <ConnectionStatusDot />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
        {/* Desktop: side-by-side layout */}
        {/* Mobile: show either channel list or thread */}

        {/* Channel list sidebar */}
        <div
          className={cn(
            'w-full border-r md:w-80 md:block',
            activeChannelId ? 'hidden md:block' : 'block',
          )}
        >
          <ChannelList />
        </div>

        {/* Main thread area */}
        <div
          className={cn(
            'flex-1',
            activeChannelId ? 'block' : 'hidden md:block',
          )}
        >
          {activeChannelId ? (
            <div className="flex h-full flex-col">
              {/* Mobile back button */}
              <div className="flex items-center border-b p-2 md:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => { setActiveChannel(null); }}
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
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
}
