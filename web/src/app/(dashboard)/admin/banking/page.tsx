'use client';

import { useState } from 'react';

import { Landmark, ShieldCheck } from 'lucide-react';
import { z } from 'zod';

import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageTransition } from '@/components/ui/page-transition';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDeletePlatformBankAccount,
  usePlatformBanking,
  useSetPlatformBankAccount,
} from '@/hooks/useAdmin';
import { getStripe } from '@/lib/stripe';
import type { BankAccountHolderType, PlatformBankAccount } from '@/types';
import { BANK_ACCOUNT_HOLDER_TYPE } from '@/types';

// Only the tokenizable, non-sensitive fields live in component state. The raw
// routing/account numbers are read straight off the inputs at submit time and
// handed to Stripe.js — they are never echoed, logged, or sent to our backend.
const bankFormSchema = z.object({
  accountHolderName: z.string().trim().min(1, 'Account holder name is required'),
  routingNumber: z
    .string()
    .trim()
    .regex(/^\d{9}$/, 'Routing number must be 9 digits'),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{4,17}$/, 'Account number must be 4-17 digits'),
});

type BankFormErrors = Partial<Record<keyof z.infer<typeof bankFormSchema>, string>>;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function CurrentAccountCard({ account }: { account: PlatformBankAccount }) {
  const deleteAccount = useDeletePlatformBankAccount();

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader>
        <CardTitle className="gold-text flex items-center gap-2 text-base">
          <Landmark className="h-4 w-4" aria-hidden="true" />
          Current Payout Account
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-400">Bank</dt>
            <dd className="text-sm text-zinc-100">{account.bank_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-400">
              Account holder
            </dt>
            <dd className="text-sm text-zinc-100">
              {account.account_holder_name} ({account.account_holder_type})
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-400">
              Account number
            </dt>
            <dd className="font-mono text-sm text-zinc-100">••••{account.last4}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-400">
              Routing number
            </dt>
            <dd className="font-mono text-sm text-zinc-100">••••{account.routing_last4}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-400">
              Currency / Country
            </dt>
            <dd className="text-sm text-zinc-100">
              {account.currency.toUpperCase()} · {account.country.toUpperCase()}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-400">Status</dt>
            <dd>
              <Badge variant="outline" className="text-xs">
                {account.status.replace(/_/g, ' ')}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-400">Added</dt>
            <dd className="text-sm text-zinc-100">{formatDate(account.created_at)}</dd>
          </div>
        </dl>

        <Button
          variant="destructive"
          className="min-h-[44px]"
          disabled={deleteAccount.isPending}
          onClick={() => {
            deleteAccount.mutate(account.id);
          }}
        >
          {deleteAccount.isPending ? 'Removing...' : 'Remove account'}
        </Button>
      </CardContent>
    </Card>
  );
}

