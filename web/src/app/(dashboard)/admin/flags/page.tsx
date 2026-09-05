'use client';

import { useEffect, useMemo, useState } from 'react';

import { Info } from 'lucide-react';
import { toast } from 'sonner';

import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  type AdminFeatureFlag,
  useAdminFlags,
  useToggleFlag,
} from '@/hooks/useAdmin';
import { getApiErrorMessage } from '@/lib/api';

// ─── Flag groups ──────────────────────────────────────
//
// Flags are grouped for the admin's benefit only — the gateway stores a flat
// list keyed by string. "Financial features" gates money-touching surfaces;
// everything else lands in "Platform". Any flag the backend returns that isn't
// explicitly mapped below falls through to "Platform" so new keys never vanish
// from the UI.

const FLAG_GROUP = {
  FINANCIAL: 'financial',
  PLATFORM: 'platform',
} as const;

type FlagGroup = (typeof FLAG_GROUP)[keyof typeof FLAG_GROUP];

interface FlagGroupMeta {
  id: FlagGroup;
  title: string;
  description: string;
}

const FLAG_GROUP_META: readonly FlagGroupMeta[] = [
  {
    id: FLAG_GROUP.FINANCIAL,
    title: 'Financial features',
    description:
      'Money-touching surfaces. On/off only (binary) — partial sticky % rollout is not allowed.',
  },
  {
    id: FLAG_GROUP.PLATFORM,
    title: 'Platform',
    description:
      'Discovery, matching, and live-experience features. When enabled, sticky rollout % controls the server cohort.',
  },
] as const;

// Keys the backend treats as financial for grouping. binary_only from the API
// is the source of truth for % controls (includes nomarkup_guarantee).
const FINANCIAL_FLAG_KEYS = new Set<string>([
  'customer_bnpl',
  'instant_payout',
  'per_job_insurance',
  'insurance_competition',
  'working_capital',
  'lead_gen',
  'legal_services',
]);

// Gateway binary-only set (ARC-10). Used only if binary_only is missing from a
// stale response — admin list always sends it after migration 115.
const BINARY_ONLY_FALLBACK = new Set<string>([
  ...FINANCIAL_FLAG_KEYS,
  'nomarkup_guarantee',
]);

// Human-friendly labels for known keys. Unknown keys fall back to a humanized
// version of the key itself (snake_case → Title Case).
const FLAG_LABELS: Record<string, string> = {
  customer_bnpl: 'Customer BNPL',
  instant_payout: 'Instant Payout',
  per_job_insurance: 'Per-Job Insurance',
  insurance_competition: 'Insurance Competition',
  working_capital: 'Working Capital',
  lead_gen: 'Lead Generation',
  legal_services: 'Legal Services',
  fair_price_index: 'Fair Price Index',
  spectator_mode: 'Spectator Mode',
  nomarkup_guarantee: 'NoMarkup Guarantee',
  smart_matching: 'Smart Matching',
  provider_business_os: 'Provider Business OS',
  live_auction: 'Live Auction',
  marketplace_offers: 'Marketplace Offers',
};

