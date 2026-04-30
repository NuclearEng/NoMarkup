'use client';

import { FileText, Send, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { QuickReplyTemplates } from '@/components/chat/QuickReplyTemplates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSendMessage } from '@/hooks/useChannels';
import { useSendTypingIndicator } from '@/hooks/useWebSocket';
import { chatMessageSchema } from '@/lib/validations';
import { CHANNEL_STATUS } from '@/types';

const MAX_CHAR_COUNT = 2000;
const MAX_ROWS = 4;

interface ProposedTerms {
  paymentType: string;
  amount: string;
  milestones: string;
  description: string;
}

function ProposeTermsForm({
  onSubmit,
  onCancel,
  isPending,
}: {
  onSubmit: (terms: ProposedTerms) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [paymentType, setPaymentType] = useState('completion');
  const [amount, setAmount] = useState('');
  const [milestones, setMilestones] = useState('');
  const [description, setDescription] = useState('');

  function handleSubmit() {
    if (!amount || !description) return;
    onSubmit({ paymentType, amount, milestones, description });
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Propose Terms</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onCancel}
          aria-label="Cancel proposal"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="propose-payment-type" className="mb-1 block text-xs font-medium text-muted-foreground">
            Payment Type
          </label>
          <Select value={paymentType} onValueChange={setPaymentType}>
            <SelectTrigger id="propose-payment-type" className="min-h-[44px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="upfront">Upfront</SelectItem>
              <SelectItem value="milestone">Milestone</SelectItem>
              <SelectItem value="completion">On Completion</SelectItem>
              <SelectItem value="payment_plan">Payment Plan</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label htmlFor="propose-amount" className="mb-1 block text-xs font-medium text-muted-foreground">
            Amount ($)
          </label>
          <Input
            id="propose-amount"
            type="number"
            min={0}
            step={0.01}
            value={amount}
            onChange={(e) => { setAmount(e.target.value); }}
            placeholder="0.00"
            className="min-h-[44px]"
          />
        </div>
      </div>

      {paymentType === 'milestone' ? (
        <div>
          <label htmlFor="propose-milestones" className="mb-1 block text-xs font-medium text-muted-foreground">
            Milestones (one per line)
          </label>
          <Textarea
            id="propose-milestones"
            value={milestones}
            onChange={(e) => { setMilestones(e.target.value); }}
            rows={3}
            placeholder="Initial consultation - 20%&#10;Main work - 60%&#10;Final delivery - 20%"
          />
        </div>
      ) : null}

      <div>
        <label htmlFor="propose-description" className="mb-1 block text-xs font-medium text-muted-foreground">
          Description
        </label>
        <Textarea
          id="propose-description"
          value={description}
          onChange={(e) => { setDescription(e.target.value); }}
          rows={2}
          placeholder="Describe the scope of work and what's included..."
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="min-h-[44px]"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!amount || !description || isPending}
          className="min-h-[44px]"
        >
          {isPending ? 'Sending...' : 'Send Proposal'}
        </Button>
      </div>
    </div>
  );
}

export function MessageInput({
  channelId,
  channelStatus,
}: {
  channelId: string;
  channelStatus: string;
}) {
  const [content, setContent] = useState('');
  const [showProposeTerms, setShowProposeTerms] = useState(false);
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

  function handleTemplateSelect(body: string) {
    // Insert at the cursor when there is one; otherwise append. Keeps
    // the user's in-progress text intact when they pick a quick reply.
    const ta = textareaRef.current;
    if (!ta) {
      setContent((prev) => (prev ? `${prev} ${body}` : body));
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = content.slice(0, start) + body + content.slice(end);
    if (next.length <= MAX_CHAR_COUNT) {
      setContent(next);
      requestAnimationFrame(() => {
        ta.focus();
        const caret = start + body.length;
        ta.setSelectionRange(caret, caret);
      });
    }
  }

  function handleProposeTerms(terms: ProposedTerms) {
    const termsMessage = [
      '[Proposed Terms]',
      `Payment Type: ${terms.paymentType}`,
      `Amount: $${terms.amount}`,
      terms.milestones ? `Milestones:\n${terms.milestones}` : '',
      `Description: ${terms.description}`,
    ]
      .filter(Boolean)
      .join('\n');

    void sendMessage
      .mutateAsync({ channelId, input: { content: termsMessage } })
      .then(() => {
        setShowProposeTerms(false);
      })
      .catch(() => {
        // Error handled by TanStack Query
      });
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
      {showProposeTerms ? (
        <ProposeTermsForm
          onSubmit={handleProposeTerms}
          onCancel={() => { setShowProposeTerms(false); }}
          isPending={sendMessage.isPending}
        />
      ) : (
        <>
          <QuickReplyTemplates onSelect={handleTemplateSelect} className="-mx-3 -mt-3 mb-2" />
          <div className="flex items-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => { setShowProposeTerms(true); }}
              aria-label="Propose terms"
              title="Propose Terms"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
            </Button>
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={content}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                rows={1}
                disabled={sendMessage.isPending}
                className="flex min-h-[44px] w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Message input"
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
        </>
      )}
    </div>
  );
}
