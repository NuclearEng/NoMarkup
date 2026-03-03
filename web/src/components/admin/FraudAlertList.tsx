'use client';

import { useState } from 'react';

import { FraudAlertDetail } from '@/components/admin/FraudAlertDetail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFraudAlerts } from '@/hooks/useFraud';
import { cn } from '@/lib/utils';
import type { AlertStatus, FraudAlert, RiskLevel } from '@/types';
import { ALERT_STATUS, RISK_LEVEL } from '@/types';

const ALL_FILTER = '__all__';

const RISK_LEVEL_CLASSES: Record<RiskLevel, string> = {
  low: 'bg-green-100 text-green-800 border-green-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
};

const STATUS_CLASSES: Record<AlertStatus, string> = {
  open: 'bg-blue-100 text-blue-800 border-blue-200',
  investigating: 'bg-purple-100 text-purple-800 border-purple-200',
  resolved_fraud: 'bg-green-100 text-green-800 border-green-200',
  resolved_legitimate: 'bg-green-100 text-green-800 border-green-200',
  dismissed: 'bg-gray-100 text-gray-800 border-gray-200',
};

const STATUS_LABELS: Record<AlertStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  resolved_fraud: 'Resolved (Fraud)',
  resolved_legitimate: 'Resolved (Legit)',
  dismissed: 'Dismissed',
};

const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return id.slice(0, 8) + '...';
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function FraudAlertList() {
  const [statusFilter, setStatusFilter] = useState<AlertStatus | undefined>(ALERT_STATUS.OPEN);
  const [riskFilter, setRiskFilter] = useState<RiskLevel | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);

  const { data, isLoading, isError } = useFraudAlerts({
    status: statusFilter,
    risk_level: riskFilter,
    page,
    pageSize: 20,
  });

  function handleStatusChange(value: string) {
    setStatusFilter(value === ALL_FILTER ? undefined : (value as AlertStatus));
    setPage(1);
    setExpandedAlertId(null);
  }

  function handleRiskChange(value: string) {
    setRiskFilter(value === ALL_FILTER ? undefined : (value as RiskLevel));
    setPage(1);
    setExpandedAlertId(null);
  }

  function handleToggleExpand(alert: FraudAlert) {
    setExpandedAlertId((prev) => (prev === alert.id ? null : alert.id));
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <FilterBar
          statusFilter={statusFilter}
          riskFilter={riskFilter}
          onStatusChange={handleStatusChange}
          onRiskChange={handleRiskChange}
        />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i}>
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-5 w-16 animate-pulse rounded bg-muted" />
                  <div className="h-5 w-20 animate-pulse rounded bg-muted" />
                  <div className="flex-1" />
                  <div className="h-4 w-12 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <FilterBar
          statusFilter={statusFilter}
          riskFilter={riskFilter}
          onStatusChange={handleStatusChange}
          onRiskChange={handleRiskChange}
        />
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load fraud alerts. Please try refreshing the page.
        </div>
      </div>
    );
  }

  const alerts = data?.alerts ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-4">
      <FilterBar
        statusFilter={statusFilter}
        riskFilter={riskFilter}
        onStatusChange={handleStatusChange}
        onRiskChange={handleRiskChange}
      />

      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border bg-muted/50 py-12">
          <p className="text-lg font-medium">No alerts found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No fraud alerts match the current filters.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Table header */}
          <div className="hidden items-center gap-4 rounded-md bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground sm:flex">
            <span className="w-28">User ID</span>
            <span className="w-20">Risk Level</span>
            <span className="w-28">Status</span>
            <span className="w-16 text-center">Signals</span>
            <span className="flex-1 text-right">Created</span>
          </div>

          {alerts.map((alert) => (
            <div key={alert.id}>
              <button
                type="button"
                className={cn(
                  'w-full rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50',
                  expandedAlertId === alert.id && 'ring-2 ring-primary/20',
                )}
                style={{ minHeight: '44px' }}
                onClick={() => { handleToggleExpand(alert); }}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-28 font-mono text-xs">
                    {truncateId(alert.user_id)}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn('w-fit text-xs', RISK_LEVEL_CLASSES[alert.aggregate_risk_level])}
                  >
                    {RISK_LABELS[alert.aggregate_risk_level]}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn('w-fit text-xs', STATUS_CLASSES[alert.status])}
                  >
                    {STATUS_LABELS[alert.status]}
                  </Badge>
                  <span className="w-16 text-center text-sm tabular-nums">
                    {String(alert.signals.length)}
                  </span>
                  <span className="flex-1 text-right text-xs text-muted-foreground">
                    {formatDate(alert.created_at)}
                  </span>
                </div>
              </button>

              {expandedAlertId === alert.id ? (
                <div className="mt-2 ml-0 sm:ml-4">
                  <FraudAlertDetail alert={alert} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            className="min-h-[44px]"
            disabled={page <= 1}
            onClick={() => { setPage((p) => p - 1); }}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {String(page)} of {String(pagination.totalPages)}
          </span>
          <Button
            variant="outline"
            className="min-h-[44px]"
            disabled={!pagination.hasNext}
            onClick={() => { setPage((p) => p + 1); }}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

interface FilterBarProps {
  statusFilter: AlertStatus | undefined;
  riskFilter: RiskLevel | undefined;
  onStatusChange: (value: string) => void;
  onRiskChange: (value: string) => void;
}

function FilterBar({ statusFilter, riskFilter, onStatusChange, onRiskChange }: FilterBarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Status:</span>
        <Select value={statusFilter ?? ALL_FILTER} onValueChange={onStatusChange}>
          <SelectTrigger className="w-[180px] min-h-[44px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>All Statuses</SelectItem>
            {Object.entries(ALERT_STATUS).map(([key, value]) => (
              <SelectItem key={key} value={value}>
                {STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Risk:</span>
        <Select value={riskFilter ?? ALL_FILTER} onValueChange={onRiskChange}>
          <SelectTrigger className="w-[180px] min-h-[44px]">
            <SelectValue placeholder="All levels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>All Levels</SelectItem>
            {Object.entries(RISK_LEVEL).map(([key, value]) => (
              <SelectItem key={key} value={value}>
                {RISK_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
