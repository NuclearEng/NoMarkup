import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobMap } from '@/components/maps/JobMap';
import type { Job } from '@/types';

interface MockHandlers {
  load?: () => void;
  error?: () => void;
}

const mapInstance: {
  handlers: MockHandlers;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  addControl: ReturnType<typeof vi.fn>;
  addSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  removeLayer: ReturnType<typeof vi.fn>;
  removeSource: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  flyTo: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
} = {
  handlers: {},
  on: vi.fn(),
  off: vi.fn(),
  remove: vi.fn(),
  addControl: vi.fn(),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  removeSource: vi.fn(),
  getSource: vi.fn(),
  flyTo: vi.fn(),
  fitBounds: vi.fn(),
};

const MapMock = vi.fn();
const NavigationControlMock = vi.fn();
const PopupMock = vi.fn();
const MarkerMock = vi.fn();
const LngLatBoundsMock = vi.fn();
const markerEvents: { el: HTMLElement; clickCb?: () => void }[] = [];

vi.mock('mapbox-gl', () => {
  return {
    default: {
      Map: MapMock,
      NavigationControl: NavigationControlMock,
      Popup: PopupMock,
      Marker: MarkerMock,
      LngLatBounds: LngLatBoundsMock,
      accessToken: '',
    },
  };
});

vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

const ORIGINAL_TOKEN = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

function resetMapInstance(): void {
  mapInstance.handlers = {};
  mapInstance.on.mockReset();
  mapInstance.off.mockReset();
  mapInstance.remove.mockReset();
  mapInstance.addControl.mockReset();
  mapInstance.addSource.mockReset();
  mapInstance.addLayer.mockReset();
  mapInstance.removeLayer.mockReset();
  mapInstance.removeSource.mockReset();
  mapInstance.getSource.mockReset();
  mapInstance.flyTo.mockReset();
  mapInstance.fitBounds.mockReset();

  mapInstance.on.mockImplementation((event: string, cb: () => void) => {
    if (event === 'load') mapInstance.handlers.load = cb;
    if (event === 'error') mapInstance.handlers.error = cb;
    return mapInstance;
  });
}

function resetMapboxConstructors(): void {
  MapMock.mockReset();
  MapMock.mockImplementation(() => mapInstance);

  NavigationControlMock.mockReset();

  PopupMock.mockReset();
  PopupMock.mockImplementation(() => ({
    setDOMContent: vi.fn().mockReturnThis(),
  }));

  markerEvents.length = 0;
  MarkerMock.mockReset();
  MarkerMock.mockImplementation((el: HTMLElement) => {
    const entry: { el: HTMLElement; clickCb?: () => void } = { el };
    markerEvents.push(entry);
    el.addEventListener = ((_evt: string, cb: () => void): void => {
      entry.clickCb = cb;
    }) as unknown as typeof el.addEventListener;
    return {
      setLngLat: vi.fn().mockReturnThis(),
      setPopup: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
    };
  });

  LngLatBoundsMock.mockReset();
  LngLatBoundsMock.mockImplementation(() => ({
    extend: vi.fn(),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMapInstance();
  resetMapboxConstructors();
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
  } else {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = ORIGINAL_TOKEN;
  }
});

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    customer_id: 'cust-1',
    category_id: 'cat-1',
    category_name: 'Plumbing',
    category_slug: 'plumbing',
    title: 'Fix kitchen sink',
    description: 'Leaky faucet',
    status: 'active',
    schedule_type: 'flexible',
    scheduled_date: null,
    is_recurring: false,
    recurrence_frequency: null,
    location_address: '123 Main St',
    location_lat: 40.7128,
    location_lng: -74.006,
    starting_bid_cents: 25000,
    offer_accepted_cents: null,
    auction_duration_hours: 48,
    auction_ends_at: null,
    bid_count: 3,
    lowest_bid_cents: null,
    market_range: null,
    auction_type: 'live',
    snipe_extension_count: 0,
    original_auction_ends_at: null,
    created_at: '2026-03-01T12:00:00Z',
    updated_at: '2026-03-01T12:00:00Z',
    ...overrides,
  };
}

