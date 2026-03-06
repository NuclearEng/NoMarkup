import { Suspense } from 'react';
import type { Metadata } from 'next';

import { ResetPasswordContent } from '@/components/forms/ResetPasswordContent';

export const metadata: Metadata = {
  title: 'Reset Password',
};

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <p className="text-center text-sm text-muted-foreground">
          Loading...
        </p>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
