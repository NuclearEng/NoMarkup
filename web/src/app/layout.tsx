import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
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
import { BUYER_PAYS_AGREED_PRICE } from '@/lib/constants';
import { Toaster } from 'sonner';

// Showcase type stack — docs/brand/showcase-ssot.md (qa/showcase/index.html)
//
// Self-hosted (next/font/local) so neither `next dev` nor `next build` talks
// to fonts.googleapis.com — a slow or unreachable Google Fonts used to fail
// both. The files in src/fonts/ are the exact latin-subset woff2 files Google
// Fonts served for these families (byte-identical, so rendering is unchanged);
// all four families are SIL OFL 1.1 — licence texts sit next to the files.
// Only the latin subset goes through next/font (and is preloaded). The other
// subsets Google declared (latin-ext, greek, cyrillic, vietnamese — user-entered
// names and addresses need them) are the "<Family> Subsets" faces in
// globals.css, fetched on demand.
//
// `unicode-range` mirrors Google's latin subset (repeated in each call:
// next/font only accepts literal values). The metric-adjusted
// "<Family> Fallback" faces that prevent layout shift while the web font
// loads are declared in src/styles/globals.css with the values
// next/font/google generated, which is why adjustFontFallback is off here.
const instrument = localFont({
  src: [
    { path: '../fonts/instrument-serif-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/instrument-serif-latin-400-italic.woff2', weight: '400', style: 'italic' },
  ],
  variable: '--font-instrument',
  display: 'swap',
  fallback: ['Instrument Serif Subsets', 'Instrument Serif Fallback'],
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const syne = localFont({
  src: '../fonts/syne-latin-wght-normal.woff2',
  weight: '500 800',
  style: 'normal',
  variable: '--font-syne',
  display: 'swap',
  fallback: ['Syne Subsets', 'Syne Fallback'],
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const outfit = localFont({
  src: '../fonts/outfit-latin-wght-normal.woff2',
  weight: '300 700',
  style: 'normal',
  variable: '--font-outfit',
  display: 'swap',
  fallback: ['Outfit Subsets', 'Outfit Fallback'],
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const jetbrains = localFont({
  src: '../fonts/jetbrains-mono-latin-wght-normal.woff2',
  weight: '400 600',
  style: 'normal',
  variable: '--font-jetbrains',
  display: 'swap',
  fallback: ['JetBrains Mono Subsets', 'JetBrains Mono Fallback'],
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
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
    `Reverse-auction service marketplace. Customers post jobs, providers compete on price. Fair market rates — not the markup. ${BUYER_PAYS_AGREED_PRICE} Plus local goods with escrow.`,
  applicationName: 'NoMarkup',
  manifest: '/manifest.json',
  keywords: [
    'home services',
    'reverse auction',
    'local contractors',
    'fair price',
    'local marketplace',
    'local providers',
  ],
  alternates: { canonical: '/' },
  // Favicon + apple-touch-icon come from App Router file conventions:
  // web/src/app/icon.png + apple-icon.png (iOS AppIcon-1024 champagne M↓ tile).
  openGraph: {
    type: 'website',
    siteName: 'NoMarkup',
    title: 'NoMarkup — The Market Sets The Price. Not The Markup.',
    description:
      `Customers post home-service jobs. Qualified providers compete in real-time reverse auctions. Prices drop to fair market rates. ${BUYER_PAYS_AGREED_PRICE}`,
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
      `Reverse auctions for home services. Fair market rates. ${BUYER_PAYS_AGREED_PRICE}`,
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
