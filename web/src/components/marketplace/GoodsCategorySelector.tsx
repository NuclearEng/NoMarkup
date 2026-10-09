'use client';

import { ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGoodsCategoryTree } from '@/hooks/useCategories';
import { cn } from '@/lib/utils';
import type { ServiceCategory } from '@/types';

interface GoodsCategorySelectorProps {
  /** Selected goods category id (controlled). */
  value?: string | null;
  /** Fired when a category is chosen. */
  onChange: (id: string, category: ServiceCategory) => void;
  className?: string;
  /** Optional id for the first focusable control (label association). */
  id?: string;
}

interface FlatNode {
  cat: ServiceCategory;
  path: string[]; // ancestor names, top-down
}

function flatten(cats: ServiceCategory[], path: string[], out: FlatNode[]) {
  for (const cat of cats) {
    out.push({ cat, path });
    if (cat.children && cat.children.length > 0) {
      flatten(cat.children, [...path, cat.name], out);
    }
  }
}

/**
 * GoodsCategorySelector — single-select goods category picker backed by the DB
 * (useGoodsCategoryTree → /categories/tree). Replaces the old hardcoded
 * GOODS_CATEGORIES arrays that had drifted out of sync across two files.
 *
 * UX: search-first. Type "laptop" and pick it straight from the flattened tree
 * (shows its "Electronics › Computers" path); or browse by drilling down when
 * the search box is empty. Either way a single tap commits the selection. WCAG
 * 2.2 AA: 44px targets, search labelled, keyboard reachable.
 */
export function GoodsCategorySelector({
  value,
  onChange,
  className,
  id,
}: GoodsCategorySelectorProps) {
  const { data: tree, isLoading } = useGoodsCategoryTree();
  const [activePath, setActivePath] = useState<ServiceCategory[]>([]);
  const [search, setSearch] = useState('');

  const flat = useMemo(() => {
    const out: FlatNode[] = [];
    if (tree) flatten(tree, [], out);
    return out;
  }, [tree]);

  const selectedNode = useMemo(
    () => flat.find((n) => n.cat.id === value),
    [flat, value],
  );

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return flat.filter((n) => n.cat.name.toLowerCase().includes(q)).slice(0, 50);
  }, [flat, search]);

  const currentLevel = useMemo(() => {
    if (activePath.length === 0) return tree ?? [];
    return activePath[activePath.length - 1]?.children ?? [];
  }, [tree, activePath]);

  function pick(cat: ServiceCategory) {
    onChange(cat.id, cat);
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading categories…</p>;
  }
  if (!tree || tree.length === 0) {
    return <p className="text-sm text-muted-foreground">No categories available.</p>;
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Current selection */}
      {selectedNode ? (
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm">
            {selectedNode.path.length > 0 ? (
              <span className="text-muted-foreground">{selectedNode.path.join(' › ')} › </span>
            ) : null}
            <span className="font-medium">{selectedNode.cat.name}</span>
          </span>
        </div>
      ) : null}

      {/* Search */}
      <div className="flex items-center gap-2 rounded-md border px-3">
        <Search className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        <Input
          id={id}
          type="search"
          placeholder="Search categories…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
          className="h-11 border-0 px-0 shadow-none focus-visible:ring-0"
          aria-label="Search goods categories"
        />
      </div>

      {search.trim() ? (
        /* Flat search results with breadcrumb paths */
        <ul className="max-h-[300px] space-y-1 overflow-y-auto" aria-label="Search results">
          {searchResults.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
              No categories match “{search}”.
            </li>
          ) : (
            searchResults.map((n) => (
              <li key={n.cat.id}>
                <button
                  type="button"
                  onClick={() => { pick(n.cat); }}
                  aria-pressed={n.cat.id === value}
                  className={cn(
                    'flex min-h-[44px] w-full flex-col items-start justify-center rounded-md px-3 py-1.5 text-left hover:bg-muted',
                    n.cat.id === value && 'bg-accent text-accent-foreground',
                  )}
                >
                  <span className="text-sm">{n.cat.name}</span>
                  {n.path.length > 0 ? (
                    <span className="text-xs text-muted-foreground">{n.path.join(' › ')}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <>
          {/* Breadcrumb */}
          <nav aria-label="Category breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
            <button
              type="button"
              onClick={() => { setActivePath([]); }}
              className="min-h-[44px] px-1 text-muted-foreground hover:text-foreground"
            >
              All goods
            </button>
            {activePath.map((cat, idx) => (
              <span key={cat.id} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => { setActivePath(activePath.slice(0, idx + 1)); }}
                  className="min-h-[44px] px-1 text-muted-foreground hover:text-foreground"
                >
                  {cat.name}
                </button>
              </span>
            ))}
          </nav>

          {/* Drill-down list */}
          <ul className="max-h-[300px] space-y-1 overflow-y-auto" aria-label="Categories">
            {currentLevel.map((cat) => {
              const hasChildren = !!cat.children && cat.children.length > 0;
              const isSelected = cat.id === value;
              return (
                <li key={cat.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { pick(cat); }}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex min-h-[44px] flex-1 items-center rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
                      isSelected && 'bg-accent text-accent-foreground',
                    )}
                  >
                    {cat.name}
                  </button>
                  {hasChildren ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      onClick={() => { setActivePath([...activePath, cat]); }}
                      aria-label={`Browse ${cat.name} subcategories`}
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
