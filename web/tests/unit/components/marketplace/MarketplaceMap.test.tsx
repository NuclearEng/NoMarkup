import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceMap } from '@/components/marketplace/MarketplaceMap';
import type { Listing } from '@/types';

interface MockHandlers {
  load?: () => void;
  error?: () => void;
  moveend?: () => void;
}

const mapInstance: {
  handlers: MockHandlers;
  on: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  addControl: ReturnType<typeof vi.fn>;
  addSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
} = {
  handlers: {},
  on: vi.fn(),
  remove: vi.fn(),
  addControl: vi.fn(),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  getSource: vi.fn(),
  getBounds: vi.fn(),
};

const MapMock = vi.fn();
const NavigationControlMock = vi.fn();
const PopupMock = vi.fn();
const MarkerMock = vi.fn();

vi.mock('mapbox-gl', () => ({
  default: {
    Map: MapMock,
    NavigationControl: NavigationControlMock,
    Popup: PopupMock,
    Marker: MarkerMock,
    accessToken: '',
  },
}));

vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

function resetMaps(): void {
  mapInstance.handlers = {};
  mapInstance.on.mockReset();
  mapInstance.remove.mockReset();
  mapInstance.addControl.mockReset();
  mapInstance.addSource.mockReset();
  mapInstance.addLayer.mockReset();
  mapInstance.getSource.mockReset();
  mapInstance.getBounds.mockReset();

  mapInstance.on.mockImplementation((event: string, cb: () => void) => {
    if (event === 'load') mapInstance.handlers.load = cb;
    if (event === 'error') mapInstance.handlers.error = cb;
    if (event === 'moveend') mapInstance.handlers.moveend = cb;
    return mapInstance;
  });

  MapMock.mockReset();
  // Vitest 4 constructs mock implementations with Reflect.construct, so mocks
  // invoked with `new` (the mapbox constructors) need constructible `function`
  // implementations — arrow functions throw "is not a constructor".
  MapMock.mockImplementation(function () {
    return mapInstance;
  });

  NavigationControlMock.mockReset();

  PopupMock.mockReset();
  PopupMock.mockImplementation(function () {
    return {
      setDOMContent: vi.fn().mockReturnThis(),
      remove: vi.fn(),
    };
  });

  MarkerMock.mockReset();
  MarkerMock.mockImplementation(function () {
    return {
      setLngLat: vi.fn().mockReturnThis(),
      setPopup: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
    };
  });
}

const ORIGINAL_TOKEN = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

beforeEach(() => {
  resetMaps();
  vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
  } else {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = ORIGINAL_TOKEN;
  }
});

function makeListing(over: Partial<Listing> = {}): Listing {
  return {
    id: 'm-1',
    seller_id: 's-1',
    category_id: 'cat',
    category_name: 'Furniture',
    category_slug: 'furniture',
    title: 'Map test listing',
    description: 'On a map',
    status: 'active',
    photos: [],
    pickup_zip: '78701',
    pickup_city: 'Austin',
    pickup_state: 'TX',
    pickup_address: null,
    pickup_lat: 30.27,
    pickup_lng: -97.74,
    starting_price_cents: 1000,
    current_bid_cents: 4500,
    min_increment_cents: 100,
    bidder_count: 2,
    bid_count: 5,
    auction_duration_hours: 24,
    auction_ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    snipe_extension_count: 0,
    distance_km: null,
    is_user_winning: false,
    was_outbid: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

describe('MarketplaceMap', () => {
  it('renders without crashing and constructs a Mapbox map with the expected style', async () => {
    render(<MarketplaceMap listings={[makeListing()]} />);
    await waitFor(() => {
      expect(MapMock).toHaveBeenCalled();
    });
    const opts = MapMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(opts?.['style']).toBe('mapbox://styles/mapbox/dark-v11');
    expect(opts?.['container']).toBeInstanceOf(HTMLElement);
  });

  it('renders one DOM marker per listing with coordinates', async () => {
    const listings = [
      makeListing({ id: 'a', pickup_lat: 30.1, pickup_lng: -97.7 }),
      makeListing({ id: 'b', pickup_lat: 30.3, pickup_lng: -97.8 }),
      // Listings without coords should be skipped
      makeListing({ id: 'c', pickup_lat: null, pickup_lng: null }),
    ];
    render(<MarketplaceMap listings={listings} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    await waitFor(() => {
      expect(MarkerMock).toHaveBeenCalledTimes(2);
    });
  });

  it('falls back to the static panel when the Mapbox token is absent', () => {
    vi.unstubAllEnvs();
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    const { getByTestId } = render(<MarketplaceMap listings={[makeListing()]} />);
    expect(getByTestId('marketplace-map-fallback')).toBeDefined();
  });
});
