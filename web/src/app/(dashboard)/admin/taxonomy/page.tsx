'use client';

import { ChevronDown, ChevronRight, FolderTree, Layers, Tag } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategoryTree } from '@/hooks/useCategories';
import type { ServiceCategory } from '@/types';

const LEVEL_ICONS = [FolderTree, Layers, Tag] as const;
const LEVEL_LABELS = ['Category', 'Subcategory', 'Service Type'] as const;

function CategoryNode({
  category,
  depth,
}: {
  category: ServiceCategory;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = category.children && category.children.length > 0;
  const LevelIcon = LEVEL_ICONS[Math.min(depth, LEVEL_ICONS.length - 1)] ?? Tag;
  const levelLabel = LEVEL_LABELS[Math.min(depth, LEVEL_LABELS.length - 1)] ?? 'Item';

  return (
    <div>
      <button
        type="button"
        onClick={() => { setExpanded(!expanded); }}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
        style={{ paddingLeft: `${String(depth * 24 + 12)}px` }}
        aria-expanded={hasChildren ? expanded : undefined}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
          )
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <LevelIcon className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
        <span className="flex-1 truncate text-sm font-medium">{category.name}</span>
        <Badge variant="outline" className="text-[10px]">
          {levelLabel}
        </Badge>
        {category.description ? (
          <span className="hidden max-w-[200px] truncate text-xs text-white/40 lg:inline">
            {category.description}
          </span>
        ) : null}
      </button>

      {expanded && hasChildren ? (
        <div role="group" aria-label={`${category.name} subcategories`}>
          {category.children?.map((child) => (
            <CategoryNode
              key={child.id}
              category={child}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminTaxonomyPage() {
  const { data: categories, isLoading, isError } = useCategoryTree();

  const totalCategories = categories?.length ?? 0;
  const totalSubcategories = categories?.reduce(
    (sum, cat) => sum + (cat.children?.length ?? 0),
    0,
  ) ?? 0;
  const totalServiceTypes = categories?.reduce(
    (sum, cat) =>
      sum +
      (cat.children?.reduce(
        (subSum, sub) => subSum + (sub.children?.length ?? 0),
        0,
      ) ?? 0),
    0,
  ) ?? 0;

  return (
    <PageTransition>
    <div className="space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Service Taxonomy</h1>
        <p className="mt-1 text-zinc-300">
          Manage service categories, subcategories, and service types.
        </p>
      </div>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardContent className="flex items-center gap-3 p-4">
            <FolderTree className="h-8 w-8 text-white/50" aria-hidden="true" />
            <div>
              <div className="text-2xl font-bold tabular-nums text-white">
                {isLoading ? <Skeleton className="h-8 w-12 inline-block" /> : String(totalCategories)}
              </div>
              <p className="text-xs text-white/50">Categories</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardContent className="flex items-center gap-3 p-4">
            <Layers className="h-8 w-8 text-white/50" aria-hidden="true" />
            <div>
              <div className="text-2xl font-bold tabular-nums text-white">
                {isLoading ? <Skeleton className="h-8 w-12 inline-block" /> : String(totalSubcategories)}
              </div>
              <p className="text-xs text-white/50">Subcategories</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardContent className="flex items-center gap-3 p-4">
            <Tag className="h-8 w-8 text-white/50" aria-hidden="true" />
            <div>
              <div className="text-2xl font-bold tabular-nums text-white">
                {isLoading ? <Skeleton className="h-8 w-12 inline-block" /> : String(totalServiceTypes)}
              </div>
              <p className="text-xs text-white/50">Service Types</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Category tree */}
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader>
          <CardTitle className="gold-text text-base">Category Tree</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={`skel-cat-${String(i)}`} className="h-8 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="py-12 text-center rounded-lg border border-destructive/50">
              <p className="text-sm text-destructive">
                Failed to load categories. Please try refreshing.
              </p>
            </div>
          ) : !categories || categories.length === 0 ? (
            <div className="py-12 text-center rounded-lg border border-white/[0.06]">
              <p className="text-sm text-white/50">
                No categories found. Create your first category to get started.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-white/[0.06]" role="tree" aria-label="Service categories">
              {categories.map((category) => (
                <CategoryNode
                  key={category.id}
                  category={category}
                  depth={0}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </PageTransition>
  );
}
