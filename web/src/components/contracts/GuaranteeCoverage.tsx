'use client';

import { CheckCircle, Shield } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth-store';
import type { Contract } from '@/types';
import { CONTRACT_STATUS } from '@/types';

interface GuaranteeCoverageProps {
  contract: Contract;
  className?: string;
}

const COVERAGE_ITEMS = [
  'Quality assurance',
  'On-time completion',
  'No-show protection',
  'Abandonment protection',
];

export function GuaranteeCoverage({ contract, className }: GuaranteeCoverageProps) {
  const user = useAuthStore((state) => state.user);
  const isCustomer = user?.id === contract.customer_id;

  // Only show on active/completed contracts that have a guarantee component
  // We detect guarantee by checking payment fields or status
  const isEligibleStatus =
    contract.status === CONTRACT_STATUS.ACTIVE ||
    contract.status === CONTRACT_STATUS.COMPLETED;

  if (!isEligibleStatus) return null;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" aria-hidden="true" />
          <h3 className="text-lg font-semibold">Protected by NoMarkup Guarantee</h3>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          This contract is covered by the NoMarkup Guarantee. If something goes wrong,
          we have you covered.
        </p>

        <ul className="space-y-2" aria-label="Guarantee coverage items">
          {COVERAGE_ITEMS.map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 shrink-0 text-green-600 dark:text-emerald-400" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>

        {isCustomer ? (
          <Link href={`/contracts/${contract.id}/guarantee-claim` as Route}>
            <Button variant="outline" className="min-h-[44px] w-full">
              File a Claim
            </Button>
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
