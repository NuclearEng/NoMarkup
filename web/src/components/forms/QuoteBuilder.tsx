'use client';

// Quote builder — Wave 5 audit Section H. Provider-side composer that
// pairs the bid amount input with a reusable-template picker.
//
// Used inside the bid surface (BidForm / placeBid sheet) so a provider
// can apply "$150 drain unclog, 30 min, parts included" to a job in
// one click instead of retyping every time. Increments use_count on
// apply so popular templates float to the top of the picker on the
// next read.

import { Bookmark, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  useCreateQuoteTemplate,
  useDeleteQuoteTemplate,
  useIncrementQuoteTemplateUse,
  useQuoteTemplates,
} from '@/hooks/useQuoteTemplates';
import { formatCents } from '@/lib/utils';
import type { QuoteTemplate } from '@/types';

export interface QuoteBuilderValue {
  amount_cents?: number;
  notes: string;
}

export interface QuoteBuilderProps {
  /** Current draft quote — controlled by the parent. */
  value: QuoteBuilderValue;
  /** Emits the updated draft on every change. */
  onChange: (value: QuoteBuilderValue) => void;
  /** Optional max for the amount input (job's open-bid ceiling, etc.). */
  maxAmountCents?: number;
  /** Disabled state — applied to every interactive element. */
  disabled?: boolean;
}

/**
 * Renders an amount-in-dollars + notes textarea, with a side picker
 * that lets the provider apply a saved template, save the current
 * draft as a new template, or delete a template they no longer use.
 */
export function QuoteBuilder({ value, onChange, maxAmountCents, disabled }: QuoteBuilderProps) {
  const { data: templates = [], isLoading } = useQuoteTemplates();
  const createTpl = useCreateQuoteTemplate();
  const deleteTpl = useDeleteQuoteTemplate();
  const incrementUse = useIncrementQuoteTemplateUse();

  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState('');

  // Reset the dialog input every time the picker closes so the next
  // open starts clean.
  useEffect(() => {
    if (!saveOpen) setNewName('');
  }, [saveOpen]);

  function applyTemplate(t: QuoteTemplate) {
    const next: QuoteBuilderValue = {
      amount_cents: t.default_amount_cents ?? value.amount_cents,
      notes: t.body,
    };
    onChange(next);
    incrementUse.mutate(t.id);
  }

  function applyTemplateById(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    applyTemplate(t);
  }

  async function saveAsTemplate() {
    const trimmed = newName.trim();
    if (!trimmed || !value.notes) return;
    await createTpl.mutateAsync({
      name: trimmed,
      body: value.notes,
      default_amount_cents: value.amount_cents,
    });
    setSaveOpen(false);
  }

  function deleteTemplate(id: string) {
    deleteTpl.mutate(id);
  }

  const dollars = useMemo(() => {
    if (value.amount_cents === undefined) return '';
    return (value.amount_cents / 100).toString();
  }, [value.amount_cents]);

  const canSave = value.notes.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="quote-amount">Bid amount</Label>
        <div className="relative">
          <span
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
            aria-hidden="true"
          >
            $
          </span>
          <Input
            id="quote-amount"
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            max={maxAmountCents !== undefined ? maxAmountCents / 100 : undefined}
            placeholder="0.00"
            value={dollars}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') {
                onChange({ ...value, amount_cents: undefined });
                return;
              }
              const parsed = Number(v);
              if (!Number.isFinite(parsed)) return;
              onChange({ ...value, amount_cents: Math.round(parsed * 100) });
            }}
            className="min-h-[44px] pl-8"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="quote-notes">Quote details</Label>
          {templates.length > 0 ? (
            <div className="flex items-center gap-2">
              <Bookmark className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
              <Select disabled={disabled || isLoading} onValueChange={applyTemplateById}>
                <SelectTrigger className="h-8 min-h-[36px] w-auto gap-1 px-2 text-xs">
                  <SelectValue placeholder="Apply template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <span>{t.name}</span>
                        {t.default_amount_cents !== null &&
                        t.default_amount_cents !== undefined ? (
                          <span className="text-muted-foreground text-xs">
                            {formatCents(t.default_amount_cents)}
                          </span>
                        ) : null}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <Textarea
          id="quote-notes"
          rows={6}
          maxLength={4000}
          placeholder="Describe what's included, your timeline, and any caveats..."
          value={value.notes}
          disabled={disabled}
          onChange={(e) => {
            onChange({ ...value, notes: e.target.value });
          }}
        />
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-xs">
            {String(value.notes.length)}/4000 characters
          </p>
          <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || !canSave}
                className="h-7 gap-1 text-xs"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Save as template
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save quote template</DialogTitle>
                <DialogDescription>
                  Reuse this on future bids. Templates only you can see.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="template-name">Template name</Label>
                <Input
                  id="template-name"
                  value={newName}
                  maxLength={100}
                  onChange={(e) => {
                    setNewName(e.target.value);
                  }}
                  placeholder="e.g. Drain unclog — basic"
                  className="min-h-[44px]"
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSaveOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void saveAsTemplate();
                  }}
                  disabled={!newName.trim() || createTpl.isPending}
                >
                  {createTpl.isPending ? 'Saving...' : 'Save'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {templates.length > 0 ? (
        <details className="rounded-md border p-2">
          <summary className="cursor-pointer text-xs font-medium">
            Manage templates ({String(templates.length)})
          </summary>
          <ul className="mt-2 space-y-1">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">
                  {t.name}
                  <span className="text-muted-foreground ml-2">
                    used {String(t.use_count)}x
                  </span>
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive p-1"
                  onClick={() => {
                    deleteTemplate(t.id);
                  }}
                  aria-label={`Delete template ${t.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
