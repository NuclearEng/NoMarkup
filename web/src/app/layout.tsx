import type { Metadata, Viewport } from 'next';
import { Instrument_Serif, JetBrains_Mono, Outfit, Syne } from 'next/font/google';
import { headers } from 'next/headers';
import { preconnect } from 'react-dom';
import '@/styles/globals.css';

import { CommandPalette } from '@/components/command/command-palette';
import { AgeGate } from '@/components/compliance/AgeGate';
import { CookieConsent } from '@/components/compliance/CookieConsent';
import { ToSReaccept } from '@/components/compliance/ToSReaccept';
import { ActionCapture } from '@/components/providers/ActionCapture';
import { AuthRestorer } from '@/components/providers/AuthRestorer';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { WebVitalsReporter } from '@/components/providers/WebVitalsReporter';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { Toaster } from 'sonner';

// Showcase type stack — docs/brand/showcase-ssot.md (qa/showcase/index.html)
const instrument = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
});

const syne = Syne({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-syne',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains',
  display: 'swap',
});

// Public site origin — drives canonical URLs and absolute OG/Twitter image URLs.
// no-markup.com is the owned, hyphenated production zone (CLAUDE.md §2).
const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://no-markup.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'NoMarkup — The Market Sets The Price',
    template: '%s | NoMarkup',
  },
  description:
    'Reverse-auction service marketplace. Customers post jobs, providers compete on price. Fair market rates — not the markup. Plus local goods with escrow.',
  applicationName: 'NoMarkup',
  manifest: '/manifest.json',
  keywords: [
    'home services',
    'reverse auction',
    'local contractors',
    'fair price',
    'local marketplace',
    'verified providers',
    'no markup',
  ],
  alternates: { canonical: '/' },
  // Favicon + apple-touch-icon come from App Router file conventions:
  // web/src/app/icon.png + apple-icon.png (iOS AppIcon-1024 champagne M↓ tile).
  openGraph: {
    type: 'website',
    siteName: 'NoMarkup',
    title: 'NoMarkup — The Market Sets The Price. Not The Markup.',
    description:
      'Customers post home-service jobs. Qualified providers compete in real-time reverse auctions. Prices drop to fair market rates.',
    url: SITE_URL,
    images: [
      {
        url: '/app-icon-1024.png',
        width: 1024,
        height: 1024,
        alt: 'NoMarkup — champagne metal M↓ app icon',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'NoMarkup — The Market Sets The Price',
    description:
      'Reverse auctions for home services. Fair market rates — everyone wins except the middleman.',
    images: ['/app-icon-1024.png'],
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
  // Allow pinch-zoom (a11y). Cover + safe-area for notched iPhones.
  viewportFit: 'cover',
  themeColor: '#07080b',
  // Keep form fields visible when the iOS keyboard opens.
  interactiveWidget: 'resizes-content',
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
    <html
      lang="en"
      className={`dark ${instrument.variable} ${syne.variable} ${outfit.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-background min-h-screen font-sans antialiased">
        <a
          href="#main-content"
          className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-md focus:p-4"
        >
          Skip to main content
        </a>
        <QueryProvider>
          <ActionCapture />
          <AuthRestorer />
          <WebVitalsReporter />
          <main id="main-content">{children}</main>
          <Toaster position="bottom-right" richColors closeButton />
          {/* Global ⌘K / Ctrl+K jump palette — Bloomberg × Linear navigation. */}
          <CommandPalette />
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