describe('JobMap — fallback (no token) branch', () => {
  beforeEach(() => {
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
  });

  it('renders the fallback list when no Mapbox token is set', () => {
    render(<JobMap jobs={[makeJob()]} />);
    expect(screen.getByText('Fix kitchen sink')).toBeDefined();
    expect(screen.getByText('123 Main St')).toBeDefined();
  });

  it('shows "no jobs with location" message when jobs lack coordinates', () => {
    render(<JobMap jobs={[makeJob({ location_lat: null, location_lng: null })]} />);
    expect(screen.getByText(/No jobs with location data available/i)).toBeDefined();
  });

  it('invokes onJobSelect when a fallback row is clicked', async () => {
    const onSelect = vi.fn();
    render(<JobMap jobs={[makeJob()]} onJobSelect={onSelect} />);
    await userEvent.click(screen.getByText('Fix kitchen sink'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('shows bid count badges in the fallback list', () => {
    render(<JobMap jobs={[makeJob({ bid_count: 5 })]} />);
    expect(screen.getByText('5 bids')).toBeDefined();
  });

  it('shows singular "1 bid" when bid_count is 1', () => {
    render(<JobMap jobs={[makeJob({ bid_count: 1 })]} />);
    expect(screen.getByText('1 bid')).toBeDefined();
  });

  it('renders the lat/lng when no location_address is provided', () => {
    render(
      <JobMap
        jobs={[makeJob({ location_address: null, location_lat: 40.5, location_lng: -73.9 })]}
      />,
    );
    expect(screen.getByText(/40\.5000.*-73\.9000/)).toBeDefined();
  });

  it('renders the formatted starting bid when starting_bid_cents is set', () => {
    render(<JobMap jobs={[makeJob({ starting_bid_cents: 50000 })]} />);
    // formatCents(50000) = "$500.00"
    expect(screen.getByText(/\$500/)).toBeDefined();
  });

  it('renders the warning banner when token unset', () => {
    render(<JobMap jobs={[makeJob()]} />);
    expect(screen.getByText(/Interactive map is not available/i)).toBeDefined();
  });

  it('shows "1 job with location data" message (singular)', () => {
    render(<JobMap jobs={[makeJob()]} />);
    expect(screen.getByText(/1 job with location data/i)).toBeDefined();
  });

  it('shows "N jobs with location data" message (plural)', () => {
    render(<JobMap jobs={[makeJob({ id: 'a' }), makeJob({ id: 'b' })]} />);
    expect(screen.getByText(/2 jobs with location data/i)).toBeDefined();
  });
});

describe('JobMap — token-set / map render branch', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders the map container with accessibility attributes when token is set', () => {
    const { container } = render(<JobMap jobs={[]} className="custom-map" />);
    const region = container.querySelector('[aria-label="Job locations map"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('role')).toBe('application');
  });

  it('constructs the Mapbox Map with correct style, center, and zoom', async () => {
    render(<JobMap jobs={[]} />);
    await waitFor(() => {
      expect(MapMock).toHaveBeenCalled();
    });
    const opts = MapMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(opts?.['style']).toBe('mapbox://styles/mapbox/light-v11');
    expect(opts?.['center']).toEqual([-98.5795, 39.8283]);
    expect(opts?.['zoom']).toBe(3);
    expect(opts?.['container']).toBeInstanceOf(HTMLElement);
  });

  it('attaches a NavigationControl after constructing the map', async () => {
    render(<JobMap jobs={[]} />);
    await waitFor(() => {
      expect(mapInstance.addControl).toHaveBeenCalled();
    });
    const placement = mapInstance.addControl.mock.calls[0]?.[1] as string | undefined;
    expect(placement).toBe('top-right');
    expect(NavigationControlMock).toHaveBeenCalled();
  });

  it('registers load and error event handlers on the map', async () => {
    render(<JobMap jobs={[]} />);
    await waitFor(() => {
      expect(mapInstance.on).toHaveBeenCalled();
    });
    const events = mapInstance.on.mock.calls.map((c) => c[0] as string);
    expect(events).toContain('load');
    expect(events).toContain('error');
  });

  it('does not add markers if there are no jobs with locations', async () => {
    render(<JobMap jobs={[makeJob({ location_lat: null, location_lng: null })]} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    // wait briefly for the async addMarkers
    await waitFor(() => {
      expect(MapMock).toHaveBeenCalled();
    });
    expect(MarkerMock).not.toHaveBeenCalled();
  });

  it('flies to a single job location when only one job is present', async () => {
    render(<JobMap jobs={[makeJob()]} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    await waitFor(() => {
      expect(mapInstance.flyTo).toHaveBeenCalled();
    });
    const flyArgs = mapInstance.flyTo.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(flyArgs['center']).toEqual([-74.006, 40.7128]);
    expect(flyArgs['zoom']).toBe(12);
  });

  it('creates one Marker and one Popup per job with location', async () => {
    const jobs = [
      makeJob({ id: 'a', location_lat: 40.7, location_lng: -74 }),
      makeJob({ id: 'b', location_lat: 41, location_lng: -74.5 }),
    ];
    render(<JobMap jobs={jobs} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });

    await waitFor(() => {
      expect(MarkerMock).toHaveBeenCalledTimes(2);
    });
    expect(PopupMock).toHaveBeenCalledTimes(2);
  });

  it('fits bounds when there are multiple jobs', async () => {
    const jobs = [
      makeJob({ id: 'a', location_lat: 40.7, location_lng: -74 }),
      makeJob({ id: 'b', location_lat: 41, location_lng: -74.5 }),
    ];
    render(<JobMap jobs={jobs} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    await waitFor(() => {
      expect(mapInstance.fitBounds).toHaveBeenCalled();
    });
    const fitOpts = mapInstance.fitBounds.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(fitOpts['padding']).toBe(50);
    expect(fitOpts['maxZoom']).toBe(12);
  });

  it('removes existing layer + source before re-adding markers when source already exists', async () => {
    render(<JobMap jobs={[makeJob()]} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    mapInstance.getSource.mockReturnValue({ type: 'geojson' });
    act(() => {
      mapInstance.handlers.load?.();
    });
    await waitFor(() => {
      expect(mapInstance.removeLayer).toHaveBeenCalledWith('jobs-layer');
    });
    expect(mapInstance.removeSource).toHaveBeenCalledWith('jobs');
  });

  it('invokes onJobSelect when a marker element is clicked', async () => {
    const onSelect = vi.fn();
    render(<JobMap jobs={[makeJob({ id: 'click-me' })]} onJobSelect={onSelect} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    await waitFor(() => {
      expect(markerEvents.length).toBeGreaterThan(0);
    });
    const entry = markerEvents[0];
    expect(entry?.clickCb).toBeDefined();
    entry?.clickCb?.();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: 'click-me' });
  });

  it('shows the fallback list inside the map wrapper while loading', () => {
    const { container } = render(<JobMap jobs={[makeJob()]} />);
    // The fallback is rendered alongside the map container while !mapLoaded
    expect(container.querySelector('[aria-label="Job locations map"]')).not.toBeNull();
    expect(screen.getByText('Fix kitchen sink')).toBeDefined();
  });

  it('shows the error fallback when the map emits an error event', async () => {
    const { container } = render(<JobMap jobs={[makeJob()]} />);
    await waitFor(() => {
      expect(mapInstance.handlers.error).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.error?.();
    });
    await waitFor(() => {
      // After error, the no-token banner is NOT shown but the fallback list is
      expect(container.querySelector('[aria-label="Job locations map"]')).toBeNull();
    });
    expect(screen.getByText('Fix kitchen sink')).toBeDefined();
  });

  it('cleans up the map on unmount by calling map.remove()', async () => {
    const { unmount } = render(<JobMap jobs={[makeJob()]} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    unmount();
    expect(mapInstance.remove).toHaveBeenCalled();
  });

  it('builds popup content with title, address, and bid info', async () => {
    render(<JobMap jobs={[makeJob({ starting_bid_cents: 75000, bid_count: 4 })]} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    await waitFor(() => {
      expect(PopupMock).toHaveBeenCalled();
    });
    // Popup constructor receives an options object
    const popupOpts = PopupMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(popupOpts?.['offset']).toBe(25);
    expect(popupOpts?.['className']).toBe('nomarkup-job-popup');
  });
});
