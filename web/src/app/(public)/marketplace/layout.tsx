import { SidebarNav } from '@/components/layout/SidebarNav';

/**
 * Marketplace layout — nested inside the (public) route group.
 *
 * The marketplace is a PUBLIC surface (logged-out visitors must be able to
 * browse), so it stays in the (public) group and keeps the shared public
 * Header + footer from `(public)/layout.tsx`. We do NOT wrap it in the
 * dashboard's AuthGuard — that would redirect logged-out users to /login.
 *
 * For AUTHENTICATED visitors we render the same desktop nav sidebar the
 * dashboard uses, so it's present and persistent across every marketplace page
 * (list, detail, map, spectate, replay) without duplicating the Header.
 * `SidebarNav` self-gates on auth: it returns null for logged-out visitors and
 * during the auth-restore hydrate window, so the public/logged-out marketplace
 * is visually unchanged (just the public Header, full-width content).
 *
 * RSC impact: none. `SidebarNav` is a leaf `'use client'` island; this layout
 * stays a Server Component and adds no per-request data, so the marketplace
 * pages keep their existing static/edge-cacheable RSC behavior (CLAUDE.md §14).
 */
export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1">
      <SidebarNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
