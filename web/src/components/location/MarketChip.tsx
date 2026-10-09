'use client';

import { MarketSelector } from '@/components/location/MarketSelector';
import { useSelectedMarket } from '@/hooks/useSelectedMarket';

/**
 * MarketChip — the global header's "current city" switcher, craigslist/DoorDash
 * style. Reflects and updates the shared market context (localStorage-backed via
 * useSelectedMarket), so picking a city here syncs every other consumer.
 *
 * Renders the MarketSelector in compact mode; the selector owns its own
 * accessible trigger (MapPin + label + chevron) and searchable popover.
 */
export function MarketChip({ className }: { className?: string }) {
  const [market, setMarket] = useSelectedMarket();

  return (
    <MarketSelector
      compact
      value={market?.slug ?? null}
      onSelect={setMarket}
      placeholder="Set your city"
      className={className}
    />
  );
}