function humanizeKey(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function flagLabel(key: string): string {
  return FLAG_LABELS[key] ?? humanizeKey(key);
}

function groupOf(key: string): FlagGroup {
  return FINANCIAL_FLAG_KEYS.has(key) ? FLAG_GROUP.FINANCIAL : FLAG_GROUP.PLATFORM;
}

function isBinaryOnlyFlag(flag: AdminFeatureFlag): boolean {
  return flag.binary_only ?? BINARY_ONLY_FALLBACK.has(flag.key);
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

interface GroupedFlags {
  meta: FlagGroupMeta;
  flags: AdminFeatureFlag[];
}

function groupFlags(flags: AdminFeatureFlag[]): GroupedFlags[] {
  const byGroup = new Map<FlagGroup, AdminFeatureFlag[]>();
  for (const flag of flags) {
    const g = groupOf(flag.key);
    const bucket = byGroup.get(g);
    if (bucket) {
      bucket.push(flag);
    } else {
      byGroup.set(g, [flag]);
    }
  }
  // Within a group, sort by label for a stable, readable order.
  const sortByLabel = (a: AdminFeatureFlag, b: AdminFeatureFlag) =>
    flagLabel(a.key).localeCompare(flagLabel(b.key));

  return FLAG_GROUP_META.map((meta) => ({
    meta,
    flags: (byGroup.get(meta.id) ?? []).slice().sort(sortByLabel),
  })).filter((group) => group.flags.length > 0);
}

interface FlagRowProps {
  flag: AdminFeatureFlag;
  pending: boolean;
  onToggle: (flag: AdminFeatureFlag, next: boolean) => Promise<void>;
  onRollout: (flag: AdminFeatureFlag, percent: number) => Promise<void>;
}

function FlagRow({ flag, pending, onToggle, onRollout }: FlagRowProps) {
  const switchId = `flag-${flag.key}`;
  const binary = isBinaryOnlyFlag(flag);
  const savedPercent = clampPercent(flag.rollout_percent ?? 100);
  const [draftPercent, setDraftPercent] = useState(savedPercent);
  const [savingRollout, setSavingRollout] = useState(false);

  useEffect(() => {
    setDraftPercent(savedPercent);
  }, [savedPercent, flag.key]);

  const dirty = !binary && draftPercent !== savedPercent;
  const busy = pending || savingRollout;

  async function handleApplyRollout() {
    const next = clampPercent(draftPercent);
    setDraftPercent(next);
    if (next === savedPercent) return;
    setSavingRollout(true);
    try {
      await onRollout(flag, next);
    } finally {
      setSavingRollout(false);
    }
  }

  return (
    <li className="rounded-lg border border-border bg-card/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor={switchId}
              className="block cursor-pointer text-base font-semibold"
            >
              {flagLabel(flag.key)}
            </label>
            {binary ? (
              <Badge variant="secondary" className="text-xs">
                Binary only
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {flag.description || 'No description provided.'}
          </p>
          <p className="mt-1 font-mono text-xs text-zinc-500">{flag.key}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-0.5">
          <span
            className={
              flag.enabled
                ? 'text-sm font-medium text-emerald-400'
                : 'text-sm font-medium text-muted-foreground'
            }
          >
            {flag.enabled ? 'On' : 'Off'}
          </span>
          <Switch
            id={switchId}
            checked={flag.enabled}
            disabled={busy}
            onCheckedChange={(next) => {
              void onToggle(flag, next);
            }}
            aria-label={`Toggle ${flagLabel(flag.key)}`}
          />
        </div>
      </div>

      {binary ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Money/regulated flag — sticky partial rollout is not available. Use On/Off only
          (server enforces 0% or 100%).
        </p>
      ) : (
        <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-zinc-200">
              Sticky rollout{' '}
              <span className="font-mono text-[var(--brand-gold)]">{draftPercent}%</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Server cohort via SHA256(user|key) % 100 when enabled
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Slider
              className="min-w-0 flex-1"
              min={0}
              max={100}
              step={1}
              value={[draftPercent]}
              disabled={busy}
              onValueChange={(values) => {
                const raw = values[0];
                if (raw === undefined) return;
                setDraftPercent(clampPercent(raw));
              }}
              aria-label={`Rollout percent for ${flagLabel(flag.key)}`}
            />
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                className="w-20"
                value={draftPercent}
                disabled={busy}
                onChange={(e) => {
                  setDraftPercent(clampPercent(Number(e.target.value)));
                }}
                aria-label={`Rollout percent input for ${flagLabel(flag.key)}`}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !dirty}
                onClick={() => {
                  void handleApplyRollout();
                }}
              >
                Apply
              </Button>
            </div>
          </div>
          {savedPercent < 100 && flag.enabled ? (
            <p className="text-xs text-amber-400/90">
              Partial rollout active at {savedPercent}% — not all users pass the gate.
            </p>
          ) : null}
        </div>
      )}
    </li>
  );
}

export default function AdminFlagsPage() {
  const { data, isLoading, isError } = useAdminFlags();
  const toggle = useToggleFlag();

  const flags = useMemo(() => data?.flags ?? [], [data]);
  const groups = useMemo(() => groupFlags(flags), [flags]);
  const enabledCount = flags.filter((f) => f.enabled).length;

  async function handleToggle(flag: AdminFeatureFlag, next: boolean) {
    try {
      await toggle.mutateAsync({ key: flag.key, enabled: next });
      toast.success(
        `${flagLabel(flag.key)} ${next ? 'enabled' : 'disabled'}`,
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update feature flag'));
    }
  }

  async function handleRollout(flag: AdminFeatureFlag, percent: number) {
    try {
      await toggle.mutateAsync({
        key: flag.key,
        enabled: flag.enabled,
        rollout_percent: percent,
      });
      toast.success(`${flagLabel(flag.key)} rollout set to ${percent}%`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update rollout percent'));
    }
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="gold-text text-2xl font-bold tracking-tight">Feature Flags</h1>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load feature flags"
          description="Please try refreshing the page."
        />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="space-y-8">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Feature Flags</h1>
          <p className="mt-1 text-zinc-300">
            Turn platform capabilities on or off. Platform flags support sticky % rollout;
            money/regulated flags stay binary.
          </p>
          {!isLoading ? (
            <p className="mt-2 text-sm font-medium text-emerald-400">
              {enabledCount} of {flags.length} flags enabled
            </p>
          ) : null}
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-card/40 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-gold)]" aria-hidden="true" />
          <p className="text-sm text-zinc-300">
            Disabling a flag hides that feature from users and stops new flows. Sticky rollout
            (platform flags only) gates server routes for a stable user cohort — the public flag
            map stays a flat on/off for CDN caching; partial % is enforced on the gateway only.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : flags.length === 0 ? (
          <EmptyState
            icon={<AnimatedIllustration type="search-empty" size="sm" />}
            title="No feature flags configured"
            description="Flags are seeded by migration. None were found."
          />
        ) : (
          <div className="space-y-10">
            {groups.map((group) => (
              <section
                key={group.meta.id}
                className="space-y-4"
                aria-label={group.meta.title}
              >
                <div className="border-b border-border pb-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-xl font-semibold">{group.meta.title}</h2>
                    <Badge variant="secondary" className="text-xs">
                      {group.flags.filter((f) => f.enabled).length} / {group.flags.length}{' '}
                      on
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {group.meta.description}
                  </p>
                </div>

                <ul className="space-y-3">
                  {group.flags.map((flag) => (
                    <FlagRow
                      key={flag.key}
                      flag={flag}
                      pending={toggle.isPending}
                      onToggle={handleToggle}
                      onRollout={handleRollout}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
