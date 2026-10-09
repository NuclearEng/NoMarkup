'use client';

import { Copy, Mail, Phone } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { getApiErrorMessage } from '@/lib/api';
import { useChatAliases, useCreateChatAlias } from '@/hooks/useChatRelay';
import { useAuthStore } from '@/stores/auth-store';
import type { CreateChatAliasInput } from '@/types';

interface ChatRelayAliasProps {
  contextType: CreateChatAliasInput['context_type'];
  contextId: string;
}

/**
 * Caller-only relay address for a job or listing. The real email and phone
 * stay off the thread; dev often has no Twilio number, so the phone row hides.
 */
export function ChatRelayAlias({ contextType, contextId }: ChatRelayAliasProps) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const aliases = useChatAliases(isAuthenticated);
  const createAlias = useCreateChatAlias();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isAuthenticated) return null;

  const alias = aliases.data?.aliases.find(
    (row) => row.context_type === contextType && row.context_id === contextId,
  );
  const phone = alias?.twilio_proxy_phone?.trim() ?? '';

  async function handleCreate(): Promise<void> {
    setErrorMessage(null);
    try {
      await createAlias.mutateAsync({ context_type: contextType, context_id: contextId });
    } catch (err: unknown) {
      setErrorMessage(getApiErrorMessage(err, 'Could not create a relay address. Try again.'));
    }
  }

  async function handleCopy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setErrorMessage('Could not copy. Select the address and copy it manually.');
    }
  }

  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      data-testid="chat-relay-alias"
      aria-labelledby="chat-relay-heading"
    >
      <div className="space-y-1">
        <h2 id="chat-relay-heading" className="text-sm font-medium text-foreground">
          Private contact relay
        </h2>
        <p className="text-xs text-muted-foreground">
          Share this address instead of your real email. Only you can see it.
        </p>
      </div>

      {aliases.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading relay address…
        </p>
      ) : null}

      {aliases.isError ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load your relay address.
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => {
              void aliases.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {!aliases.isLoading && !aliases.isError && alias ? (
        <div className="space-y-2">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="break-all" data-testid="chat-relay-email">
              {alias.email_alias}
            </span>
          </p>
          {phone ? (
            <p className="flex items-center gap-2 text-sm text-foreground">
              <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{phone}</span>
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => {
              void handleCopy(alias.email_alias);
            }}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
            {copied ? 'Copied' : 'Copy relay email'}
          </Button>
        </div>
      ) : null}

      {!aliases.isLoading && !aliases.isError && !alias ? (
        <Button
          type="button"
          className="min-h-11"
          disabled={createAlias.isPending}
          onClick={() => {
            void handleCreate();
          }}
        >
          {createAlias.isPending ? 'Creating relay…' : 'Create relay address'}
        </Button>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
