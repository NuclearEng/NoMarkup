'use client';

// WebVitalsReporter — mounts once under QueryProvider and streams Core Web
// Vitals to console (dev) or POST /api/v1/rum + Sentry (prod). No cookies/PII.

import { useEffect } from 'react';

import { reportWebVitals } from '@/lib/report-web-vitals';

export function WebVitalsReporter(): null {
  useEffect(() => {
    return reportWebVitals();
  }, []);

  return null;
}

export default WebVitalsReporter;
