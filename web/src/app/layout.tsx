import type { Metadata } from 'next';
import '@/styles/globals.css';

import { QueryProvider } from '@/components/providers/QueryProvider';

export const metadata: Metadata = {
  title: { default: 'NoMarkup', template: '%s | NoMarkup' },
  description: 'Reverse-auction marketplace for home services. Fair prices, verified providers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-md focus:bg-primary focus:p-4 focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <QueryProvider>
          <div id="main-content">{children}</div>
        </QueryProvider>
      </body>
    </html>
  );
}
