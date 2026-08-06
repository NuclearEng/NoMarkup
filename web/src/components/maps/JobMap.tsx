'use client';

import 'mapbox-gl/dist/mapbox-gl.css';

import type mapboxgl from 'mapbox-gl';
import { MapPin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { formatCents } from '@/lib/utils';
import type { Job } from '@/types';

interface JobMapProps {
  jobs: Job[];
  className?: string;
  onJobSelect?: (job: Job) => void;
}

function getMapboxToken(): string {
  return process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] ?? '';
}

/**
 * A job is plottable only when it has finite lat/lng that aren't the (0,0)
 * Null-Island placeholder a failed geocode can leave behind. Null, undefined,
 * NaN, and non-numeric strings all fail Number.isFinite and must never reach
 * Mapbox setLngLat (throws "Invalid LngLat object: (NaN, NaN)").
 */
function hasRealLocation(job: Job): boolean {
  const lat = Number(job.location_lat);
  const lng = Number(job.location_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return true;
}

/** Safe [lng, lat] for Mapbox — only call after hasRealLocation. */
function jobLngLat(job: Job): [number, number] {
  return [Number(job.location_lng), Number(job.location_lat)];
}

function MapFallback({ jobs, onJobSelect }: { jobs: Job[]; onJobSelect?: (job: Job) => void }) {
  const jobsWithLocation = jobs.filter(hasRealLocation);

  return (
    <div className="bg-muted/30 rounded-xl border p-6">
      <div className="text-muted-foreground mb-4 flex items-center gap-2">
        <MapPin className="h-5 w-5" aria-hidden="true" />
        <p className="text-sm font-medium">
          {jobsWithLocation.length > 0
            ? `${String(jobsWithLocation.length)} job${jobsWithLocation.length !== 1 ? 's' : ''} with location data`
            : 'No jobs with location data available'}
        </p>
      </div>

      {jobsWithLocation.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {jobsWithLocation.map((job) => (
            <button
              key={job.id}
              type="button"
              className="bg-card hover:bg-muted/50 flex items-start gap-3 rounded-lg border p-3 text-left transition-colors"
              onClick={() => {
                onJobSelect?.(job);
              }}
            >
              <MapPin className="text-primary mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{job.title}</p>
                {job.location_address ? (
                  <p className="text-muted-foreground truncate text-xs">{job.location_address}</p>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {job.location_lat?.toFixed(4)}, {job.location_lng?.toFixed(4)}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {String(job.bid_count)} bid{job.bid_count !== 1 ? 's' : ''}
                  </Badge>
                  {job.starting_bid_cents ? (
                    <span className="text-xs font-medium">
                      {formatCents(job.starting_bid_cents)}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-center text-sm">
          Jobs without location data are shown in the list below.
        </p>
      )}
    </div>
  );
}

export function JobMap({ jobs, className, onJobSelect }: JobMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);

  const mapboxToken = getMapboxToken();

  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current || mapRef.current) return;

    let cancelled = false;

    // Tracks whether the style finished loading. A non-fatal error AFTER load
    // (a single missing tile/sprite/glyph, a telemetry blip) must NOT replace
    // the whole map with the fallback — only a failure to load is fatal.
    let loaded = false;

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
          loaded = true;
          setMapLoaded(true);
        });

        map.on('error', () => {
          if (cancelled) return;
          // Only fatal if the map never loaded; ignore post-load non-fatal errors.
          if (!loaded) setMapError(true);
        });
      } catch {
        if (!cancelled) {
          setMapError(true);
        }
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

  // Add markers when map is loaded and jobs change
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;

    async function addMarkers() {
      const mapboxgl = (await import('mapbox-gl')).default;
      const jobsWithLocation = jobs.filter(hasRealLocation);

      // Remove existing markers via source if it exists
      if (map.getSource('jobs')) {
        map.removeLayer('jobs-layer');
        map.removeSource('jobs');
      }

      if (jobsWithLocation.length === 0) return;

      // Add markers
      for (const job of jobsWithLocation) {
        const el = document.createElement('div');
        el.className =
          'flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md cursor-pointer';
        el.innerHTML =
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';

        const popup = new mapboxgl.Popup({ offset: 25, className: 'nomarkup-job-popup' });
        const popupDiv = document.createElement('div');
        popupDiv.className = 'p-1 max-w-[200px]';

        const titleEl = document.createElement('p');
        titleEl.className = 'font-semibold text-sm m-0';
        titleEl.textContent = job.title;
        popupDiv.appendChild(titleEl);

        if (job.location_address) {
          const addrEl = document.createElement('p');
          addrEl.className = 'text-xs text-muted-foreground mt-1 mb-0';
          addrEl.textContent = job.location_address;
          popupDiv.appendChild(addrEl);
        }

        const infoEl = document.createElement('p');
        infoEl.className = 'text-xs mt-1 mb-0';
        const bidText = `${String(job.bid_count)} bid${job.bid_count !== 1 ? 's' : ''}`;
        infoEl.textContent = job.starting_bid_cents
          ? `${bidText} - Up to ${formatCents(job.starting_bid_cents)}`
          : bidText;
        popupDiv.appendChild(infoEl);

        popup.setDOMContent(popupDiv);

        new mapboxgl.Marker(el)
          .setLngLat(jobLngLat(job))
          .setPopup(popup)
          .addTo(map);

        el.addEventListener('click', () => {
          onJobSelect?.(job);
        });
      }

      // Fit bounds
      if (jobsWithLocation.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        for (const job of jobsWithLocation) {
          bounds.extend(jobLngLat(job));
        }
        map.fitBounds(bounds, { padding: 50, maxZoom: 12 });
      } else if (jobsWithLocation.length === 1) {
        const singleJob = jobsWithLocation[0];
        if (singleJob) {
          map.flyTo({
            center: jobLngLat(singleJob),
            zoom: 12,
          });
        }
      }
    }

    void addMarkers();
  }, [jobs, mapLoaded, onJobSelect]);

  // No token: render fallback
  if (!mapboxToken || mapError) {
    return (
      <div className={className}>
        {!mapboxToken ? (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
            Interactive map is not available at this time.
          </div>
        ) : null}
        <MapFallback jobs={jobs} onJobSelect={onJobSelect} />
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        ref={mapContainerRef}
        className="min-h-[400px] w-full overflow-hidden rounded-xl border"
        aria-label="Job locations map"
        role="application"
      />
      {!mapLoaded ? (
        <div className="mt-2">
          <MapFallback jobs={jobs} onJobSelect={onJobSelect} />
        </div>
      ) : null}
    </div>
  );
}
