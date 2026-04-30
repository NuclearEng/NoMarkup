'use client';

/**
 * /me/referrals — referral program dashboard.
 *
 * Shows the user's code, a copyable share message, the credit balance
 * from the ledger, the redeem-a-friend's-code form, and a table of
 * referrals the user has made.
 */

import { useState } from 'react';
import { toast } from 'sonner';

import { useMyReferrals, useRedeemReferral, useReferralCode } from '@/hooks/useReferrals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatDollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function ReferralsPage() {
  const codeQ = useReferralCode();
  const listQ = useMyReferrals();
  const redeem = useRedeemReferral();
  const [redeemCode, setRedeemCode] = useState('');

  async function copyShareLink() {
    if (!codeQ.data) return;
    try {
      await navigator.clipboard.writeText(codeQ.data.share_url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy — tap and hold to copy manually');
    }
  }

  async function copyCode() {
    if (!codeQ.data) return;
    try {
      await navigator.clipboard.writeText(codeQ.data.code);
      toast.success('Code copied');
    } catch {
      toast.error('Could not copy');
    }
  }

  async function handleRedeem(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!redeemCode.trim()) return;
    await redeem.mutateAsync(redeemCode.trim().toUpperCase());
    setRedeemCode('');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Refer a friend</h1>
      <p className="text-sm text-white/70">
        Give a friend $10 off their first transaction. We'll credit you $10 too once
        they complete their first purchase or sale.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Your referral code</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {codeQ.isLoading ? (
            <p className="text-sm text-white/50">Loading…</p>
          ) : codeQ.data ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <code className="rounded-md bg-white/10 px-3 py-2 font-mono text-lg tracking-widest">
                  {codeQ.data.code}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void copyCode();
                  }}
                  className="min-h-[44px]"
                >
                  Copy code
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void copyShareLink();
                  }}
                  className="min-h-[44px]"
                >
                  Copy share link
                </Button>
              </div>
              <p className="text-sm text-white/60">{codeQ.data.share_message}</p>
              <p className="text-xs text-white/40">
                Available credit:{' '}
                <span className="font-semibold text-white">
                  {formatDollars(listQ.data?.credit_balance_cents ?? 0)}
                </span>
              </p>
            </>
          ) : (
            <p className="text-sm text-red-400">Could not load your code. Try again.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Redeem a friend's code</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              void handleRedeem(e);
            }}
            className="flex flex-wrap gap-3"
          >
            <Input
              value={redeemCode}
              onChange={(e) => {
                setRedeemCode(e.target.value.toUpperCase());
              }}
              placeholder="ABCD2345"
              className="min-h-[44px] max-w-[200px] font-mono tracking-widest"
              aria-label="Referral code"
            />
            <Button
              type="submit"
              disabled={redeem.isPending || !redeemCode.trim()}
              className="min-h-[44px]"
            >
              {redeem.isPending ? 'Redeeming…' : 'Redeem'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your referrals</CardTitle>
        </CardHeader>
        <CardContent>
          {listQ.isLoading ? (
            <p className="text-sm text-white/50">Loading…</p>
          ) : (listQ.data?.referrals.length ?? 0) === 0 ? (
            <p className="text-sm text-white/50">No referrals yet. Share your code to get started.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5 text-left">
                    <th scope="col" className="px-3 py-2 text-white/70">Status</th>
                    <th scope="col" className="px-3 py-2 text-white/70">Credit</th>
                    <th scope="col" className="px-3 py-2 text-white/70">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQ.data?.referrals ?? []).map((r) => (
                    <tr key={r.id} className="border-b border-white/5 last:border-0">
                      <td className="px-3 py-2">{r.status}</td>
                      <td className="px-3 py-2">{formatDollars(r.credit_cents)}</td>
                      <td className="px-3 py-2 text-white/60">
                        {new Date(r.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
