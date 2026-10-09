'use client';

import { useState } from 'react';

import { Building2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageTransition } from '@/components/ui/page-transition';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { getApiErrorMessage } from '@/lib/api';
import {
  INSURANCE_PRODUCT_TYPE,
  INSURER_STATUS,
  useAdminInsurers,
  useOnboardInsurer,
  useUpdateInsurer,
} from '@/hooks/useAdmin';
import type {
  InsuranceProductType,
  Insurer,
  InsurerStatus,
  OnboardInsurerProduct,
} from '@/hooks/useAdmin';
import type { BadgeProps } from '@/components/ui/badge';

const PRODUCT_TYPE_LABELS: Record<InsuranceProductType, string> = {
  [INSURANCE_PRODUCT_TYPE.PROPERTY_DAMAGE]: 'Property damage',
  [INSURANCE_PRODUCT_TYPE.WORKMANSHIP]: 'Workmanship',
  [INSURANCE_PRODUCT_TYPE.COMPLETION]: 'Completion',
  [INSURANCE_PRODUCT_TYPE.LIABILITY]: 'Liability',
};

const PRODUCT_TYPE_OPTIONS: InsuranceProductType[] = [
  INSURANCE_PRODUCT_TYPE.PROPERTY_DAMAGE,
  INSURANCE_PRODUCT_TYPE.WORKMANSHIP,
  INSURANCE_PRODUCT_TYPE.COMPLETION,
  INSURANCE_PRODUCT_TYPE.LIABILITY,
];

const STATUS_BADGE_VARIANT: Record<InsurerStatus, BadgeProps['variant']> = {
  [INSURER_STATUS.PENDING]: 'outline',
  [INSURER_STATUS.APPROVED]: 'default',
  [INSURER_STATUS.SUSPENDED]: 'destructive',
};

const STATUS_LABELS: Record<InsurerStatus, string> = {
  [INSURER_STATUS.PENDING]: 'Pending',
  [INSURER_STATUS.APPROVED]: 'Approved',
  [INSURER_STATUS.SUSPENDED]: 'Suspended',
};

