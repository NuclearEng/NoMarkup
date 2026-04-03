'use client';

import { Badge } from '@/components/ui/badge';
import { PAYMENT_STATUS_CLASSES } from '@/lib/status-badge-classes';
import { cn } from '@/lib/utils';
import { PAYMENT_STATUS } from '@/types';

interface PaymentStatusBadgeProps {
  status: string;
  className?: string;
}

const DEFAULT_STATUS_CLASS = 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30';

function getStatusColor(status: string): string {
  return PAYMENT_STATUS_CLASSES[status] ?? DEFAULT_STATUS_CLASS;
}

function getStatusLabel(status: string): string {
  switch (status) {
    case PAYMENT_STATUS.PENDING:
      return 'Pending';
    case PAYMENT_STATUS.PROCESSING:
      return 'Processing';
    case PAYMENT_STATUS.ESCROW:
      return 'In Escrow';
    case PAYMENT_STATUS.RELEASED:
      return 'Released';
    case PAYMENT_STATUS.COMPLETED:
      return 'Completed';
    case PAYMENT_STATUS.FAILED:
      return 'Failed';
    case PAYMENT_STATUS.REFUNDED:
      return 'Refunded';
    case PAYMENT_STATUS.PARTIALLY_REFUNDED:
      return 'Partially Refunded';
    case PAYMENT_STATUS.DISPUTED:
      return 'Disputed';
    case PAYMENT_STATUS.CHARGEBACK:
      return 'Chargeback';
    default:
      return status.replace(/_/g, ' ');
  }
}

function PaymentStatusBadge({ status, className }: PaymentStatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn(getStatusColor(status), className)}>
      {getStatusLabel(status)}
    </Badge>
  );
}

export { PaymentStatusBadge, getStatusLabel, getStatusColor };
