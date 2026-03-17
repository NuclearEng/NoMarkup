'use client';

import 'mapbox-gl/dist/mapbox-gl.css';

import type mapboxgl from 'mapbox-gl';
import { useEffect, useRef, useState } from 'react';

interface ServiceAreaMapProps {
  radiusKm: number;
  center?: [number, number]; // [lng, lat]
  className?: string;
}

export function ServiceAreaMap({
  radiusKm,
  center = [-98.5795, 39.8283],
  className,
}: ServiceAreaMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapError, setMapError] = useState(false);

  const mapboxToken = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current || mapRef.current) return;

    let cancelled = false;

    async function initMap() {
      try {
        const mapboxgl = (await import('mapbox-gl')).default;

        if (cancelled || !mapContainerRef.current) return;

        mapboxgl.accessToken = mapboxToken as string;

        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/light-v11',
          center,
          zoom: 8,
        });

        map.on('load', () => {
          if (cancelled) return;
          mapRef.current = map;
          addCircleLayer(map, center, radiusKm);
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
  }, [mapboxToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update circle when radius changes
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    if (map.getSource('service-area')) {
      (map.getSource('service-area') as mapboxgl.GeoJSONSource).setData(
        createCircleGeoJSON(center, radiusKm),
      );
    }

    // Adjust zoom to fit the radius
    const metersPerDegree = 111320;
    const degreesRadius = (radiusKm * 1000) / metersPerDegree;
    map.fitBounds(
      [
        [center[0] - degreesRadius, center[1] - degreesRadius],
        [center[0] + degreesRadius, center[1] + degreesRadius],
      ],
      { padding: 40, duration: 500 },
    );
  }, [radiusKm, center]);

  if (!mapboxToken || mapError) {
    return null;
  }

  return (
    <div
      ref={mapContainerRef}
      className={`min-h-[250px] w-full overflow-hidden rounded-md border ${className ?? ''}`}
      aria-label="Service area map"
      role="application"
    />
  );
}

function createCircleGeoJSON(
  center: [number, number],
  radiusKm: number,
): GeoJSON.FeatureCollection {
  const points = 64;
  const coords: [number, number][] = [];
  const earthRadiusKm = 6371;

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const lat = center[1] + (radiusKm / earthRadiusKm) * (180 / Math.PI) * Math.sin(angle);
    const lng =
      center[0] +
      ((radiusKm / earthRadiusKm) * (180 / Math.PI) * Math.cos(angle)) /
        Math.cos((center[1] * Math.PI) / 180);
    coords.push([lng, lat]);
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [coords],
        },
        properties: {},
      },
    ],
  };
}

function addCircleLayer(map: mapboxgl.Map, center: [number, number], radiusKm: number) {
  map.addSource('service-area', {
    type: 'geojson',
    data: createCircleGeoJSON(center, radiusKm),
  });

  map.addLayer({
    id: 'service-area-fill',
    type: 'fill',
    source: 'service-area',
    paint: {
      'fill-color': 'hsl(var(--primary))',
      'fill-opacity': 0.1,
    },
  });

  map.addLayer({
    id: 'service-area-border',
    type: 'line',
    source: 'service-area',
    paint: {
      'line-color': 'hsl(var(--primary))',
      'line-width': 2,
      'line-dasharray': [2, 2],
    },
  });

  // Fit the map to the circle
  const metersPerDegree = 111320;
  const degreesRadius = (radiusKm * 1000) / metersPerDegree;
  map.fitBounds(
    [
      [center[0] - degreesRadius, center[1] - degreesRadius],
      [center[0] + degreesRadius, center[1] + degreesRadius],
    ],
    { padding: 40 },
  );
}
