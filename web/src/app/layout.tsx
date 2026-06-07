import type { Metadata, Viewport } from 'next';
import { Syne } from 'next/font/google';
import { headers } from 'next/headers';
import '@/styles/globals.css';

import { AgeGate } from '@/components/compliance/AgeGate';
import { CookieConsent } from '@/components/compliance/CookieConsent';
import { ToSReaccept } from '@/components/compliance/ToSReaccept';
import { AuthRestorer } from '@/components/providers/AuthRestorer';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { Toaster } from 'sonner';

const syne = Syne({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-brand',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'NoMarkup', template: '%s | NoMarkup' },
  description: 'Reverse-auction marketplace for home services. Fair prices, verified providers.',
  manifest: '/manifest.json',
  applicationName: 'NoMarkup',
  appleWebApp: {
    capable: true,
    title: 'NoMarkup',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#070b14',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Per-request CSP nonce minted in middleware (web/src/middleware.ts).
  // Reading any header forces this layout into dynamic rendering, which is
  // required — a static-rendered page would freeze a single nonce across
  // every request, defeating the point of the per-request nonce.
  //
  // Next.js 15 RSC reads `x-nonce` directly from request headers and applies
  // it to its own bootstrap inline scripts (the __next_f.push() chunks).
  // We don't need to thread it into any explicit <Script> tags — there
  // currently are none in this app — but reading it here pins the layout to
  // dynamic rendering so the framework's automatic nonce wiring activates.
  const headerStore = await headers();
  // Reference the value so that bundlers/eslint don't elide the read.
  void headerStore.get('x-nonce');

  return (
    <html lang="en" className={`dark ${syne.variable}`} suppressHydrationWarning>
      <body className="bg-background min-h-screen font-sans antialiased">
        <a
          href="#main-content"
          className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-md focus:p-4"
        >
          Skip to main content
        </a>
        <QueryProvider>
          <AuthRestorer />
          <main id="main-content">{children}</main>
          <Toaster position="bottom-right" richColors closeButton />
          <ServiceWorkerRegistrar />
          <InstallPrompt />
          <CookieConsent />
          <ToSReaccept />
          <AgeGate />
        </QueryProvider>
      </body>
    </html>
  );
}
