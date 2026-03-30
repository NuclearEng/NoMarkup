'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PAYMENT_STATUS } from '@/types';

interface PaymentStatusBadgeProps {
  status: string;
  className?: string;
}

function getStatusColor(status: string): string {
  switch (status) {
    case PAYMENT_STATUS.PENDING:
      return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
    case PAYMENT_STATUS.PROCESSING:
      return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800';
    case PAYMENT_STATUS.ESCROW:
      return 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800';
    case PAYMENT_STATUS.RELEASED:
      return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800';
    case PAYMENT_STATUS.COMPLETED:
      return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800';
    case PAYMENT_STATUS.FAILED:
      return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800';
    case PAYMENT_STATUS.REFUNDED:
      return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800';
    case PAYMENT_STATUS.PARTIALLY_REFUNDED:
      return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800';
    case PAYMENT_STATUS.DISPUTED:
      return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800';
    case PAYMENT_STATUS.CHARGEBACK:
      return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
  }
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
