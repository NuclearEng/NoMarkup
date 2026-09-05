import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RegisterForm } from '@/components/forms/RegisterForm';

export const metadata: Metadata = {
  title: 'Create Account',
};

export default function RegisterPage() {
  // RegisterForm reads ?error= / ?ref= via useSearchParams.
  return (
    <Suspense fallback={<div className="text-center text-sm text-white/60">Loading…</div>}>
      <RegisterForm />
    </Suspense>
  );
}
