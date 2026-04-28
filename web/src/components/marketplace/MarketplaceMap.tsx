'use client';

/**
 * MarketplaceMap — full-bleed Mapbox view of active marketplace listings.
 *
 * Displays each listing as a custom price-tag marker (e.g. "$120"). Hover
 * → popup with photo + title + countdown. Click → routes to the detail page.
 * Mapbox built-in clustering kicks in at low zoom levels so dense pockets
 * (Austin metro, the Bay Area) collapse to a single bubble until the user
 * zooms in.
 *
 * Implementation mirrors patterns from web/src/components/maps/JobMap.tsx —
 * dynamic import of the mapbox-gl module, fallback when token is missing,
 * manual marker management via setData on a GeoJSON source so we can take
 * advantage of cluster + cluster-count layers.
 *
 * Viewport sync: parent passes `onViewportChange(bounds)` which the map
 * fires on `moveend`. The /marketplace/map side panel uses that to filter
 * its visible-listings list to whatever is in the current frame.
 */

import 'mapbox-gl/dist/mapbox-gl.css';

import type mapboxgl from 'mapbox-gl';
import { MapPin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { formatCents } from '@/lib/utils';
import type { Listing } from '@/types';

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface MarketplaceMapProps {
  listings: Listing[];
  /** Initial center [lng, lat]. Defaults to Austin, TX (a reasonable demo center). */
  initialCenter?: [number, number];
  initialZoom?: number;
  className?: string;
  onListingSelect?: (listing: Listing) => void;
  onViewportChange?: (bounds: MapBounds) => void;
}

const AUSTIN_CENTER: [number, number] = [-97.7431, 30.2672];

function getMapboxToken(): string {
  return process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] ?? '';
}

/**
 * Computes a sensible center from the listings themselves: average of the
 * pickup coords. Falls back to the supplied default when no listing has
 * geo data.
 */
function deriveCenter(
  listings: Listing[],
  fallback: [number, number],
): [number, number] {
  const withCoords = listings.filter(
    (l) => l.pickup_lat != null && l.pickup_lng != null,
  );
  if (withCoords.length === 0) return fallback;
  let lat = 0;
  let lng = 0;
  for (const l of withCoords) {
    lat += l.pickup_lat as number;
    lng += l.pickup_lng as number;
  }
  return [lng / withCoords.length, lat / withCoords.length];
}

function MapFallback({ listings }: { listings: Listing[] }) {
  const withLocation = listings.filter(
    (l) => l.pickup_lat !== null && l.pickup_lng !== null,
  );
  return (
    <div className="bg-muted/30 rounded-xl border p-6">
      <div className="text-muted-foreground mb-4 flex items-center gap-2">
        <MapPin className="h-5 w-5" aria-hidden="true" />
        <p className="text-sm font-medium">
          {withLocation.length > 0
            ? `${String(withLocation.length)} listing${withLocation.length !== 1 ? 's' : ''} with location data`
            : 'No listings with location data available'}
        </p>
      </div>
      <p className="text-muted-foreground text-center text-sm">
        Interactive map is not available right now — the list view below has
        every active auction.
      </p>
    </div>
  );
}

