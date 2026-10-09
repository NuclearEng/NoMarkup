import Link from 'next/link';

import { Header } from '@/components/layout/Header';
import { MobileTabBar } from '@/components/layout/MobileTabBar';

const FOOTER_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/community-guidelines', label: 'Community Guidelines' },
  { href: '/support', label: 'Support' },
] as const;

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col overflow-x-clip bg-background">
      <Header />
      <div className="min-w-0 flex-1">{children}</div>
      <footer
        className="relative bg-background px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-sm text-zinc-300 sm:px-6"
        aria-label="Site footer"
      >
        <div className="glass-divider absolute inset-x-0 top-0" aria-hidden="true" />
        <nav
          aria-label="Legal and support"
          className="mx-auto mb-4 flex max-w-2xl flex-wrap items-center justify-center gap-x-4 gap-y-2"
        >
          {FOOTER_LINKS.map((link, i) => (
            <span key={link.href} className="inline-flex items-center gap-x-4">
              {i > 0 ? (
                <span className="hidden text-zinc-600 sm:inline" aria-hidden="true">
                  ·
                </span>
              ) : null}
              <Link
                href={link.href}
                className="min-h-[44px] inline-flex items-center text-zinc-400 underline-offset-4 transition-colors hover:text-[var(--brand-gold)] hover:underline focus-visible:text-[var(--brand-gold)] focus-visible:outline-none"
              >
                {link.label}
              </Link>
            </span>
          ))}
        </nav>
        <p>&copy; {new Date().getFullYear()} NoMarkup. All rights reserved.</p>
      </footer>
      {/* Authenticated visitors get the same bottom nav on public pages as in the
          dashboard (one mobile nav everywhere). Renders nothing when logged out. */}
      <MobileTabBar />
    </div>
  );
}
