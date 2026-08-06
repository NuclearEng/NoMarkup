'use client';

import { CreditCard, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { AddPaymentMethodForm } from '@/components/payments/AddPaymentMethodForm';
import { StripeOnboarding } from '@/components/payments/StripeOnboarding';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDeletePaymentMethod,
  usePaymentMethods,
  useStripeAccountStatus,
} from '@/hooks/usePayments';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';
import { useQueryClient } from '@tanstack/react-query';

export default function PaymentMethodsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  // The Stripe Connect payout account is provider-only. Gate the status query
  // (and the payout section below) on the provider role so customers — who only
  // have saved cards for paying — never hit the provider-only endpoint and get
  // a guaranteed 403.
  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;
  const { data: methodsData, isLoading, isError } = usePaymentMethods();
  const deleteMethod = useDeletePaymentMethod();
  const stripeStatus = useStripeAccountStatus({ enabled: isProvider });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const methods = methodsData?.payment_methods ?? [];

  function handleDelete(id: string) {
    if (deletingId === id) {
      void deleteMethod.mutateAsync(id).then(() => {
        setDeletingId(null);
      });
    } else {
      setDeletingId(id);
    }
  }

  function handleAddSuccess() {
    setShowAddForm(false);
    void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">
            Payment Methods
          </h1>
          <p className="mt-1 text-zinc-300">
            {isProvider
              ? 'Manage your payment methods and payout settings'
              : 'Manage your saved payment methods'}
          </p>
        </div>
        {!showAddForm ? (
          <Button
            className="min-h-[44px]"
            onClick={() => { setShowAddForm(true); }}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add Method
          </Button>
        ) : null}
      </div>

      {showAddForm ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <CardTitle className="gold-text text-lg">Add Payment Method</CardTitle>
          </CardHeader>
          <CardContent>
            <AddPaymentMethodForm
              onSuccess={handleAddSuccess}
              onCancel={() => { setShowAddForm(false); }}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Payment Methods List */}
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader>
          <CardTitle className="gold-text flex items-center gap-2 text-lg">
            <CreditCard className="h-5 w-5" aria-hidden="true" />
            Saved Payment Methods
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-destructive/50 p-6 text-center">
              <p className="text-destructive">
                Failed to load payment methods.
              </p>
            </div>
          ) : methods.length === 0 ? (
            <div className="rounded-lg border p-6 text-center">
              <p className="text-zinc-300">
                No payment methods saved yet.
              </p>
              {/* Why an empty list matters here, not just that it's empty:
                  auction wins are charged off-session, so a buyer with no
                  card on file wins the item and then owes money with no way
                  for us to collect until they come back and pay manually. */}
              <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
                Save a card before bidding. When you win an auction we charge
                the card on file automatically — without one, your win sits
                unpaid until you come back and pay it from the order page.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {methods.map((method) => (
                <div
                  key={method.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard
                      className="h-5 w-5 text-zinc-300"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-medium">
                        {method.brand} ending in {method.last_four}
                      </p>
                      <p className="text-sm text-zinc-300">
                        Expires {method.exp_month}/{method.exp_year}
                      </p>
                    </div>
                    {method.is_default ? (
                      <Badge variant="secondary">Default</Badge>
                    ) : null}
                  </div>
                  <Button
                    variant={
                      deletingId === method.id ? 'destructive' : 'ghost'
                    }
                    size="sm"
                    className="min-h-[44px] min-w-[44px]"
                    onClick={() => {
                      handleDelete(method.id);
                    }}
                    aria-label={
                      deletingId === method.id
                        ? `Confirm delete card ending ${method.last_four}`
                        : `Delete card ending ${method.last_four}`
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Provider payout (Stripe Connect) — providers only. Customers don't
          have a payout account, so the section is hidden for them entirely and
          the provider-only status endpoint is never called (no 403). */}
      {isProvider ? (
        <>
          <div className="glass-divider" role="separator" />
          <div className="space-y-2">
            <h2 className="gold-text text-lg font-semibold">Provider Payouts</h2>
            <p className="text-sm text-zinc-300">
              Connect or resume Stripe Connect so you can receive payouts for completed jobs.
            </p>
            {/* Full onboarding surface (create + embedded resume) — not create-only. */}
            <StripeOnboarding />
            {stripeStatus.isError ? (
              <p className="text-sm text-zinc-400">
                Could not load Connect status. Try again from the card above.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
