import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoginForm } from '@/components/forms/LoginForm';

export const metadata: Metadata = {
  title: 'Sign In',
};

export default function LoginPage() {
  // LoginForm reads ?error= via useSearchParams (OAuth init/callback redirects).
  return (
    <Suspense fallback={<div className="text-center text-sm text-white/60">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
