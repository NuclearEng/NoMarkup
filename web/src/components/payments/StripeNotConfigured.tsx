import { AlertTriangle } from 'lucide-react';

interface StripeNotConfiguredProps {
  /** Intuitive, context-specific explanation of what the user needs to do. */
  message?: string;
  className?: string;
}

/**
 * Intuitive notice shown wherever a Stripe Elements surface would render but
 * Stripe has no valid publishable key configured. Replaces the silent broken
 * form (and the "IntegrationError: empty string" console crash) with a clear,
 * actionable message instead of a dead payment widget.
 */
export function StripeNotConfigured({ message, className }: StripeNotConfiguredProps) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-foreground ${className ?? ''}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">Payments aren&apos;t set up yet</p>
        <p className="text-muted-foreground">
          {message ??
            'A Stripe account must be connected before payments can be processed. Connect a Stripe account to continue.'}
        </p>
      </div>
    </div>
  );
}
