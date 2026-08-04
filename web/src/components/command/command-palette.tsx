'use client';

import {
  Briefcase,
  CreditCard,
  FileText,
  Gavel,
  Home,
  LayoutDashboard,
  MessageSquare,
  Package,
  PlusCircle,
  Search,
  Settings,
  Tag,
  User,
} from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE } from '@/types';

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  href: Route;
  icon: typeof Home;
  /** Keywords that also match the filter (beyond label). */
  keywords?: readonly string[];
  /** When true, only show if authenticated. */
  auth?: boolean;
  /** When true, only show for providers. */
  provider?: boolean;
}

const COMMANDS: readonly CommandItem[] = [
  {
    id: 'post-job',
    label: 'Post a job',
    hint: 'Start a reverse auction',
    href: '/jobs/new' as Route,
    icon: PlusCircle,
    keywords: ['create', 'auction', 'service'],
    auth: true,
  },
  {
    id: 'browse-jobs',
    label: 'Browse jobs',
    hint: 'Find work to bid',
    href: '/jobs' as Route,
    icon: Search,
    keywords: ['search', 'market'],
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    hint: 'Local goods auctions',
    href: '/marketplace' as Route,
    icon: Gavel,
    keywords: ['goods', 'listings', 'buy'],
  },
  {
    id: 'sell',
    label: 'Sell an item',
    hint: 'List for local pickup',
    href: '/sell/new' as Route,
    icon: Tag,
    keywords: ['list', 'goods'],
    auth: true,
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/dashboard' as Route,
    icon: Home,
    auth: true,
  },
  {
    id: 'positions',
    label: 'Active positions',
    hint: 'My bids + watchlist',
    href: '/me/positions' as Route,
    icon: Gavel,
    keywords: ['blotter', 'watch', 'active', 'desk'],
    auth: true,
  },
  {
    id: 'my-jobs',
    label: 'My jobs',
    href: '/jobs/mine' as Route,
    icon: Briefcase,
    auth: true,
  },
  {
    id: 'contracts',
    label: 'Contracts',
    href: '/contracts' as Route,
    icon: FileText,
    auth: true,
  },
  {
    id: 'messages',
    label: 'Messages',
    href: '/messages' as Route,
    icon: MessageSquare,
    auth: true,
  },
  {
    id: 'orders',
    label: 'Orders',
    href: '/orders' as Route,
    icon: Package,
    auth: true,
  },
  {
    id: 'payments',
    label: 'Payments',
    href: '/payments' as Route,
    icon: CreditCard,
    auth: true,
  },
  {
    id: 'provider',
    label: 'Provider workspace',
    href: '/provider' as Route,
    icon: LayoutDashboard,
    auth: true,
    provider: true,
  },
  {
    id: 'profile',
    label: 'Profile',
    href: '/profile' as Route,
    icon: User,
    auth: true,
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '/settings/security' as Route,
    icon: Settings,
    auth: true,
  },
  {
    id: 'login',
    label: 'Sign in',
    href: '/login' as Route,
    icon: User,
    keywords: ['login', 'auth'],
  },
];

