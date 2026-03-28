import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable in production.
  enabled: process.env.NODE_ENV === 'production',

  // Performance monitoring — sample 10% of transactions.
  tracesSampleRate: 0.1,

  // Session replay for error reproduction.
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 0.1,

  // Filter out known non-issues.
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error promise rejection captured',
  ],

  beforeSend(event: Sentry.ErrorEvent) {
    if (process.env.NODE_ENV !== 'production') {
      return null;
    }
    return event;
  },
});
