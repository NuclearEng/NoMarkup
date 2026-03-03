'use client';

import { CreditCard, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useDeletePaymentMethod, usePaymentMethods } from '@/hooks/usePayments';
import type { PaymentMethod } from '@/types';

function PaymentMethodCard({
  method,
  onDelete,
  isDeleting,
}: {
  method: PaymentMethod;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Card>
      <CardContent className="flex min-h-[44px] items-center gap-4 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <CreditCard className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium capitalize">{method.brand}</span>
            <span className="text-sm text-muted-foreground">
              **** {method.last_four}
            </span>
            {method.is_default ? (
              <Badge variant="secondary" className="text-xs">
                Default
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Expires {String(method.exp_month).padStart(2, '0')}/{String(method.exp_year).slice(-2)}
          </p>
        </div>

        <div>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                className="min-h-[44px]"
                disabled={isDeleting}
                onClick={() => { onDelete(method.id); }}
              >
                {isDeleting ? 'Removing...' : 'Confirm'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                onClick={() => { setConfirmDelete(false); }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[44px] text-muted-foreground hover:text-destructive"
              onClick={() => { setConfirmDelete(true); }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Delete payment method</span>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PaymentMethodList() {
  const { data, isLoading, isError } = usePaymentMethods();
  const deleteMethod = useDeletePaymentMethod();

  function handleDelete(id: string) {
    void deleteMethod.mutateAsync(id);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 animate-pulse rounded-md bg-muted" />
                <div className="space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load payment methods. Please try refreshing the page.
      </div>
    );
  }

  const methods = data?.payment_methods ?? [];

  if (methods.length === 0) {
    return (
      <Card>
        <CardHeader />
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8">
            <CreditCard className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
            <p className="mt-4 text-lg font-medium">No payment methods</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No payment methods saved yet.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {methods.map((method) => (
        <PaymentMethodCard
          key={method.id}
          method={method}
          onDelete={handleDelete}
          isDeleting={deleteMethod.isPending}
        />
      ))}
    </div>
  );
}
