import { Suspense } from 'react';
import type { Metadata } from 'next';

import { VerifyEmailContent } from '@/components/forms/VerifyEmailContent';

export const metadata: Metadata = {
  title: 'Verify Email',
};

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <p className="text-center text-sm text-muted-foreground">
          Verifying your email...
        </p>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
