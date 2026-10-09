import type { Metadata } from 'next';
import { Suspense } from 'react';

import { UnsubscribeClient } from './unsubscribe-client';

export const metadata: Metadata = {
  title: 'Unsubscribe | NoMarkup',
  description: 'Turn off marketing email from NoMarkup.',
  robots: { index: false, follow: false },
};

export default function UnsubscribePage() {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-12">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <UnsubscribeClient />
      </Suspense>
    </main>
  );
}
