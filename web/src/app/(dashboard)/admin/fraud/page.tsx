'use client';

import { FraudAlertList } from '@/components/admin/FraudAlertList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

  const openCount = openData?.pagination.totalCount ?? 0;
  const criticalCount = criticalData?.pagination.totalCount ?? 0;
  const isLoading = openLoading || criticalLoading;

  const cards = [
    {
      title: 'Open Alerts',
      value: isLoading ? '--' : String(openCount),
      description: 'Alerts awaiting review',
      accentClass: openCount > 0 ? 'text-blue-600' : 'text-foreground',
    },
    {
      title: 'Critical Alerts',
      value: isLoading ? '--' : String(criticalCount),
      description: 'High-priority open alerts',
      accentClass: criticalCount > 0 ? 'text-red-600' : 'text-foreground',
    },
    {
      title: 'Signals This Week',
      value: '--',
      description: 'Aggregate signals (7 days)',
      accentClass: 'text-foreground',
    },
    {
      title: 'False Positive Rate',
      value: '--',
      description: 'Dismissed / total resolved',
      accentClass: 'text-foreground',
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={cn('text-2xl font-bold tabular-nums', card.accentClass)}>
              {card.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AdminFraudPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Fraud Detection</h1>
        <p className="mt-1 text-muted-foreground">
          Monitor fraud signals, investigate alerts, and manage user risk.
        </p>
      </div>

      <SummaryCards />

      <div>
        <h2 className="mb-4 text-lg font-semibold">Fraud Alerts</h2>
        <FraudAlertList />
      </div>
    </div>
  );
}