function matchesQuery(item: CommandItem, q: string): boolean {
  if (!q) return true;
  const hay = [item.label, item.hint ?? '', ...(item.keywords ?? [])]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Bloomberg/Linear-style global jump palette.
 *
 * Bound to ⌘K / Ctrl+K app-wide. Static routes + UUID jump + live job/listing
 * search (debounced public catalog). Offline-safe when API is down (static only).
 */
export function CommandPalette() {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { isAuthenticated, user } = useAuthStore();
  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) === true;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [liveHits, setLiveHits] = useState<CommandItem[]>([]);

  const staticItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMMANDS.filter((item) => {
      if (item.auth && !isAuthenticated) return false;
      if (item.provider && !isProvider) return false;
      // Hide Sign in when already authed.
      if (item.id === 'login' && isAuthenticated) return false;
      return matchesQuery(item, q);
    });
  }, [query, isAuthenticated, isProvider]);

  // Debounced market search + UUID deep-links.
  useEffect(() => {
    if (!open) {
      setLiveHits([]);
      return;
    }
    const raw = query.trim();
    if (raw.length < 2) {
      setLiveHits([]);
      return;
    }
    if (UUID_RE.test(raw)) {
      setLiveHits([
        {
          id: `uuid-job-${raw}`,
          label: `Open job ${raw.slice(0, 8)}…`,
          hint: 'UUID → /jobs/{id}',
          href: `/jobs/${raw}` as Route,
          icon: Briefcase,
          keywords: ['uuid', 'job'],
        },
        {
          id: `uuid-listing-${raw}`,
          label: `Open listing ${raw.slice(0, 8)}…`,
          hint: 'UUID → /marketplace/{id}',
          href: `/marketplace/${raw}` as Route,
          icon: Gavel,
          keywords: ['uuid', 'listing'],
        },
      ]);
      return;
    }

    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const { api } = await import('@/lib/api');
          const qEnc = encodeURIComponent(raw);
          const [jobsRes, listingsRes] = await Promise.all([
            api
              .getPublic<{ jobs?: Array<{ id: string; title: string }> }>(
                `/api/v1/jobs?q=${qEnc}&page_size=5`,
              )
              .catch(() => ({ jobs: [] as Array<{ id: string; title: string }> })),
            api
              .getPublic<{ listings?: Array<{ id: string; title: string }> }>(
                `/api/v1/listings?q=${qEnc}&page_size=5`,
              )
              .catch(() => ({ listings: [] as Array<{ id: string; title: string }> })),
          ]);
          if (cancelled) return;
          const hits: CommandItem[] = [];
          for (const j of jobsRes.jobs ?? []) {
            hits.push({
              id: `job-${j.id}`,
              label: j.title || 'Job',
              hint: 'Job auction',
              href: `/jobs/${j.id}` as Route,
              icon: Briefcase,
            });
          }
          for (const l of listingsRes.listings ?? []) {
            hits.push({
              id: `listing-${l.id}`,
              label: l.title || 'Listing',
              hint: 'Goods auction',
              href: `/marketplace/${l.id}` as Route,
              icon: Gavel,
            });
          }
          setLiveHits(hits);
        } catch {
          if (!cancelled) setLiveHits([]);
        }
      })();
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, open]);

  const items = useMemo(
    () => [...liveHits, ...staticItems],
    [liveHits, staticItems],
  );

  // Reset selection when the filtered list changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isModK =
        (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey);
      if (!isModK) return;
      // meta/ctrl+k is the intentional global chord (Linear / Bloomberg jump).
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    function onOpenRequest() {
      setOpen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('nomarkup:open-command-palette', onOpenRequest);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('nomarkup:open-command-palette', onOpenRequest);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    // Focus after open animation so the input is reachable.
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
    return () => {
      window.clearTimeout(t);
    };
  }, [open]);

  const runItem = useCallback(
    (item: CommandItem) => {
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) =>
        items.length === 0 ? 0 : (i - 1 + items.length) % items.length,
      );
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) runItem(item);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden border-white/10 bg-[#0e1017] p-0 shadow-2xl sm:rounded-xl"
        // cmd-style: no default close X crowding the search field — Esc works.
        // Keep the built-in close for a11y (Dialog already provides it).
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>
            Jump to a page. Use arrow keys and Enter to select.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3">
          <Search
            className="h-4 w-4 shrink-0 text-zinc-500"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Jump to…"
            className="h-12 w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            aria-controls={listId}
            aria-activedescendant={
              items[activeIndex] ? `${listId}-${items[activeIndex].id}` : undefined
            }
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <kbd className="hidden shrink-0 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">
            esc
          </kbd>
        </div>

        <ul
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="max-h-[min(60vh,22rem)] overflow-y-auto p-1.5"
        >
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-zinc-500">
              No matches
            </li>
          ) : (
            items.map((item, index) => {
              const Icon = item.icon;
              const active = index === activeIndex;
              return (
                <li key={item.id} role="option" aria-selected={active} id={`${listId}-${item.id}`}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                      active
                        ? 'bg-brand-gold/15 text-zinc-50'
                        : 'text-zinc-300 hover:bg-white/[0.04]',
                    )}
                    onMouseEnter={() => {
                      setActiveIndex(index);
                    }}
                    onClick={() => {
                      runItem(item);
                    }}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        active ? 'text-brand-gold' : 'text-zinc-500',
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{item.label}</span>
                      {item.hint ? (
                        <span className="block truncate text-xs text-zinc-500">
                          {item.hint}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2 text-[10px] text-zinc-600">
          <span className="font-mono tracking-wide uppercase">NoMarkup · Jump</span>
          <span>
            <kbd className="rounded border border-white/10 px-1 font-mono">↑↓</kbd>
            {' '}navigate{' · '}
            <kbd className="rounded border border-white/10 px-1 font-mono">↵</kbd>
            {' '}open
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Compact header control that opens the same palette via a synthetic ⌘K. */
export function CommandPaletteTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={cn(
        'hidden min-h-[36px] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-xs text-zinc-400 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-200 md:inline-flex',
        className,
      )}
      onClick={() => {
        window.dispatchEvent(new Event('nomarkup:open-command-palette'));
      }}
      aria-label="Open command palette"
    >
      <Search className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Jump</span>
      <kbd className="rounded border border-white/10 bg-black/30 px-1 font-mono text-[10px] text-zinc-500">
        ⌘K
      </kbd>
    </button>
  );
}
