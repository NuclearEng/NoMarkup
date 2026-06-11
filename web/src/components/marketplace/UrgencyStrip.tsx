'use client';

import { Activity, Clock, Eye } from 'lucide-react';

interface UrgencyStripProps {
  closingSoonCount: number;
  totalWatchers: number;
  liveBidsCount: number;
}

/**
 * Above-the-fold "stadium scoreboard" hero. Three live KPIs that announce
 * the room is busy: how many auctions close in the next hour, how many
 * total spectators are watching right now, and how many bids landed
 * recently. The point is to make a first-time visitor feel like they
 * walked into a packed game, not a parking lot.
 */
export function UrgencyStrip({
  closingSoonCount,
  totalWatchers,
  liveBidsCount,
}: UrgencyStripProps) {
  return (
    <div
      className="glass glass-highlight relative overflow-hidden rounded-xl border border-[var(--brand-gold)]/15 p-5 sm:p-6"
      role="region"
      aria-label="Live marketplace activity"
    >
      {/* Subtle gold scanline */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand-gold)]/40 to-transparent"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--brand-gold)] uppercase">
            Live now
          </p>
          <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-100 sm:text-3xl">
            {closingSoonCount === 0
              ? 'No auctions closing in the next hour'
              : `${String(closingSoonCount)} auction${closingSoonCount === 1 ? '' : 's'} closing in the next hour`}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Highest bidder wins on the clock. Local pickup only inside 25 miles.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-3 sm:gap-4">
          <Stat
            label="Closing <1h"
            value={closingSoonCount}
            icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}
            tone="red"
          />
          <Stat
            label="Watching"
            value={totalWatchers}
            icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            tone="amber"
          />
          <Stat
            label="Live bids"
            value={liveBidsCount}
            icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
            tone="emerald"
          />
        </dl>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'red' | 'amber' | 'emerald';
}) {
  const color =
    tone === 'red' ? 'text-red-300' : tone === 'amber' ? 'text-amber-300' : 'text-emerald-300';

  // No role on the wrapper div: a <div> child of <dl> is only valid (HTML spec
  // + axe definition-list/dlitem) when it is a ROLE-LESS wrapper grouping a
  // dt+dd pair. role="group" re-mapped it away from the dl structure and
  // orphaned the dt/dd (axe: definition-list ×1, dlitem ×6).
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
      <dt className={`flex items-center gap-1 text-[10px] font-semibold tracking-wider ${color} uppercase`}>
        <span className="inline-flex" aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className={`mt-0.5 text-xl font-bold tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}
