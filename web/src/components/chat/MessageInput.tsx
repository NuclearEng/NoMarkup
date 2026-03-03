'use client';

import { Send } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useSendMessage } from '@/hooks/useChannels';
import { useSendTypingIndicator } from '@/hooks/useWebSocket';
import { chatMessageSchema } from '@/lib/validations';
import { CHANNEL_STATUS } from '@/types';

const MAX_CHAR_COUNT = 2000;
const MAX_ROWS = 4;

export function MessageInput({
  channelId,
  channelStatus,
}: {
  channelId: string;
  channelStatus: string;
}) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useSendMessage();
  const sendTypingIndicator = useSendTypingIndicator(channelId);

  const isDisabled =
    channelStatus === CHANNEL_STATUS.READ_ONLY || channelStatus === CHANNEL_STATUS.CLOSED;

  const isValid = chatMessageSchema.safeParse(content).success;

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const lineHeight = 24;
    const maxHeight = lineHeight * MAX_ROWS;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${String(newHeight)}px`;
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    if (value.length <= MAX_CHAR_COUNT) {
      setContent(value);
      resizeTextarea();
      sendTypingIndicator();
    }
  }

  function handleSubmit() {
    if (!isValid || sendMessage.isPending) return;

    void sendMessage
      .mutateAsync({ channelId, input: { content: content.trim() } })
      .then(() => {
        setContent('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      })
      .catch(() => {
        // Error handled by TanStack Query
      });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  if (isDisabled) {
    return (
      <div className="border-t p-3">
        <p className="text-center text-sm text-muted-foreground">
          This conversation is {channelStatus === CHANNEL_STATUS.CLOSED ? 'closed' : 'read-only'}.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t p-3">
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            disabled={sendMessage.isPending}
            className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Message input"
            style={{ minHeight: '44px' }}
          />
        </div>
        <Button
          type="button"
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={!isValid || sendMessage.isPending}
          onClick={handleSubmit}
          aria-label="Send message"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          Press Enter to send, Shift+Enter for a new line
        </p>
        <p
          className={`text-[10px] ${content.length > MAX_CHAR_COUNT - 100 ? 'text-amber-600' : 'text-muted-foreground'}`}
        >
          {String(content.length)}/{String(MAX_CHAR_COUNT)}
        </p>
      </div>
    </div>
  );
}
