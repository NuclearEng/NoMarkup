'use client';

// Connected OAuth accounts (ASR-5.1.1.v) — Settings → Security.
// Disconnect is lockout-safe on the server (password or another oauth remains).

import { Link2, Unlink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOAuthAccounts, useUnlinkOAuthAccount } from '@/hooks/useOAuthAccounts';

function providerLabel(provider: string): string {
  switch (provider) {
    case 'google':
      return 'Google';
    case 'apple':
      return 'Apple';
    case 'facebook':
      return 'Facebook';
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

export function ConnectedAccounts() {
  const { data, isLoading, isError } = useOAuthAccounts();
  const unlink = useUnlinkOAuthAccount();

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader>
        <CardTitle className="gold-text flex items-center gap-2 text-lg">
          <Link2 className="h-5 w-5" aria-hidden="true" />
          Connected accounts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-zinc-300">
          Social sign-in providers linked to this account. Disconnecting is
          blocked if it would leave you with no way to sign in — set a password
          first if this is your only method.
        </p>

        {isLoading ? <Skeleton className="h-16 w-full" /> : null}

        {isError ? (
          <p className="text-sm text-destructive" role="alert">
            Could not load connected accounts. Try again later.
          </p>
        ) : null}

        {!isLoading && !isError && (data?.accounts.length ?? 0) === 0 ? (
          <p className="text-sm text-zinc-400" data-testid="connected-accounts-empty">
            No social accounts connected. You sign in with email and password.
          </p>
        ) : null}

        <ul className="space-y-2" data-testid="connected-accounts-list">
          {(data?.accounts ?? []).map((account) => (
            <li
              key={account.provider}
              className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-100">
                  {providerLabel(account.provider)}
                </p>
                {account.email ? (
                  <p className="truncate text-xs text-zinc-400">{account.email}</p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[44px] shrink-0 gap-1.5"
                data-testid={`unlink-oauth-${account.provider}`}
                disabled={unlink.isPending}
                onClick={() => {
                  unlink.mutate(account.provider);
                }}
                aria-label={`Disconnect ${providerLabel(account.provider)}`}
              >
                <Unlink className="h-4 w-4" aria-hidden="true" />
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