/** Rates are stored as basis points (1% = 100 bps). */
function formatRate(bps: number): string {
  return `${(bps / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

function InsurerCard({ insurer }: { insurer: Insurer }) {
  const updateInsurer = useUpdateInsurer();

  function setStatus(status: InsurerStatus, successMessage: string) {
    updateInsurer.mutate(
      { id: insurer.id, status },
      {
        onSuccess: () => {
          toast.success(successMessage);
        },
        onError: (err) => {
          toast.error(getApiErrorMessage(err, 'Failed to update insurer'));
        },
      },
    );
  }

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="gold-text flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" aria-hidden="true" />
            {insurer.name}
          </CardTitle>
          <p className="mt-1 font-mono text-xs text-zinc-400">{insurer.slug}</p>
        </div>
        <Badge variant={STATUS_BADGE_VARIANT[insurer.status]} className="text-xs">
          {STATUS_LABELS[insurer.status]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Rate card
          </h3>
          {insurer.products.length === 0 ? (
            <p className="text-sm text-zinc-400">No products configured.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-white/5">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-zinc-400">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Product
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Base rate
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Min premium
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Active
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {insurer.products.map((product) => (
                    <tr key={product.id} className="border-b border-white/5 last:border-0">
                      <td className="px-3 py-2 text-zinc-100">
                        {PRODUCT_TYPE_LABELS[product.product_type]}
                      </td>
                      <td className="px-3 py-2 font-mono text-zinc-100">
                        {formatRate(product.base_rate_bps)}
                      </td>
                      <td className="px-3 py-2 font-mono text-zinc-100">
                        {formatCents(product.min_premium_cents)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={product.active ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {product.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {insurer.status !== INSURER_STATUS.APPROVED ? (
            <Button
              size="sm"
              className="min-h-[44px]"
              disabled={updateInsurer.isPending}
              onClick={() => {
                setStatus(INSURER_STATUS.APPROVED, `${insurer.name} approved`);
              }}
            >
              Approve
            </Button>
          ) : null}
          {insurer.status !== INSURER_STATUS.SUSPENDED ? (
            <Button
              size="sm"
              variant="destructive"
              className="min-h-[44px]"
              disabled={updateInsurer.isPending}
              onClick={() => {
                setStatus(INSURER_STATUS.SUSPENDED, `${insurer.name} suspended`);
              }}
            >
              Suspend
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

interface RateCardRow {
  product_type: InsuranceProductType;
  /** Base rate as a percentage string (e.g. "2.5"); converted to bps on submit. */
  rate_percent: string;
  /** Min premium as a dollar string; converted to cents on submit. */
  min_premium_dollars: string;
}

function emptyRow(): RateCardRow {
  return {
    product_type: INSURANCE_PRODUCT_TYPE.PROPERTY_DAMAGE,
    rate_percent: '',
    min_premium_dollars: '',
  };
}

function OnboardInsurerForm() {
  const onboard = useOnboardInsurer();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [rows, setRows] = useState<RateCardRow[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);

  function updateRow(index: number, patch: Partial<RateCardRow>) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function reset() {
    setName('');
    setSlug('');
    setRows([emptyRow()]);
    setError(null);
  }

  function handleSubmit() {
    setError(null);

    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedName) {
      setError('Insurer name is required.');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(trimmedSlug)) {
      setError('Slug must be lowercase letters, numbers, and hyphens.');
      return;
    }

    const products: OnboardInsurerProduct[] = [];
    for (const row of rows) {
      const rate = Number(row.rate_percent);
      const premium = Number(row.min_premium_dollars);
      if (!Number.isFinite(rate) || rate < 0) {
        setError('Every rate-card row needs a valid base rate.');
        return;
      }
      if (!Number.isFinite(premium) || premium < 0) {
        setError('Every rate-card row needs a valid minimum premium.');
        return;
      }
      products.push({
        product_type: row.product_type,
        base_rate_bps: Math.round(rate * 100),
        min_premium_cents: Math.round(premium * 100),
      });
    }

    if (products.length === 0) {
      setError('Add at least one rate-card row.');
      return;
    }

    onboard.mutate(
      { name: trimmedName, slug: trimmedSlug, products },
      {
        onSuccess: () => {
          toast.success(`${trimmedName} onboarded`);
          reset();
        },
        onError: (err) => {
          const message = getApiErrorMessage(err, 'Failed to onboard insurer');
          setError(message);
          toast.error(message);
        },
      },
    );
  }

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader>
        <CardTitle className="gold-text text-base">Onboard insurer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="insurer-name">Name</Label>
            <Input
              id="insurer-name"
              placeholder="Acme Mutual"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="min-h-[44px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="insurer-slug">Slug</Label>
            <Input
              id="insurer-slug"
              placeholder="acme-mutual"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
              }}
              className="min-h-[44px]"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Rate card
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px]"
              onClick={addRow}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add row
            </Button>
          </div>

          {rows.map((row, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
            >
              <div className="space-y-2">
                <Label htmlFor={`product-type-${String(index)}`}>Product type</Label>
                <Select
                  value={row.product_type}
                  onValueChange={(v) => {
                    updateRow(index, { product_type: v as InsuranceProductType });
                  }}
                >
                  <SelectTrigger
                    id={`product-type-${String(index)}`}
                    className="min-h-[44px]"
                    aria-label="Product type"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_TYPE_OPTIONS.map((type) => (
                      <SelectItem key={type} value={type}>
                        {PRODUCT_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`rate-${String(index)}`}>Base rate (%)</Label>
                <Input
                  id={`rate-${String(index)}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.25}
                  placeholder="2.50"
                  value={row.rate_percent}
                  onChange={(e) => {
                    updateRow(index, { rate_percent: e.target.value });
                  }}
                  className="min-h-[44px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`premium-${String(index)}`}>Min premium ($)</Label>
                <Input
                  id={`premium-${String(index)}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={1}
                  placeholder="50.00"
                  value={row.min_premium_dollars}
                  onChange={(e) => {
                    updateRow(index, { min_premium_dollars: e.target.value });
                  }}
                  className="min-h-[44px]"
                />
              </div>

              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="min-h-[44px] min-w-[44px]"
                  disabled={rows.length === 1}
                  aria-label={`Remove rate-card row ${String(index + 1)}`}
                  onClick={() => {
                    removeRow(index);
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button
          className="min-h-[44px]"
          disabled={onboard.isPending}
          onClick={handleSubmit}
        >
          {onboard.isPending ? 'Onboarding...' : 'Onboard insurer'}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AdminInsurersPage() {
  const { data, isLoading, isError } = useAdminInsurers();
  const insurers = data?.insurers ?? [];

  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Insurers</h1>
          <p className="mt-1 text-zinc-300">
            Onboard insurers, review their rate cards, and approve or suspend them in the
            competitive insurance marketplace.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <Card key={i} className="glass border border-[var(--brand-gold)]/10">
                <CardContent className="space-y-3 p-6">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={<AnimatedIllustration type="error" size="sm" />}
            title="Failed to load insurers"
            description="Please try refreshing the page."
          />
        ) : insurers.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-10 w-10 text-zinc-500" aria-hidden="true" />}
            title="No insurers yet"
            description="Onboard your first insurer below to start the marketplace."
          />
        ) : (
          <div className="space-y-4">
            {insurers.map((insurer) => (
              <InsurerCard key={insurer.id} insurer={insurer} />
            ))}
          </div>
        )}

        <OnboardInsurerForm />
      </div>
    </PageTransition>
  );
}
