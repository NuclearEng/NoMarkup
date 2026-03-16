'use client';

import { Separator } from '@/components/ui/separator';
import { formatCents } from '@/lib/utils';
import type { Contract } from '@/types';

interface InvoiceTemplateProps {
  contract: Contract;
  providerName: string;
  providerAddress?: string;
  className?: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function InvoiceTemplate({
  contract,
  providerName,
  providerAddress,
  className,
}: InvoiceTemplateProps) {
  const milestones = contract.milestones;
  const subtotal = milestones.reduce((sum, m) => sum + m.amount_cents, 0);
  // If milestones don't account for full amount, show the difference as a general line item
  const remainder = contract.amount_cents - subtotal;

  return (
    <div className={`space-y-6 print:text-black ${className ?? ''}`}>
      {/* Print-friendly CSS */}
      <style>{`
        @media print {
          nav, header, footer, .no-print { display: none !important; }
          body { background: white !important; }
          .print\\:text-black { color: black !important; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">INVOICE</h2>
          <p className="mt-1 text-sm text-muted-foreground print:text-gray-600">
            {contract.contract_number}
          </p>
        </div>
        <div className="text-right">
          <p className="font-bold">NoMarkup</p>
          <p className="text-sm text-muted-foreground print:text-gray-600">
            Service Marketplace Platform
          </p>
        </div>
      </div>

      <Separator />

      {/* Provider and dates */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground print:text-gray-600">
            From
          </p>
          <p className="mt-1 font-medium">{providerName}</p>
          {providerAddress ? (
            <p className="text-sm text-muted-foreground print:text-gray-600">{providerAddress}</p>
          ) : null}
        </div>
        <div className="text-right">
          <div className="space-y-1">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground print:text-gray-600">
                Invoice Date
              </p>
              <p className="text-sm">
                {contract.completed_at ? formatDate(contract.completed_at) : formatDate(contract.created_at)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground print:text-gray-600">
                Job
              </p>
              <p className="text-sm">{contract.job_title || contract.job_id.slice(0, 8)}</p>
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* Line items */}
      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="pb-2 text-left font-medium text-muted-foreground print:text-gray-600">
                Description
              </th>
              <th className="pb-2 text-right font-medium text-muted-foreground print:text-gray-600">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {milestones.map((milestone) => (
              <tr key={milestone.id} className="border-b">
                <td className="py-3">{milestone.description}</td>
                <td className="py-3 text-right tabular-nums">
                  {formatCents(milestone.amount_cents)}
                </td>
              </tr>
            ))}
            {remainder > 0 ? (
              <tr className="border-b">
                <td className="py-3">Additional services</td>
                <td className="py-3 text-right tabular-nums">{formatCents(remainder)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground print:text-gray-600">Subtotal</span>
          <span className="text-sm tabular-nums">{formatCents(contract.amount_cents)}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="font-bold">Total</span>
          <span className="text-lg font-bold tabular-nums">{formatCents(contract.amount_cents)}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-muted-foreground print:text-gray-500">
        <p>Processed through NoMarkup - Service Marketplace</p>
      </div>
    </div>
  );
}
