import { Header } from '@/components/layout/Header';
import { MobileTabBar } from '@/components/layout/MobileTabBar';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#070b14]">
      <Header />
      <div className="flex-1">{children}</div>
      <footer className="relative bg-[#070b14] px-6 py-8 text-center text-sm text-zinc-300" aria-label="Site footer">
        <div className="glass-divider absolute inset-x-0 top-0" aria-hidden="true" />
        <p>&copy; {new Date().getFullYear()} NoMarkup. All rights reserved.</p>
      </footer>
      {/* Authenticated visitors get the same bottom nav on public pages as in the
          dashboard (one mobile nav everywhere). Renders nothing when logged out. */}
      <MobileTabBar />
    </div>
  );
}
