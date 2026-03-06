'use client';

import { CreditCard, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  useCreateStripeAccount,
  useDeletePaymentMethod,
  usePaymentMethods,
  useStripeAccountStatus,
} from '@/hooks/usePayments';

export default function PaymentMethodsPage() {
  const { data: methodsData, isLoading, isError } = usePaymentMethods();
  const deleteMethod = useDeletePaymentMethod();
  const stripeStatus = useStripeAccountStatus();
  const createStripeAccount = useCreateStripeAccount();
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Payment Methods
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage your payment methods and payout settings
          </p>
        </div>
        <Button className="min-h-[44px]" disabled>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add Method
        </Button>
      </div>

      {/* Payment Methods List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CreditCard className="h-5 w-5" aria-hidden="true" />
            Saved Payment Methods
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg border bg-muted"
                />
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
              <p className="text-muted-foreground">
                No payment methods saved yet.
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
                      className="h-5 w-5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-medium">
                        {method.brand} ending in {method.last_four}
                      </p>
                      <p className="text-sm text-muted-foreground">
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

      <Separator />

      {/* Stripe Connect Status (for providers) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Provider Payouts</CardTitle>
        </CardHeader>
        <CardContent>
          {stripeStatus.isLoading ? (
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
          ) : stripeStatus.isError ? (
            <p className="text-sm text-muted-foreground">
              Payout settings are only available for provider accounts.
            </p>
          ) : stripeStatus.data ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Account Status:</span>
                <Badge
                  variant={
                    stripeStatus.data.charges_enabled
                      ? 'default'
                      : 'secondary'
                  }
                >
                  {stripeStatus.data.charges_enabled
                    ? 'Active'
                    : 'Setup Required'}
                </Badge>
              </div>
              {!stripeStatus.data.charges_enabled ? (
                <p className="text-sm text-muted-foreground">
                  Complete your Stripe account setup to receive payouts for
                  completed jobs.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Your Stripe account is connected and ready to receive payouts.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Connect a Stripe account to receive payouts for completed jobs.
              </p>
              <Button
                className="min-h-[44px]"
                onClick={() => {
                  void createStripeAccount.mutateAsync();
                }}
                disabled={createStripeAccount.isPending}
              >
                {createStripeAccount.isPending
                  ? 'Setting up...'
                  : 'Set Up Payouts'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
