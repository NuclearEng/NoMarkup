'use client';

// /me/wishlist — the buyer's "dream item" wishlist + price alerts.
//
// A wishlist item is a standing want: a keyword (e.g. "4 wheeler"), an optional
// category, and a max-price ceiling ("notify me if one is available at or below
// $500"). When a matching marketplace listing goes live, the gateway writes a
// notification that surfaces via the bell (see gateway/internal/handler/
// wishlist.go::NotifyWishlistMatches, wired into the listing-create path).
//
// This page is the list + add form + remove. Loading / error / empty states are
// all handled; the form is keyboard-navigable with inline validation.

import { Bell, Sparkles, Tag, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGoodsCategoryTree } from '@/hooks/useCategories';
import {
  useCreateWishlistItem,
  useDeleteWishlistItem,
  useWishlist,
} from '@/hooks/useWishlist';
import { formatCents } from '@/lib/utils';

export default function WishlistPage() {
  const { data, isLoading, isError, refetch } = useWishlist();
  const createItem = useCreateWishlistItem();
  const deleteItem = useDeleteWishlistItem();
  const { data: categories } = useGoodsCategoryTree();

  const [keyword, setKeyword] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const items = data?.wishlist_items ?? [];

  const onSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);

    const trimmed = keyword.trim();
    if (!trimmed) {
      setFormError('Enter what you’re looking for (e.g. “4 wheeler”).');
      return;
    }
    const dollars = Number(maxPrice);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setFormError('Enter a max price greater than $0.');
      return;
    }

    createItem.mutate(
      {
        keyword: trimmed,
        // Money is integer cents end-to-end. Round to the nearest cent.
        max_price_cents: Math.round(dollars * 100),
        ...(categoryId ? { category_id: categoryId } : {}),
      },
      {
        onSuccess: () => {
          setKeyword('');
          setMaxPrice('');
          setCategoryId('');
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="gold-text text-2xl font-bold">Your wishlist</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Tell us what you’re hunting for and your ceiling. We’ll ping you the
            moment a match goes live at or below your price.
          </p>
        </div>
        <Link
          href="/marketplace"
          className="shrink-0 text-sm text-[var(--brand-gold)] underline-offset-4 hover:underline"
        >
          Browse marketplace
        </Link>
      </header>

      {/* Add form */}
      <form
        onSubmit={onSubmit}
        className="glass glass-highlight mb-8 rounded-xl border border-[var(--brand-gold)]/10 p-4 sm:p-5"
        aria-labelledby="wishlist-add-heading"
      >
        <h2
          id="wishlist-add-heading"
          className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-wide text-zinc-300 uppercase"
        >
          <Sparkles className="h-4 w-4 text-[var(--brand-gold)]" aria-hidden="true" />
          Add a dream item
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="wishlist-keyword">What are you looking for?</Label>
            <Input
              id="wishlist-keyword"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
              }}
              placeholder="e.g. 4 wheeler, kayak, road bike"
              maxLength={120}
              className="mt-1.5"
              aria-describedby={formError ? 'wishlist-form-error' : undefined}
            />
          </div>

          <div>
            <Label htmlFor="wishlist-max-price">Notify me at or below ($)</Label>
            <Input
              id="wishlist-max-price"
              type="number"
              inputMode="decimal"
              min="1"
              step="1"
              value={maxPrice}
              onChange={(e) => {
                setMaxPrice(e.target.value);
              }}
              placeholder="500"
              className="mt-1.5"
              aria-describedby={formError ? 'wishlist-form-error' : undefined}
            />
          </div>

          <div>
            <Label htmlFor="wishlist-category">Category (optional)</Label>
            <select
              id="wishlist-category"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
              }}
              className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <option value="">Any category</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {formError ? (
          <p
            id="wishlist-form-error"
            role="alert"
            className="mt-3 text-sm text-red-400"
          >
            {formError}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end">
          <Button type="submit" className="min-h-[44px]" disabled={createItem.isPending}>
            {createItem.isPending ? 'Adding…' : 'Add to wishlist'}
          </Button>
        </div>
      </form>

      {/* List */}
      {isLoading ? (
        <ul className="space-y-3" aria-busy="true" aria-live="polite">
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={`wishlist-skeleton-${String(i)}`}
              className="glass glass-highlight h-20 animate-pulse rounded-xl border border-[var(--brand-gold)]/10"
            />
          ))}
        </ul>
      ) : isError ? (
        <EmptyState
          icon={<Tag className="h-8 w-8" aria-hidden="true" />}
          title="Failed to load your wishlist"
          description="Something went wrong while fetching your wishlist. Check your connection and try again."
          action={
            <Button
              variant="default"
              className="min-h-[44px]"
              onClick={() => {
                void refetch();
              }}
            >
              Retry
            </Button>
          }
          className="border-destructive/30"
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-8 w-8" aria-hidden="true" />}
          title="No wishlist items yet"
          description="Add something you’ve always wanted above. When a matching auction goes live at or below your price, we’ll alert you so you can bid first."
        />
      ) : (
        <ul className="space-y-3" aria-live="polite">
          {items.map((item) => (
            <li
              key={item.id}
              className="glass glass-highlight flex items-center justify-between gap-4 rounded-xl border border-[var(--brand-gold)]/10 p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-zinc-100">{item.keyword}</p>
                <p className="mt-0.5 inline-flex items-center gap-1 text-sm text-zinc-400">
                  <Bell className="h-3 w-3" aria-hidden="true" />
                  Alert at or below {formatCents(item.max_price_cents)}
                </p>
                {item.category_name ? (
                  <p className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-500">
                    <Tag className="h-3 w-3" aria-hidden="true" />
                    {item.category_name}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] min-w-[44px] shrink-0 border-red-500/20 text-red-300 hover:bg-red-500/10"
                disabled={deleteItem.isPending}
                aria-label={`Remove ${item.keyword} from wishlist`}
                onClick={() => {
                  deleteItem.mutate(item.id);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
