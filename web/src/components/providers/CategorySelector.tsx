'use client';

import { ChevronRight, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useCategoryTree } from '@/hooks/useCategories';
import type { ServiceCategory } from '@/types';

const MAX_SELECTIONS = 10;

interface CategorySelectorProps {
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function CategorySelector({ selected, onChange }: CategorySelectorProps) {
  const { data: tree, isLoading } = useCategoryTree();
  const [activePath, setActivePath] = useState<ServiceCategory[]>([]);
  const [search, setSearch] = useState('');

  const currentLevel = activePath.length;
  const parentCategory = activePath[activePath.length - 1];

  const currentCategories = useMemo(() => {
    if (!tree) return [];
    if (currentLevel === 0) return tree;
    return parentCategory?.children ?? [];
  }, [tree, currentLevel, parentCategory]);

  const filtered = useMemo(() => {
    if (!search) return currentCategories;
    const lower = search.toLowerCase();
    return currentCategories.filter((c) => c.name.toLowerCase().includes(lower));
  }, [currentCategories, search]);

  // Build a flat lookup from the tree for getting names of selected categories
  const flatLookup = useMemo(() => {
    const map = new Map<string, ServiceCategory>();
    function walk(cats: ServiceCategory[]) {
      for (const cat of cats) {
        map.set(cat.id, cat);
        if (cat.children) walk(cat.children);
      }
    }
    if (tree) walk(tree);
    return map;
  }, [tree]);

  function toggleCategory(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else if (selected.length < MAX_SELECTIONS) {
      onChange([...selected, id]);
    }
  }

  function removeCategory(id: string) {
    onChange(selected.filter((s) => s !== id));
  }

  function drillDown(category: ServiceCategory) {
    if (category.children && category.children.length > 0) {
      setActivePath([...activePath, category]);
      setSearch('');
    }
  }

  function goBack(toIndex: number) {
    setActivePath(activePath.slice(0, toIndex));
    setSearch('');
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading categories...</p>;
  }

  if (!tree || tree.length === 0) {
    return <p className="text-sm text-muted-foreground">No categories available.</p>;
  }

  const isLeafLevel = currentLevel >= 2 || (filtered.length > 0 && !filtered[0]?.children?.length);

  return (
    <div className="space-y-4">
      {/* Selected badges */}
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label="Selected categories">
          {selected.map((id) => {
            const cat = flatLookup.get(id);
            return (
              <Badge key={id} variant="secondary" className="gap-1 pr-1">
                {cat?.name ?? id}
                <button
                  type="button"
                  onClick={() => { removeCategory(id); }}
                  className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted"
                  aria-label={`Remove ${cat?.name ?? id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
          <span className="self-center text-xs text-muted-foreground">
            {String(selected.length)}/{String(MAX_SELECTIONS)}
          </span>
        </div>
      ) : null}

      {/* Breadcrumb navigation */}
      <nav aria-label="Category breadcrumb" className="flex items-center gap-1 text-sm">
        <button
          type="button"
          onClick={() => { goBack(0); }}
          className="min-h-[44px] px-1 text-muted-foreground hover:text-foreground"
        >
          All
        </button>
        {activePath.map((cat, idx) => (
          <span key={cat.id} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            <button
              type="button"
              onClick={() => { goBack(idx + 1); }}
              className="min-h-[44px] px-1 text-muted-foreground hover:text-foreground"
            >
              {cat.name}
            </button>
          </span>
        ))}
      </nav>

      {/* Search within current level */}
      <Input
        type="search"
        placeholder="Filter categories..."
        value={search}
        onChange={(e) => { setSearch(e.target.value); }}
        className="min-h-[44px]"
        aria-label="Filter categories"
      />

      {/* Category list */}
      <ul className="space-y-1" aria-label="Categories">
        {filtered.map((cat) => (
          <li key={cat.id}>
            {isLeafLevel ? (
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-muted">
                <Checkbox
                  checked={selected.includes(cat.id)}
                  onCheckedChange={() => { toggleCategory(cat.id); }}
                  disabled={!selected.includes(cat.id) && selected.length >= MAX_SELECTIONS}
                  aria-label={cat.name}
                />
                <span className="text-sm">{cat.name}</span>
                {cat.description ? (
                  <span className="ml-auto text-xs text-muted-foreground">{cat.description}</span>
                ) : null}
              </label>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="w-full min-h-[44px] justify-between"
                onClick={() => { drillDown(cat); }}
              >
                <span>{cat.name}</span>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="px-3 py-4 text-center text-sm text-muted-foreground">
            No categories match your search.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
