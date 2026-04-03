'use client';

import { FraudAlertList } from '@/components/admin/FraudAlertList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { useFraudAlerts } from '@/hooks/useFraud';
import { cn } from '@/lib/utils';
import { ALERT_STATUS, RISK_LEVEL } from '@/types';

function SummaryCards() {
  const { data: openData, isLoading: openLoading } = useFraudAlerts({
    status: ALERT_STATUS.OPEN,
    page: 1,
    pageSize: 1,
  });

  const { data: criticalData, isLoading: criticalLoading } = useFraudAlerts({
    status: ALERT_STATUS.OPEN,
    risk_level: RISK_LEVEL.CRITICAL,
    page: 1,
    pageSize: 1,
  });

  const { data: resolvedData, isLoading: resolvedLoading } = useFraudAlerts({
    status: ALERT_STATUS.RESOLVED_FRAUD,
    page: 1,
    pageSize: 1,
  });

  const { data: dismissedData, isLoading: dismissedLoading } = useFraudAlerts({
    status: ALERT_STATUS.DISMISSED,
    page: 1,
    pageSize: 1,
  });

  const openCount = openData?.pagination.totalCount ?? 0;
  const criticalCount = criticalData?.pagination.totalCount ?? 0;
  const resolvedCount = resolvedData?.pagination.totalCount ?? 0;
  const dismissedCount = dismissedData?.pagination.totalCount ?? 0;

  // Calculate total signals from open alerts
  const totalSignals = openData?.alerts.reduce(
    (sum, alert) => sum + alert.signals.length,
    0,
  ) ?? 0;

  // False positive rate: dismissed / (resolved + dismissed)
  const totalResolved = resolvedCount + dismissedCount;
  const falsePositiveRate = totalResolved > 0
    ? ((dismissedCount / totalResolved) * 100).toFixed(1)
    : '0.0';

  const cards = [
    {
      title: 'Open Alerts',
      value: openLoading ? null : String(openCount),
      description: 'Alerts awaiting review',
      accentClass: openCount > 0 ? 'text-blue-600' : 'text-foreground',
      loading: openLoading,
    },
    {
      title: 'Critical Alerts',
      value: criticalLoading ? null : String(criticalCount),
      description: 'High-priority open alerts',
      accentClass: criticalCount > 0 ? 'text-red-600' : 'text-foreground',
      loading: criticalLoading,
    },
    {
      title: 'Open Signals',
      value: openLoading ? null : String(totalSignals),
      description: 'Signals in open alerts',
      accentClass: 'text-foreground',
      loading: openLoading,
    },
    {
      title: 'False Positive Rate',
      value: resolvedLoading || dismissedLoading ? null : `${falsePositiveRate}%`,
      description: 'Dismissed / total resolved',
      accentClass: 'text-foreground',
      loading: resolvedLoading || dismissedLoading,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              {card.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {card.loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className={cn('text-2xl font-bold tabular-nums', card.accentClass)}>
                {card.value}
              </p>
            )}
            <p className="mt-1 text-xs text-zinc-400">{card.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AdminFraudPage() {
  return (
    <PageTransition>
    <div className="space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Fraud Detection</h1>
        <p className="mt-1 text-zinc-400">
          Monitor fraud signals, investigate alerts, and manage user risk.
        </p>
      </div>

      <SummaryCards />

      <div>
        <h2 className="mb-4 text-lg font-semibold">Fraud Alerts</h2>
        <FraudAlertList />
      </div>
    </div>
    </PageTransition>
  );
}
