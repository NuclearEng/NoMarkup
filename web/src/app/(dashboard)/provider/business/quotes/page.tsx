'use client';

import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useFeatureFlag } from '@/hooks/useFeatureFlags';
import {
  useCreateQuoteTemplate,
  useDeleteQuoteTemplate,
  useQuoteTemplates,
} from '@/hooks/useQuoteTemplates';
import { getApiErrorMessage } from '@/lib/api';
import { formatCents } from '@/lib/utils';

function dollarsToCents(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(trimmed);
  if (!match || match[1] === undefined) {
    throw new Error('Enter a valid dollar amount (example 150.00).');
  }
  const dollars = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return dollars * 100 + Number(fraction);
}

export default function QuoteTemplatesPage() {
  const enabled = useFeatureFlag('provider_business_os');
  const { data: templates = [], isLoading, isError, error, refetch } = useQuoteTemplates();
  const createTemplate = useCreateQuoteTemplate();
  const deleteTemplate = useDeleteQuoteTemplate();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [amount, setAmount] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  async function onCreate(): Promise<void> {
    setFormError(null);
    const trimmedName = name.trim();
    const trimmedBody = body.trim();
    if (trimmedName === '' || trimmedBody === '') {
      setFormError('Name and body are required.');
      return;
    }
    if (trimmedBody.length > 4000) {
      setFormError('Body must be at most 4000 characters.');
      return;
    }
    let cents: number | undefined;
    try {
      cents = dollarsToCents(amount);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Enter a valid dollar amount.');
      return;
    }
    try {
      await createTemplate.mutateAsync({
        name: trimmedName,
        body: trimmedBody,
        ...(cents !== undefined ? { default_amount_cents: cents } : {}),
      });
      setName('');
      setBody('');
      setAmount('');
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Could not save the template'));
    }
  }

  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <Link
            href="/provider/business"
            className="text-muted-foreground mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Business Services
          </Link>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Quote templates</h1>
          <p className="mt-1 text-zinc-300">
            Save reusable bid wording and a default amount. Templates stay on your account.
          </p>
        </div>

        {!enabled ? (
          <p role="status" className="text-sm text-zinc-300">
            Quote templates are turned off for this account.
          </p>
        ) : (
          <>
            <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
              <CardHeader>
                <CardTitle className="text-lg">New template</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {formError ? (
                  <p role="alert" className="text-destructive text-sm">
                    {formError}
                  </p>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="quote-template-name">Name</Label>
                  <Input
                    id="quote-template-name"
                    value={name}
                    maxLength={120}
                    className="min-h-[44px]"
                    placeholder="Drain unclog standard"
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quote-template-body">Body</Label>
                  <Textarea
                    id="quote-template-body"
                    value={body}
                    maxLength={4000}
                    rows={4}
                    placeholder="Quote wording customers see"
                    onChange={(event) => {
                      setBody(event.target.value);
                    }}
                  />
                  <p className="text-muted-foreground text-xs">{String(body.length)}/4000</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quote-template-amount">Default amount (optional)</Label>
                  <Input
                    id="quote-template-amount"
                    inputMode="decimal"
                    value={amount}
                    className="min-h-[44px]"
                    placeholder="150.00"
                    onChange={(event) => {
                      setAmount(event.target.value);
                    }}
                  />
                </div>
                <Button
                  type="button"
                  className="min-h-[44px]"
                  disabled={createTemplate.isPending}
                  onClick={() => {
                    void onCreate();
                  }}
                >
                  {createTemplate.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  {createTemplate.isPending ? 'Saving…' : 'Save template'}
                </Button>
              </CardContent>
            </Card>

            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : isError ? (
              <div className="space-y-3">
                <p role="alert" className="text-destructive text-sm">
                  {getApiErrorMessage(error, 'Could not load quote templates')}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => {
                    void refetch();
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : templates.length === 0 ? (
              <p className="text-sm text-zinc-300">No quote templates yet.</p>
            ) : (
              <ul className="space-y-3">
                {templates.map((template) => (
                  <li key={template.id}>
                    <Card className="border border-[var(--brand-gold)]/10">
                      <CardContent className="flex items-start justify-between gap-3 p-4">
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium">{template.name}</p>
                          <p className="text-muted-foreground line-clamp-3 text-sm">{template.body}</p>
                          <p className="text-muted-foreground text-xs">
                            {template.default_amount_cents != null
                              ? formatCents(template.default_amount_cents)
                              : 'Amount varies'}
                            {' · '}
                            {String(template.use_count)} uses
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-[44px] shrink-0"
                          aria-label={`Delete ${template.name}`}
                          disabled={deleteTemplate.isPending}
                          onClick={() => {
                            deleteTemplate.mutate(template.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Delete
                        </Button>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </PageTransition>
  );
}
