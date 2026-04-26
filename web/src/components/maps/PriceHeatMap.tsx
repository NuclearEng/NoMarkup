'use client';

import 'mapbox-gl/dist/mapbox-gl.css';

import type mapboxgl from 'mapbox-gl';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { usePricingOverview } from '@/hooks/usePricing';
import type { PricingOverviewCategory } from '@/hooks/usePricing';

function getMapboxToken(): string {
  return process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] ?? '';
}

interface PriceHeatMapProps {
  categorySlug?: string;
  className?: string;
}

/**
 * Build GeoJSON features from pricing overview data.
 *
 * In production, ZIP-level coordinates would come from the server.
 * For now, we distribute points around a central US position using
 * a deterministic hash of the category name so placement is stable
 * across renders.
 */
function buildGeoJSON(categories: PricingOverviewCategory[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: categories.map((cat) => {
      // Simple deterministic offset derived from category name characters
      let hash = 0;
      for (let i = 0; i < cat.category_name.length; i++) {
        hash = (hash * 31 + cat.category_name.charCodeAt(i)) | 0;
      }
      const lngOffset = ((hash % 1000) / 1000) * 40 - 20; // roughly -20 to +20
      const latOffset = (((hash >> 10) % 1000) / 1000) * 20 - 10; // roughly -10 to +10

      return {
        type: 'Feature' as const,
        properties: {
          category: cat.category_name,
          median_price: cat.avg_median_cents / 100,
          jobs: cat.total_jobs,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [-98.5795 + lngOffset, 39.8283 + latOffset],
        },
      };
    }),
  };
}

export function PriceHeatMap({ categorySlug, className }: PriceHeatMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);

  const mapboxToken = getMapboxToken();

  const { data, isLoading } = usePricingOverview();

  // Filter to a single category if provided
  const categories = useMemo(
    () =>
      categorySlug
        ? (data?.categories ?? []).filter((c) => c.category_slug === categorySlug)
        : (data?.categories ?? []),
    [categorySlug, data?.categories],
  );

  // Initialize the map
  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current || mapRef.current) return;

    let cancelled = false;

    async function initMap() {
      try {
        const mapboxgl = (await import('mapbox-gl')).default;

        if (cancelled || !mapContainerRef.current) return;

        mapboxgl.accessToken = mapboxToken;

        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/light-v11',
          center: [-98.5795, 39.8283], // Center of US
          zoom: 3,
        });

        map.addControl(new mapboxgl.NavigationControl(), 'top-right');

        map.on('load', () => {
          if (cancelled) return;
          mapRef.current = map;
          setMapLoaded(true);
        });

        map.on('error', () => {
          if (!cancelled) setMapError(true);
        });
      } catch {
        if (!cancelled) setMapError(true);
      }
    }

    void initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [mapboxToken]);

  // Add/update the heatmap layer when data or map readiness changes
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || categories.length === 0) return;

    const map = mapRef.current;
    const geojson = buildGeoJSON(categories);

    // Update existing source or create source + layer
    const existingSource = map.getSource('pricing');
    if (existingSource) {
      (existingSource as mapboxgl.GeoJSONSource).setData(geojson);
      return;
    }

    map.addSource('pricing', { type: 'geojson', data: geojson });

    map.addLayer({
      id: 'pricing-heat',
      type: 'heatmap',
      source: 'pricing',
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'median_price'], 0, 0, 500, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(16, 185, 129, 0)',
          0.2,
          'rgb(167, 243, 208)',
          0.4,
          'rgb(110, 231, 183)',
          0.6,
          'rgb(52, 211, 153)',
          0.8,
          'rgb(16, 185, 129)',
          1,
          'rgb(5, 150, 105)',
        ],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 20, 15, 40],
        'heatmap-opacity': 0.7,
      },
    });
  }, [categories, mapLoaded]);

  // No token — show a graceful placeholder
  if (!mapboxToken) {
    return (
      <div
        className={`bg-muted flex items-center justify-center rounded-lg border ${className ?? ''}`}
      >
        <p className="text-muted-foreground text-sm">
          Price heat map is not available at this time.
        </p>
      </div>
    );
  }

  if (mapError) {
    return (
      <div
        className={`bg-muted flex items-center justify-center rounded-lg border ${className ?? ''}`}
      >
        <p className="text-muted-foreground text-sm">
          Failed to load the map. Please try again later.
        </p>
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      {!mapLoaded || isLoading ? <Skeleton className="h-full w-full rounded-lg" /> : null}
      <div
        ref={mapContainerRef}
        className={`h-full w-full rounded-lg ${!mapLoaded || isLoading ? 'invisible absolute inset-0' : ''}`}
        aria-label="Neighborhood price heat map"
        role="application"
      />
    </div>
  );
}
