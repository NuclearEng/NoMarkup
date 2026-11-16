'use client';

/**
 * SearchBar — autocomplete-enabled search input for the marketplace.
 *
 * UX contract:
 *  - Controlled input with a 200ms debounce on the prefix used to query
 *    the public /listings/autocomplete endpoint.
 *  - Dropdown renders ARIA-compliant combobox semantics (role=combobox
 *    with aria-controls, aria-expanded, aria-activedescendant).
 *  - Up/Down navigates suggestions, Enter selects the active one or
 *    submits the raw query, Esc collapses the dropdown.
 *  - On submit (Enter without an active suggestion), navigates to
 *    /marketplace?q=<typed> so the existing browse pipeline filters
 *    by text. Selecting a category navigates with category_slug=...
 *    Selecting a listing routes to /marketplace/{id}.
 *
 * Accessibility:
 *  - role=combobox + aria-autocomplete="list" on the input.
 *  - role=listbox on the dropdown, role=option per suggestion with
 *    a stable id so aria-activedescendant works.
 *  - Visible focus ring; keyboard-only flow fully covered.
 */

import { Search, X } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Input } from '@/components/ui/input';
import { useListingsAutocomplete } from '@/hooks/useListings';
import { formatCents } from '@/lib/utils';
import type { AutocompleteSuggestion } from '@/types';

const DEBOUNCE_MS = 200;

interface SearchBarProps {
  /** Initial value, e.g. when the URL already has ?q=foo */
  defaultValue?: string;
  /** Optional callback fired whenever the user submits (Enter on raw text). */
  onSubmitQuery?: (query: string) => void;
  /** Optional callback fired when a suggestion is selected. */
  onSelectSuggestion?: (suggestion: AutocompleteSuggestion) => void;
  /** Visible placeholder. */
  placeholder?: string;
  className?: string;
}

export function SearchBar({
  defaultValue = '',
  onSubmitQuery,
  onSelectSuggestion,
  placeholder = 'Search the marketplace...',
  className,
}: SearchBarProps) {
  const router = useRouter();
  const reactId = useId();
  const listboxId = `${reactId}-listbox`;

  const [value, setValue] = useState(defaultValue);
  const [debounced, setDebounced] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce the value -> debounced reflection. The hook only fires when
  // debounced.length >= 2, so this also gates network traffic on length.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(value);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [value]);

  const { data, isLoading } = useListingsAutocomplete(debounced);
  const suggestions = useMemo<AutocompleteSuggestion[]>(
    () => data?.suggestions ?? [],
    [data],
  );

  // Reset active highlight when suggestions change.
  useEffect(() => {
    setActiveIndex(-1);
  }, [suggestions]);

  // Close dropdown when clicking outside.
  useEffect(() => {
    if (!open) return;
    function handleDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleDocClick);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
    };
  }, [open]);

  const submitRaw = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      setOpen(false);
      if (onSubmitQuery) {
        onSubmitQuery(trimmed);
        return;
      }
      if (trimmed.length === 0) {
        router.push('/marketplace' as Route);
      } else {
        router.push(
          (`/marketplace?q=${encodeURIComponent(trimmed)}`) as Route,
        );
      }
    },
    [onSubmitQuery, router],
  );

  const selectSuggestion = useCallback(
    (s: AutocompleteSuggestion) => {
      setOpen(false);
      if (onSelectSuggestion) {
        onSelectSuggestion(s);
        return;
      }
      if (s.type === 'listing' && s.id) {
        router.push((`/marketplace/${s.id}`) as Route);
        return;
      }
      if (s.type === 'category' && s.category_slug) {
        router.push(
          (`/marketplace?category_slug=${encodeURIComponent(s.category_slug)}`) as Route,
        );
      }
    },
    [onSelectSuggestion, router],
  );

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    if (!open) setOpen(true);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setActiveIndex((idx) => (idx + 1) % suggestions.length);
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setActiveIndex((idx) =>
        idx <= 0 ? suggestions.length - 1 : idx - 1,
      );
      setOpen(true);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        selectSuggestion(suggestions[activeIndex]);
        return;
      }
      submitRaw(value);
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
  };

  const handleClear = () => {
    setValue('');
    setDebounced('');
    setActiveIndex(-1);
    setOpen(false);
    inputRef.current?.focus();
  };

  const showDropdown = open && debounced.trim().length >= 2;
  const activeId = activeIndex >= 0 ? `${listboxId}-opt-${String(activeIndex)}` : undefined;

  return (
    <div ref={containerRef} className={`relative w-full ${className ?? ''}`}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500"
          aria-hidden="true"
        />
        <Input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label="Search marketplace listings"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onFocus={() => {
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="min-h-[44px] pl-9 pr-9"
        />
        {value.length > 0 ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={handleClear}
            className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {showDropdown ? (
        <ul
          id={listboxId}
          role="listbox"
          className="glass absolute top-[calc(100%+4px)] left-0 z-50 max-h-[420px] w-full overflow-y-auto rounded-lg border border-[var(--brand-gold)]/15 bg-zinc-950/95 p-1 shadow-2xl backdrop-blur"
        >
          {isLoading && suggestions.length === 0 ? (
            <li
              className="px-3 py-2 text-sm text-zinc-500"
              aria-live="polite"
            >
              Searching…
            </li>
          ) : suggestions.length === 0 ? (
            <li
              className="px-3 py-2 text-sm text-zinc-500"
              aria-live="polite"
            >
              No matches for &ldquo;{debounced}&rdquo;
            </li>
          ) : (
            suggestions.map((s, i) => {
              const isActive = i === activeIndex;
              const optId = `${listboxId}-opt-${String(i)}`;
              return (
                <li
                  key={`${s.type}-${s.id ?? s.category_slug ?? String(i)}`}
                  id={optId}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => {
                    setActiveIndex(i);
                  }}
                  onMouseDown={(e) => {
                    // mousedown so we beat the input's blur and don't lose focus
                    e.preventDefault();
                    selectSuggestion(s);
                  }}
                  className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm ${
                    isActive
                      ? 'bg-[var(--brand-gold)]/15 text-zinc-100'
                      : 'text-zinc-300 hover:bg-white/5'
                  }`}
                >
                  {s.type === 'category' ? (
                    <>
                      <span className="rounded-full border border-[var(--brand-gold)]/30 bg-[var(--brand-gold)]/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--brand-gold)] uppercase">
                        Category
                      </span>
                      <span className="truncate font-medium">{s.label}</span>
                    </>
                  ) : (
                    <>
                      <span className="truncate flex-1">{s.title}</span>
                      {typeof s.starting_price_cents === 'number' ? (
                        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                          {formatCents(s.starting_price_cents)}
                        </span>
                      ) : null}
                    </>
                  )}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
