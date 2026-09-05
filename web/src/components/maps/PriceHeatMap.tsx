'use client';

import 'mapbox-gl/dist/mapbox-gl.css';

import type mapboxgl from 'mapbox-gl';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { usePricingHeatmap, type PricingHeatmapPoint } from '@/hooks/usePricing';

function getMapboxToken(): string {
  return process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] ?? '';
}

interface PriceHeatMapProps {
  categorySlug?: string;
  className?: string;
}

const HONEST_CAPTION = 'Completed jobs by ZIP (where we have coordinates).';

function buildGeoJSON(points: PricingHeatmapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature' as const,
      properties: {
        zip_code: p.zip_code,
        median_price: p.median_price_cents / 100,
        jobs: p.completed_jobs,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [p.lng, p.lat],
      },
    })),
  };
}

function boundsOf(points: PricingHeatmapPoint[]): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  const first = points[0];
  if (!first) return null;
  let minLng = first.lng;
  let minLat = first.lat;
  let maxLng = first.lng;
  let maxLat = first.lat;
  for (const p of points) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export function PriceHeatMap({ categorySlug, className }: PriceHeatMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);

  const mapboxToken = getMapboxToken();
  const { data, isLoading } = usePricingHeatmap(categorySlug);
  const points = data?.points ?? [];

  const firstPoint = points[0];
  const mapCenter = useMemo<[number, number] | null>(
    () => (firstPoint ? [firstPoint.lng, firstPoint.lat] : null),
    [firstPoint],
  );

  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current || mapRef.current || !mapCenter) return;

    let cancelled = false;
    let loaded = false;

    async function initMap() {
      try {
        const mapboxgl = (await import('mapbox-gl')).default;

        if (cancelled || !mapContainerRef.current || !mapCenter) return;

        mapboxgl.accessToken = mapboxToken;

        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/light-v11',
          center: mapCenter,
          zoom: 8,
        });

        map.addControl(new mapboxgl.NavigationControl(), 'top-right');

        map.on('load', () => {
          if (cancelled) return;
          mapRef.current = map;
          loaded = true;
          setMapLoaded(true);
        });

        map.on('error', () => {
          if (cancelled) return;
          if (!loaded) setMapError(true);
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
  }, [mapboxToken, mapCenter]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded || points.length === 0) return;

    const map = mapRef.current;
    const geojson = buildGeoJSON(points);

    const existingSource = map.getSource('pricing');
    if (existingSource) {
      (existingSource as mapboxgl.GeoJSONSource).setData(geojson);
    } else {
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
    }

    const bounds = boundsOf(points);
    if (bounds && typeof map.fitBounds === 'function') {
      map.fitBounds(bounds, { padding: 48, maxZoom: 11, duration: 0 });
    }
  }, [points, mapLoaded]);

  if (!mapboxToken) {
    return (
      <div
        className={`bg-muted flex items-center justify-center rounded-lg border ${className ?? ''}`}
      >
        <p className="text-muted-foreground text-sm">{HONEST_CAPTION}</p>
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

  if (!isLoading && points.length === 0) {
    return (
      <div
        className={`bg-muted flex flex-col items-center justify-center gap-1 rounded-lg border px-6 text-center ${className ?? ''}`}
      >
        <p className="text-muted-foreground text-sm">
          No completed jobs with known ZIP coordinates yet.
        </p>
        <p className="text-muted-foreground text-xs">{HONEST_CAPTION}</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      {!mapLoaded || isLoading ? <Skeleton className="h-full w-full rounded-lg" /> : null}
      <div
        ref={mapContainerRef}
        className={`h-full w-full rounded-lg ${!mapLoaded || isLoading ? 'invisible absolute inset-0' : ''}`}
        aria-label={HONEST_CAPTION}
        role="application"
      />
    </div>
  );
}
