import type { Metadata } from 'next';
import { Syne } from 'next/font/google';
import '@/styles/globals.css';

import { AuthRestorer } from '@/components/providers/AuthRestorer';
import { QueryProvider } from '@/components/providers/QueryProvider';
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={syne.variable} suppressHydrationWarning>
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
        </QueryProvider>
      </body>
    </html>
  );
}
