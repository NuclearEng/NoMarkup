'use client';

import dynamic from 'next/dynamic';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Code-split entry to the auction terminal grid, for pages that only show the
 * grid after a client-side request has answered (spectate / replay).
 *
 * PERF-08: react-grid-layout (+ react-draggable / react-resizable) and the
 * twelve terminal widgets are ~33 kB gzip. On those pages the first thing
 * rendered is always a loading state, so that code does not need to be in the
 * JavaScript the route must run before it can hydrate. The page calls
 * `preloadTerminalGrid()` from a mount effect, so the chunk is requested in
 * parallel with the page's own data and is normally ready before there is
 * anything to show.
 *
 * Do NOT use this on a page that renders the terminal during server rendering
 * (/demo/auction, the live job detail page): `TerminalGrid` server-renders a
 * full grid, and `ssr: false` here would replace that HTML with the
 * placeholder. Import `TerminalGrid` from `./terminal-grid` there.
 */
const loadTerminalGrid = () =>
  import('@/components/terminal/terminal-grid').then((mod) => mod.TerminalGrid);

/** Holds roughly the first screen of the terminal while the grid chunk arrives. */
function TerminalGridLoading() {
  return (
    <div role="status" aria-label="Loading auction terminal" className="min-h-[60vh] space-y-3">
      <span className="sr-only">Loading auction terminal…</span>
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}

/**
 * Start fetching the grid chunk. Call from a mount effect on a page that will
 * show `LazyTerminalGrid` once its data arrives. Safe to call repeatedly; a
 * failed request is retried when the grid actually renders.
 */
export function preloadTerminalGrid(): void {
  void loadTerminalGrid().catch(() => undefined);
}

export const LazyTerminalGrid = dynamic(loadTerminalGrid, {
  ssr: false,
  loading: TerminalGridLoading,
});
