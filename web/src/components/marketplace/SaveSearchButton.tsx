'use client';

// SaveSearchButton — the "Save this search" entry point for the marketplace.
//
// Captures the current filter set as a standing saved search (with alerts) so
// the user is notified when new matching auctions go live. Pairs with
// useCreateSavedSearch + the /me/saved-searches management page. (Bug 2)
//
// Only useful to signed-in users; the parent hides it for logged-out visitors
// since the create endpoint is auth-only.

import { BookmarkPlus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCreateSavedSearch,
  type SavedSearchAlertFrequency,
} from '@/hooks/useWatchlist';
import type { SearchListingsParams } from '@/types';

const FREQUENCIES: { value: SavedSearchAlertFrequency; label: string }[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'off', label: 'Off' },
];

interface SaveSearchButtonProps {
  /** The current marketplace filters to persist. */
  filters: SearchListingsParams;
  className?: string;
}

/** Suggest a default name from the query so the user can just hit Save. */
function defaultName(filters: SearchListingsParams): string {
  if (filters.query) return filters.query;
  if (filters.category_id) return `Category: ${filters.category_id}`;
  return 'All auctions';
}

export function SaveSearchButton({ filters, className }: SaveSearchButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<SavedSearchAlertFrequency>('daily');
  const createSearch = useCreateSavedSearch();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Seed the name field each time the dialog opens so it reflects the
      // filters that were active at open time.
      setName(defaultName(filters));
      setFrequency('daily');
    }
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    createSearch.mutate(
      {
        name: trimmed,
        // Persist the active filter set (page/page_size are runtime-only).
        query: { ...filters, page: undefined, page_size: undefined },
        alert_frequency: frequency,
      },
      {
        onSuccess: () => {
          setOpen(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        type="button"
        variant="outline"
        className={className}
        onClick={() => {
          handleOpenChange(true);
        }}
      >
        <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
        <span>Save this search</span>
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this search</DialogTitle>
          <DialogDescription>
            Get alerted when new auctions match your current filters.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="saved-search-name">Name</Label>
            <Input
              id="saved-search-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="e.g. Vintage cameras under $200"
              maxLength={120}
              autoComplete="off"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-zinc-300">Alert frequency</legend>
            <div className="flex flex-wrap gap-2">
              {FREQUENCIES.map((f) => (
                <Button
                  key={f.value}
                  type="button"
                  variant={frequency === f.value ? 'default' : 'outline'}
                  className="min-h-[44px]"
                  aria-pressed={frequency === f.value}
                  onClick={() => {
                    setFrequency(f.value);
                  }}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </fieldset>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-[44px]"
            disabled={createSearch.isPending || name.trim().length === 0}
            onClick={handleSave}
          >
            {createSearch.isPending ? 'Saving…' : 'Save search'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