function BankAccountForm() {
  const setAccount = useSetPlatformBankAccount();

  const [accountHolderName, setAccountHolderName] = useState('');
  const [accountHolderType, setAccountHolderType] = useState<BankAccountHolderType>(
    BANK_ACCOUNT_HOLDER_TYPE.COMPANY,
  );
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [errors, setErrors] = useState<BankFormErrors>({});
  const [tokenizing, setTokenizing] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  async function handleSubmit() {
    setStripeError(null);

    const parsed = bankFormSchema.safeParse({
      accountHolderName,
      routingNumber,
      accountNumber,
    });
    if (!parsed.success) {
      const next: BankFormErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && !(field in next)) {
          next[field as keyof BankFormErrors] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});

    setTokenizing(true);
    try {
      const stripe = await getStripe();
      if (!stripe) {
        setStripeError('Unable to load Stripe. Please try again.');
        return;
      }

      // Raw numbers go straight to Stripe and are exchanged for a single-use
      // bank-account token. Only that token (btok_...) is sent to our backend.
      const result = await stripe.createToken('bank_account', {
        country: 'US',
        currency: 'usd',
        account_holder_name: parsed.data.accountHolderName,
        account_holder_type: accountHolderType,
        routing_number: parsed.data.routingNumber,
        account_number: parsed.data.accountNumber,
      });

      // TokenResult is a discriminated union: either { token } or { error }.
      if (result.error) {
        setStripeError(result.error.message ?? 'Failed to verify bank account.');
        return;
      }

      await setAccount.mutateAsync({
        bank_account_token: result.token.id,
        account_holder_name: parsed.data.accountHolderName,
        account_holder_type: accountHolderType,
      });

      // Clear sensitive fields after a successful save.
      setAccountHolderName('');
      setRoutingNumber('');
      setAccountNumber('');
    } finally {
      setTokenizing(false);
    }
  }

  const submitting = tokenizing || setAccount.isPending;

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader>
        <CardTitle className="gold-text text-base">Set Payout Bank Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-[var(--brand-gold)]/10 bg-white/[0.02] p-3 text-sm text-zinc-300">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-gold)]"
            aria-hidden="true"
          />
          <p>
            Account and routing numbers are sent directly to Stripe and tokenized in your
            browser. They never reach NoMarkup&apos;s servers — we only store the resulting
            token and the last 4 digits.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="account-holder-name">Account holder name</Label>
            <Input
              id="account-holder-name"
              autoComplete="off"
              placeholder="NoMarkup Inc."
              value={accountHolderName}
              onChange={(e) => {
                setAccountHolderName(e.target.value);
              }}
              className="min-h-[44px]"
              aria-invalid={errors.accountHolderName ? true : undefined}
              aria-describedby={
                errors.accountHolderName ? 'account-holder-name-error' : undefined
              }
            />
            {errors.accountHolderName ? (
              <p id="account-holder-name-error" className="text-sm text-destructive">
                {errors.accountHolderName}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="account-holder-type">Account holder type</Label>
            <Select
              value={accountHolderType}
              onValueChange={(v) => {
                setAccountHolderType(v as BankAccountHolderType);
              }}
            >
              <SelectTrigger
                id="account-holder-type"
                className="min-h-[44px]"
                aria-label="Account holder type"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BANK_ACCOUNT_HOLDER_TYPE.COMPANY}>Company</SelectItem>
                <SelectItem value={BANK_ACCOUNT_HOLDER_TYPE.INDIVIDUAL}>
                  Individual
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="routing-number">Routing number</Label>
            <Input
              id="routing-number"
              inputMode="numeric"
              autoComplete="off"
              placeholder="110000000"
              value={routingNumber}
              onChange={(e) => {
                setRoutingNumber(e.target.value);
              }}
              className="min-h-[44px]"
              aria-invalid={errors.routingNumber ? true : undefined}
              aria-describedby={errors.routingNumber ? 'routing-number-error' : undefined}
            />
            {errors.routingNumber ? (
              <p id="routing-number-error" className="text-sm text-destructive">
                {errors.routingNumber}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="account-number">Account number</Label>
            <Input
              id="account-number"
              inputMode="numeric"
              autoComplete="off"
              placeholder="000123456789"
              value={accountNumber}
              onChange={(e) => {
                setAccountNumber(e.target.value);
              }}
              className="min-h-[44px]"
              aria-invalid={errors.accountNumber ? true : undefined}
              aria-describedby={errors.accountNumber ? 'account-number-error' : undefined}
            />
            {errors.accountNumber ? (
              <p id="account-number-error" className="text-sm text-destructive">
                {errors.accountNumber}
              </p>
            ) : null}
          </div>
        </div>

        <Button
          className="min-h-[44px]"
          disabled={submitting}
          onClick={() => {
            void handleSubmit();
          }}
        >
          {submitting ? 'Saving...' : 'Save bank account'}
        </Button>

        {stripeError ? (
          <p className="text-sm text-destructive" role="alert">
            {stripeError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function AdminBankingPage() {
  const { data, isLoading, isError } = usePlatformBanking();

  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Platform Banking</h1>
          <p className="mt-1 text-zinc-300">
            The bank account where all collected platform fees are paid out.
          </p>
        </div>

        {isLoading ? (
          <Card className="glass border border-[var(--brand-gold)]/10">
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ) : isError ? (
          <EmptyState
            icon={<AnimatedIllustration type="error" size="sm" />}
            title="Failed to load banking details"
            description="Please try refreshing the page."
          />
        ) : data?.account ? (
          <CurrentAccountCard account={data.account} />
        ) : (
          <EmptyState
            icon={<Landmark className="h-10 w-10 text-zinc-500" aria-hidden="true" />}
            title="No payout account set"
            description="Add a bank account below to start routing platform fees."
          />
        )}

        <BankAccountForm />
      </div>
    </PageTransition>
  );
}
