'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useReviewFraudAlert } from '@/hooks/useFraud';
import { cn } from '@/lib/utils';
import type { AlertStatus, FraudAlert, FraudSignal, RiskLevel } from '@/types';
import { ALERT_STATUS } from '@/types';

function riskLevelClasses(level: RiskLevel): string {
  switch (level) {
    case 'low':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'high':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'critical':
      return 'bg-red-100 text-red-800 border-red-200';
  }
}

function statusClasses(status: AlertStatus): string {
  switch (status) {
    case 'open':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'investigating':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'resolved_fraud':
    case 'resolved_legitimate':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'dismissed':
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'bg-red-500';
  if (confidence >= 0.5) return 'bg-orange-500';
  return 'bg-yellow-500';
}

function formatSignalType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength) + '...';
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATUS_LABELS: Record<AlertStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  resolved_fraud: 'Resolved (Fraud)',
  resolved_legitimate: 'Resolved (Legitimate)',
  dismissed: 'Dismissed',
};

function SignalRow({ signal }: { signal: FraudSignal }) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{formatSignalType(signal.signal_type)}</span>
          <Badge variant="outline" className={cn('text-xs', riskLevelClasses(signal.risk_level))}>
            {signal.risk_level.toUpperCase()}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">{formatDate(signal.created_at)}</span>
      </div>

      <p className="text-sm text-muted-foreground">{signal.description}</p>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Confidence</span>
          <span className="font-medium">{String(Math.round(signal.confidence * 100))}%</span>
        </div>
        <Progress
          value={signal.confidence * 100}
          className={cn('h-2', confidenceColor(signal.confidence))}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div>
          <span className="text-muted-foreground">IP: </span>
          <span className="font-mono">{signal.ip_address}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Fingerprint: </span>
          <span className="font-mono">{truncate(signal.device_fingerprint, 16)}</span>
        </div>
        <div className="sm:col-span-2">
          <span className="text-muted-foreground">Entity: </span>
          <span className="font-mono">
            {signal.reference_entity_type}/{truncate(signal.reference_entity_id, 12)}
          </span>
        </div>
      </div>
    </div>
  );
}

interface FraudAlertDetailProps {
  alert: FraudAlert;
}

export function FraudAlertDetail({ alert }: FraudAlertDetailProps) {
  const [newStatus, setNewStatus] = useState<AlertStatus>(alert.status);
  const [notes, setNotes] = useState('');
  const [restrictUser, setRestrictUser] = useState(false);

  const reviewMutation = useReviewFraudAlert();

  const isResolved = alert.status === ALERT_STATUS.RESOLVED_FRAUD
    || alert.status === ALERT_STATUS.RESOLVED_LEGITIMATE
    || alert.status === ALERT_STATUS.DISMISSED;

  async function handleSubmitReview() {
    await reviewMutation.mutateAsync({
      alertId: alert.id,
      input: {
        status: newStatus,
        resolution_notes: notes,
        restrict_user: restrictUser,
      },
    });
    setNotes('');
    setRestrictUser(false);
  }

  return (
    <div className="space-y-4">
      {/* Alert header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">Alert Details</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn(riskLevelClasses(alert.aggregate_risk_level))}>
                {alert.aggregate_risk_level.toUpperCase()} RISK
              </Badge>
              <Badge variant="outline" className={cn(statusClasses(alert.status))}>
                {STATUS_LABELS[alert.status]}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="text-muted-foreground">User ID</span>
              <p className="font-mono text-xs mt-0.5">{alert.user_id}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Created</span>
              <p className="mt-0.5">{formatDate(alert.created_at)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Updated</span>
              <p className="mt-0.5">{formatDate(alert.updated_at)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Resolved</span>
              <p className="mt-0.5">{alert.resolved_at ? formatDate(alert.resolved_at) : 'N/A'}</p>
            </div>
          </div>
          {alert.auto_resolved ? (
            <p className="mt-3 text-xs text-muted-foreground italic">
              This alert was auto-resolved by the system.
            </p>
          ) : null}
          {alert.resolution_notes ? (
            <div className="mt-3">
              <span className="text-sm text-muted-foreground">Resolution Notes</span>
              <p className="mt-0.5 text-sm">{alert.resolution_notes}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Signals */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Signals ({String(alert.signals.length)})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alert.signals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No signals recorded for this alert.</p>
          ) : (
            <div className="space-y-3">
              {alert.signals.map((signal) => (
                <SignalRow key={signal.id} signal={signal} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resolution panel */}
      {!isResolved ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resolve Alert</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fraud-status-select">New Status</Label>
              <Select
                value={newStatus}
                onValueChange={(value) => { setNewStatus(value as AlertStatus); }}
              >
                <SelectTrigger id="fraud-status-select" className="min-h-[44px]">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ALERT_STATUS).map(([key, value]) => (
                    <SelectItem key={key} value={value}>
                      {STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fraud-resolution-notes">Resolution Notes</Label>
              <Textarea
                id="fraud-resolution-notes"
                placeholder="Describe the findings and rationale for this decision..."
                value={notes}
                onChange={(e) => { setNotes(e.target.value); }}
                rows={4}
              />
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="fraud-restrict-user"
                checked={restrictUser}
                onCheckedChange={(checked) => { setRestrictUser(checked === true); }}
                className="h-5 w-5"
              />
              <Label htmlFor="fraud-restrict-user" className="cursor-pointer">
                Restrict user account
              </Label>
            </div>

            <Button
              className="min-h-[44px]"
              disabled={reviewMutation.isPending || newStatus === alert.status}
              onClick={() => { void handleSubmitReview(); }}
            >
              {reviewMutation.isPending ? 'Submitting...' : 'Submit Review'}
            </Button>

            {reviewMutation.isError ? (
              <p className="text-sm text-destructive">
                Failed to submit review. Please try again.
              </p>
            ) : null}

            {reviewMutation.isSuccess ? (
              <p className="text-sm text-green-600">
                Alert reviewed successfully.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