export function MarketplaceMap({
  listings,
  initialCenter,
  initialZoom = 10,
  className,
  onListingSelect,
  onViewportChange,
}: MarketplaceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);

  const mapboxToken = getMapboxToken();

  // ── 1. Initialise the map once ────────────────────────────────────────
  useEffect(() => {
    if (!mapboxToken || !containerRef.current || mapRef.current) return;

    const center = initialCenter ?? deriveCenter(listings, AUSTIN_CENTER);
    let cancelled = false;

    async function init() {
      try {
        const mapboxgl = (await import('mapbox-gl')).default;
        if (cancelled || !containerRef.current) return;

        mapboxgl.accessToken = mapboxToken;

        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center,
          zoom: initialZoom,
        });

        map.addControl(new mapboxgl.NavigationControl(), 'top-right');

        map.on('load', () => {
          if (cancelled) return;

          // Source: empty for now, populated by the second effect.
          map.addSource('listings', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            cluster: true,
            clusterMaxZoom: 14,
            clusterRadius: 50,
          });

          // Cluster bubble
          map.addLayer({
            id: 'clusters',
            type: 'circle',
            source: 'listings',
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': '#d4a017',
              'circle-radius': [
                'step',
                ['get', 'point_count'],
                16,
                10,
                22,
                30,
                30,
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#070b14',
              'circle-opacity': 0.85,
            },
          });

          map.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: 'listings',
            filter: ['has', 'point_count'],
            layout: {
              'text-field': ['get', 'point_count_abbreviated'],
              'text-size': 12,
            },
            paint: { 'text-color': '#070b14' },
          });

          // Unclustered: small dot. We render the price-chip via custom DOM
          // markers in the second effect for richer styling than circle layer
          // can provide.
          map.addLayer({
            id: 'unclustered-dot',
            type: 'circle',
            source: 'listings',
            filter: ['!', ['has', 'point_count']],
            paint: {
              'circle-color': 'transparent',
              'circle-radius': 1,
            },
          });

          mapRef.current = map;
          setMapLoaded(true);
        });

        map.on('moveend', () => {
          if (!onViewportChange) return;
          const b = map.getBounds();
          if (!b) return;
          onViewportChange({
            north: b.getNorth(),
            south: b.getSouth(),
            east: b.getEast(),
            west: b.getWest(),
          });
        });

        map.on('error', () => {
          if (cancelled) return;
          setMapError(true);
        });
      } catch {
        if (!cancelled) setMapError(true);
      }
    }

    void init();

    // Snapshot ref values for cleanup (eslint react-hooks/exhaustive-deps).
    const popupSnapshot = popupRef.current;
    const mapSnapshot = mapRef;
    return () => {
      cancelled = true;
      if (popupSnapshot) popupSnapshot.remove();
      if (mapSnapshot.current) {
        mapSnapshot.current.remove();
        mapSnapshot.current = null;
      }
    };
    // initialCenter/initialZoom intentionally not deps — only run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken]);

  // ── 2. Sync markers + GeoJSON source when listings change ────────────
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;

    const withCoords = listings.filter(
      (l) => l.pickup_lat != null && l.pickup_lng != null,
    );

    // Update source for clusters. `getSource` returns the broad Source union;
    // narrow to GeoJSONSource so .setData type-checks.
    const src = map.getSource('listings');
    if (src && 'setData' in src) {
      src.setData({
        type: 'FeatureCollection',
        features: withCoords.map((l) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [l.pickup_lng as number, l.pickup_lat as number],
          },
          properties: {
            id: l.id,
            title: l.title,
            price: l.current_bid_cents,
          },
        })),
      });
    }

    // Custom price-chip markers for unclustered points. We rebuild on every
    // listings change — cheap for ≤200 listings.
    let cancelled = false;
    const markers: mapboxgl.Marker[] = [];

    async function addMarkers() {
      const mapboxgl = (await import('mapbox-gl')).default;
      if (cancelled) return;

      for (const l of withCoords) {
        const el = document.createElement('button');
        el.type = 'button';
        el.setAttribute('data-listing-id', l.id);
        el.setAttribute('aria-label', `${l.title} — ${formatCents(l.current_bid_cents)}`);
        el.className =
          'cursor-pointer rounded-full border border-amber-300/60 bg-zinc-900/90 px-2 py-1 text-[11px] font-bold text-amber-300 shadow-md hover:bg-zinc-900';
        el.textContent = formatCents(l.current_bid_cents);

        const popup = new mapboxgl.Popup({ offset: 16, closeButton: true });
        const popupEl = document.createElement('div');
        popupEl.className = 'min-w-[180px] max-w-[220px] p-1';
        const photoUrl = l.photos[0]?.url;
        if (photoUrl) {
          const img = document.createElement('img');
          img.src = photoUrl;
          img.alt = l.title;
          img.className = 'mb-2 h-24 w-full rounded object-cover';
          popupEl.appendChild(img);
        }
        const titleEl = document.createElement('p');
        titleEl.className = 'm-0 text-sm font-semibold text-zinc-100';
        titleEl.textContent = l.title;
        popupEl.appendChild(titleEl);
        const priceEl = document.createElement('p');
        priceEl.className = 'm-0 mt-1 text-xs text-amber-300';
        priceEl.textContent = `Current bid: ${formatCents(l.current_bid_cents)}`;
        popupEl.appendChild(priceEl);
        if (l.auction_ends_at) {
          const endEl = document.createElement('p');
          endEl.className = 'm-0 mt-0.5 text-[10px] text-zinc-400';
          const ms = new Date(l.auction_ends_at).getTime() - Date.now();
          endEl.textContent =
            ms <= 0
              ? 'Ended'
              : ms < 3_600_000
                ? `${String(Math.max(1, Math.floor(ms / 60000)))}m left`
                : `${String(Math.floor(ms / 3_600_000))}h left`;
          popupEl.appendChild(endEl);
        }
        popup.setDOMContent(popupEl);

        const marker = new mapboxgl.Marker(el)
          .setLngLat([l.pickup_lng as number, l.pickup_lat as number])
          .setPopup(popup)
          .addTo(map);

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onListingSelect?.(l);
        });

        markers.push(marker);
      }
    }

    void addMarkers();

    return () => {
      cancelled = true;
      for (const m of markers) m.remove();
    };
  }, [listings, mapLoaded, onListingSelect]);

  if (!mapboxToken || mapError) {
    return (
      <div className={className} data-testid="marketplace-map-fallback">
        <MapFallback listings={listings} />
      </div>
    );
  }

  return (
    <div className={className} data-testid="marketplace-map">
      <div
        ref={containerRef}
        className="h-full min-h-[480px] w-full overflow-hidden rounded-xl border"
        aria-label="Marketplace listings map"
        role="application"
      />
    </div>
  );
}
