'use client';

import { useState } from 'react';
import { Zap } from 'lucide-react';

import { useInstantPayout } from '@/hooks/usePayments';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useFeatureFlag } from '@/hooks/useFeatureFlags';
import { formatCents } from '@/lib/utils';

interface InstantPayoutButtonProps {
  availableBalanceCents?: number;
}

export function InstantPayoutButton({ availableBalanceCents = 0 }: InstantPayoutButtonProps) {
  const instantPayoutEnabled = useFeatureFlag('instant_payout');
  const [amountDollars, setAmountDollars] = useState<string>(
    availableBalanceCents > 0 ? String(Math.floor(availableBalanceCents / 100)) : '',
  );
  const instantPayout = useInstantPayout();

  // Hide the entry point entirely when the feature is off (admin toggle).
  // The gateway also enforces this with a 503, so this is the UX layer.
  if (!instantPayoutEnabled) return null;

  const amountCents = Math.round(parseFloat(amountDollars || '0') * 100);
  const feeCents = Math.round(amountCents * 0.01);
  const netCents = amountCents - feeCents;
  const isValid = amountCents > 0 && amountCents <= availableBalanceCents;

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isValid) return;
    instantPayout.mutate(amountCents);
  }

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-zinc-300 text-sm font-medium">Instant Payout</CardTitle>
        <Zap className="text-[var(--brand-gold)] h-4 w-4" aria-hidden="true" />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-zinc-400">
          Get paid now. <span className="text-zinc-300 font-medium">1% fee.</span> Funds arrive
          within minutes.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="payout-amount" className="text-xs text-zinc-400">
              Amount (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                $
              </span>
              <Input
                id="payout-amount"
                type="number"
                min="1"
                step="0.01"
                max={String(Math.floor(availableBalanceCents / 100))}
                value={amountDollars}
                onChange={(e) => {
                  setAmountDollars(e.target.value);
                }}
                className="pl-7 min-h-[44px]"
                placeholder="0.00"
                aria-describedby="payout-fee-note"
              />
            </div>
          </div>

          {amountCents > 0 ? (
            <div
              id="payout-fee-note"
              className="rounded-md border border-[var(--brand-gold)]/10 bg-[var(--brand-gold)]/5 p-3 space-y-1"
            >
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Amount</span>
                <span className="text-zinc-300">{formatCents(amountCents)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Fee (1%)</span>
                <span className="text-zinc-400">-{formatCents(feeCents)}</span>
              </div>
              <div className="glass-divider" aria-hidden="true" />
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-zinc-300">You receive</span>
                <span className="text-emerald-400">{formatCents(netCents)}</span>
              </div>
            </div>
          ) : null}

          {availableBalanceCents > 0 ? (
            <p className="text-xs text-zinc-500">
              Available: {formatCents(availableBalanceCents)}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={!isValid || instantPayout.isPending}
            className="min-h-[44px] w-full gap-2"
          >
            <Zap className="h-4 w-4" aria-hidden="true" />
            {instantPayout.isPending ? 'Processing...' : 'Instant Payout'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
