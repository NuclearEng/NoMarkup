import { Header } from '@/components/layout/Header';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <footer className="relative px-6 py-6 text-center text-sm text-muted-foreground">
        <div className="glass-divider absolute inset-x-0 top-0" aria-hidden="true" />
        &copy; {new Date().getFullYear()} NoMarkup. All rights reserved.
      </footer>
    </div>
  );
}
