'use client';

import { Navigation } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ExactAddress {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
}

function normalized(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Single-line postal address. `null` if every component is empty. */
export function formatExactAddress(addr: ExactAddress | null | undefined): string | null {
  if (!addr) return null;
  const streetPart = normalized(addr.street);
  let cityState = '';
  if (normalized(addr.city)) {
    cityState = normalized(addr.city) ?? '';
  }
  if (normalized(addr.state)) {
    const state = normalized(addr.state) ?? '';
    cityState = cityState ? `${cityState}, ${state}` : state;
  }
  const zipPart = normalized(addr.zip_code);

  const parts: string[] = [];
  if (streetPart) parts.push(streetPart);
  if (cityState) parts.push(cityState);
  if (zipPart) parts.push(zipPart);

  const joined = parts.join(', ');
  return joined.length > 0 ? joined : null;
}

/** Street, or city plus state/zip — strong enough for a maps deep link. */
export function isDirectionsReady(addr: ExactAddress | null | undefined): boolean {
  if (!addr) return false;
  if (normalized(addr.street)) return true;
  const hasCity = !!normalized(addr.city);
  const hasRegion = !!normalized(addr.state) || !!normalized(addr.zip_code);
  return hasCity && hasRegion;
}

export function canOfferDirections(address: string | null | undefined): boolean {
  return (address?.trim().length ?? 0) >= 3;
}

export function formatLatLng(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat},${lng}`;
}

function prefersAppleMaps(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
}

/** Apple Maps on Apple clients; Google Maps HTTPS otherwise. */
export function directionsUrl(address: string): string | null {
  const query = address.trim();
  if (query.length < 3) return null;
  if (prefersAppleMaps()) {
    return `https://maps.apple.com/?daddr=${encodeURIComponent(query)}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}&travelmode=driving`;
}

export interface DirectionsButtonProps {
  address: string;
  className?: string;
}

export function DirectionsButton({ address, className }: DirectionsButtonProps) {
  const url = directionsUrl(address);
  if (!url) return null;

  return (
    <Button asChild variant="outline" className={cn('min-h-[44px] gap-2', className)}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <Navigation className="h-4 w-4" aria-hidden="true" />
        Get Directions
      </a>
    </Button>
  );
}
