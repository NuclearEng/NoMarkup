'use client';

import { MessageSquare, Search } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useChannels } from '@/hooks/useChannels';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useChatStore } from '@/stores/chat-store';
import { CHANNEL_TYPE } from '@/types';
import type { Channel } from '@/types';

function channelTypeLabel(channelType: string): string {
  switch (channelType) {
    case CHANNEL_TYPE.BID:
      return 'Bid';
    case CHANNEL_TYPE.CONTRACT:
      return 'Contract';
    case CHANNEL_TYPE.INQUIRY:
      return 'Inquiry';
    default:
      return channelType;
  }
}

function truncateMessage(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + '...';
}

function ChannelListItem({ channel, isActive }: { channel: Channel; isActive: boolean }) {
  const setActiveChannel = useChatStore((state) => state.setActiveChannel);
  const lastMessagePreview = channel.last_message
    ? truncateMessage(channel.last_message.content, 50)
    : 'No messages yet';
  const lastMessageTime = channel.last_message
    ? formatRelativeTime(new Date(channel.last_message.created_at))
    : formatRelativeTime(new Date(channel.created_at));

  const otherPartyId = channel.provider_id || channel.customer_id;

  return (
    <button
      type="button"
      onClick={() => { setActiveChannel(channel.id); }}
      className={cn(
        'flex w-full min-h-[44px] items-start gap-3 rounded-md border p-3 text-left transition-colors',
        isActive
          ? 'border-primary bg-primary/5'
          : 'border-transparent hover:bg-muted',
      )}
      aria-label={`Open conversation with ${otherPartyId}`}
      aria-current={isActive ? 'true' : undefined}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
        {otherPartyId.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{otherPartyId}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{lastMessageTime}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{lastMessagePreview}</p>
        <div className="mt-1 flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {channelTypeLabel(channel.channel_type)}
          </Badge>
          {channel.unread_count > 0 ? (
            <Badge className="h-5 min-w-[20px] justify-center rounded-full px-1.5 text-[10px]">
              {String(channel.unread_count)}
            </Badge>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function ChannelListSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-start gap-3 rounded-md p-3">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-12 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChannelList() {
  const [searchQuery, setSearchQuery] = useState('');
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const { data, isLoading, isError } = useChannels({ page: 1, per_page: 50 });

  const channels = data?.channels ?? [];

  const filteredChannels = searchQuery
    ? channels.filter((channel) => {
        const query = searchQuery.toLowerCase();
        const matchesParty =
          channel.customer_id.toLowerCase().includes(query) ||
          channel.provider_id.toLowerCase().includes(query);
        const matchesMessage = channel.last_message?.content
          .toLowerCase()
          .includes(query);
        return matchesParty || matchesMessage;
      })
    : channels;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); }}
            className="min-h-[44px] pl-9"
            aria-label="Search conversations"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <ChannelListSkeleton />
        ) : isError ? (
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-destructive">Failed to load conversations.</p>
            </CardContent>
          </Card>
        ) : filteredChannels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <MessageSquare className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
            <p className="mt-4 text-sm font-medium">
              {searchQuery ? 'No matching conversations' : 'No conversations yet'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {searchQuery
                ? 'Try a different search term.'
                : 'Conversations will appear here when you start messaging.'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredChannels.map((channel) => (
              <ChannelListItem
                key={channel.id}
                channel={channel}
                isActive={activeChannelId === channel.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
