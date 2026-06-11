import type { Metadata, Viewport } from 'next';
import { Syne } from 'next/font/google';
import { headers } from 'next/headers';
import { preconnect } from 'react-dom';
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

// Public site origin — drives canonical URLs and absolute OG/Twitter image URLs.
// no-markup.com is the owned, hyphenated production zone (CLAUDE.md §2).
const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://no-markup.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'NoMarkup', template: '%s | NoMarkup' },
  description:
    'Reverse-auction marketplace for home services. Providers compete on price — no lead-gen markup. Plus a local goods marketplace with escrow and verified sellers.',
  applicationName: 'NoMarkup',
  manifest: '/manifest.json',
  keywords: [
    'home services',
    'reverse auction',
    'local contractors',
    'fair price',
    'local marketplace',
    'verified providers',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'NoMarkup',
    title: 'NoMarkup — fair prices, no lead-gen markup',
    description:
      'Post a job and let verified providers compete on price. Plus a local goods marketplace with escrow.',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NoMarkup — fair prices, no lead-gen markup',
    description: 'Verified providers compete on price. A local marketplace with escrow + trust.',
  },
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

  // Preconnect to the listing-photo origin the BROWSER actually fetches from.
  // Photos on hosts in next.config's remotePatterns (dev MinIO localhost:9000)
  // are proxied through same-origin /_next/image, so no preconnect is needed
  // for them; unsplash-hosted photos (the seed-data host) render via
  // ProgressiveImage's `unoptimized` fallback and are fetched directly, so
  // warming DNS+TCP+TLS here shaves the LCP image's connection setup
  // (lab LCP 2.86–3.16s vs <2.5s budget, image load delay — CLAUDE.md §8/§14).
  // No crossOrigin: <img> fetches are no-cors, and a crossorigin preconnect
  // would open a second, unused connection.
  preconnect('https://images.unsplash.com');

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
