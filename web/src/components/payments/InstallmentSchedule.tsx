'use client';

import { Check, Circle, Clock } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { InstallmentInfo } from '@/types';

interface InstallmentScheduleProps {
  installments: InstallmentInfo[];
  className?: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getInstallmentState(installment: InstallmentInfo): 'paid' | 'current' | 'upcoming' {
  if (installment.paid_at || installment.status === 'completed' || installment.status === 'released') {
    return 'paid';
  }
  if (
    installment.status === 'pending' ||
    installment.status === 'processing' ||
    installment.status === 'escrow'
  ) {
    return 'current';
  }
  return 'upcoming';
}

export function InstallmentSchedule({ installments, className }: InstallmentScheduleProps) {
  if (installments.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Payment Schedule</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative space-y-0">
          {installments.map((installment, index) => {
            const state = getInstallmentState(installment);
            const isLast = index === installments.length - 1;

            return (
              <div key={installment.installment_number} className="flex gap-4">
                {/* Timeline line and circle */}
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      state === 'paid' && 'bg-green-100 text-green-700',
                      state === 'current' && 'bg-blue-100 text-blue-700',
                      state === 'upcoming' && 'bg-muted text-muted-foreground',
                    )}
                    aria-label={`Installment ${String(installment.installment_number)}: ${state}`}
                  >
                    {state === 'paid' ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : state === 'current' ? (
                      <Clock className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Circle className="h-4 w-4" aria-hidden="true" />
                    )}
                  </div>
                  {!isLast ? (
                    <div
                      className={cn(
                        'w-0.5 flex-1 min-h-[24px]',
                        state === 'paid' ? 'bg-green-200' : 'bg-muted',
                      )}
                    />
                  ) : null}
                </div>

                {/* Installment details */}
                <div className="flex-1 pb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        Payment {String(installment.installment_number)} of{' '}
                        {String(installment.total_installments)}
                      </p>
                      {installment.paid_at ? (
                        <p className="text-xs text-green-600">
                          Paid {formatDate(installment.paid_at)}
                        </p>
                      ) : installment.due_date ? (
                        <p className="text-xs text-muted-foreground">
                          Due {formatDate(installment.due_date)}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Upcoming</p>
                      )}
                    </div>
                    <p className="text-sm font-bold tabular-nums">
                      {formatCents(installment.amount_cents)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
