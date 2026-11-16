// MarketplaceMap — behaviour beyond the smoke tests in MarketplaceMap.test.tsx.
// MOCKED: mapbox-gl (Map / Marker / Popup / NavigationControl record what the
// component hands them). PROVEN: map centre + zoom derivation, the GeoJSON
// pushed to the cluster source, price-chip markers and their popups (photo,
// price, time-left wording), selection + viewport callbacks, fatal vs
// non-fatal map errors, the fallback copy, and cleanup on unmount.
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceMap, type MapBounds } from '@/components/marketplace/MarketplaceMap';
import type { Listing } from '@/types';

interface MapOptions {
  container: HTMLElement;
  style: string;
  center: [number, number];
  zoom: number;
}

interface FeatureCollection {
  type: string;
  features: {
    type: string;
    geometry: { type: string; coordinates: [number, number] };
    properties: { id: string; title: string; price: number };
  }[];
}

interface MarkerRecord {
  el: HTMLElement;
  lngLat: [number, number] | undefined;
  popupContent: HTMLElement | undefined;
  addedTo: unknown;
  remove: ReturnType<typeof vi.fn<() => void>>;
}

const mb = vi.hoisted(() => ({
  handlers: {} as Record<string, (() => void) | undefined>,
  mapOptions: [] as unknown[],
  controls: [] as { control: unknown; position: string }[],
  sources: [] as { id: string; spec: unknown }[],
  layers: [] as { id: string; type: string }[],
  setData: [] as unknown[],
  markers: [] as unknown[],
  mapRemove: vi.fn(),
  bounds: undefined as
    | { getNorth: () => number; getSouth: () => number; getEast: () => number; getWest: () => number }
    | null
    | undefined,
  sourceKind: 'geojson' as 'geojson' | 'other' | 'missing',
  throwOnConstruct: false,
}));

vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

vi.mock('mapbox-gl', () => {
  class MockMap {
    constructor(options: unknown) {
      if (mb.throwOnConstruct) throw new Error('WebGL not supported');
      mb.mapOptions.push(options);
    }
    on(event: string, cb: () => void) {
      mb.handlers[event] = cb;
      return this;
    }
    addControl(control: unknown, position: string) {
      mb.controls.push({ control, position });
    }
    addSource(id: string, spec: unknown) {
      mb.sources.push({ id, spec });
    }
    addLayer(layer: { id: string; type: string }) {
      mb.layers.push({ id: layer.id, type: layer.type });
    }
    getSource() {
      if (mb.sourceKind === 'missing') return undefined;
      if (mb.sourceKind === 'other') return { type: 'raster' };
      return {
        setData: (data: unknown) => {
          mb.setData.push(data);
        },
      };
    }
    getBounds() {
      return mb.bounds;
    }
    remove() {
      mb.mapRemove();
    }
  }

  class MockPopup {
    content: HTMLElement | undefined;
    setDOMContent(el: HTMLElement) {
      this.content = el;
      return this;
    }
    remove() {
      return this;
    }
  }

  class MockMarker {
    record: {
      el: HTMLElement;
      lngLat: [number, number] | undefined;
      popupContent: HTMLElement | undefined;
      addedTo: unknown;
      remove: ReturnType<typeof vi.fn<() => void>>;
    };
    constructor(el: HTMLElement) {
      this.record = {
        el,
        lngLat: undefined,
        popupContent: undefined,
        addedTo: undefined,
        remove: vi.fn<() => void>(),
      };
      mb.markers.push(this.record);
    }
    setLngLat(lngLat: [number, number]) {
      this.record.lngLat = lngLat;
      return this;
    }
    setPopup(popup: MockPopup) {
      this.record.popupContent = popup.content;
      return this;
    }
    addTo(map: unknown) {
      this.record.addedTo = map;
      return this;
    }
    remove() {
      this.record.remove();
    }
  }

  class MockNavigationControl {
    readonly kind = 'navigation';
  }

  return {
    default: {
      Map: MockMap,
      Popup: MockPopup,
      Marker: MockMarker,
      NavigationControl: MockNavigationControl,
      accessToken: '',
    },
  };
});

const NOW = new Date('2026-06-01T12:00:00.000Z').getTime();

function makeListing(over: Partial<Listing> = {}): Listing {
  return {
    id: 'm-1',
    seller_id: 's-1',
    category_id: 'cat',
    category_name: 'Furniture',
    category_slug: 'furniture',
    title: 'Oak table',
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
    auction_ends_at: new Date(NOW + 2 * 3_600_000).toISOString(),
    snipe_extension_count: 0,
    distance_km: null,
    is_user_winning: false,
    was_outbid: false,
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    ...over,
  };
}

function mapOptions(): MapOptions {
  const options = mb.mapOptions[0];
  if (!options) throw new Error('map was not constructed');
  return options as MapOptions;
}

function markers(): MarkerRecord[] {
  return mb.markers as MarkerRecord[];
}

function lastSetData(): FeatureCollection {
  const data = mb.setData.at(-1);
  if (!data) throw new Error('setData was not called');
  return data as FeatureCollection;
}

async function waitForMap() {
  await waitFor(() => {
    expect(mb.handlers['load']).toBeDefined();
  });
}

function fire(event: 'load' | 'error' | 'moveend') {
  const handler = mb.handlers[event];
  if (!handler) throw new Error(`no ${event} handler registered`);
  act(() => {
    handler();
  });
}

async function renderLoaded(
  listings: Listing[],
  props: Partial<Parameters<typeof MarketplaceMap>[0]> = {},
) {
  const view = render(<MarketplaceMap listings={listings} {...props} />);
  await waitForMap();
  fire('load');
  await waitFor(() => {
    expect(markers()).toHaveLength(
      listings.filter(
        (l) =>
          l.pickup_lat != null &&
          l.pickup_lng != null &&
          !(l.pickup_lat === 0 && l.pickup_lng === 0),
      ).length,
    );
  });
  return view;
}

function popupLines(marker: MarkerRecord | undefined): string[] {
  if (!marker?.popupContent) throw new Error('marker has no popup');
  return Array.from(marker.popupContent.querySelectorAll('p')).map((p) => p.textContent);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.test');
  mb.handlers = {};
  mb.mapOptions = [];
  mb.controls = [];
  mb.sources = [];
  mb.layers = [];
  mb.setData = [];
  mb.markers = [];
  mb.mapRemove.mockReset();
  mb.bounds = undefined;
  mb.sourceKind = 'geojson';
  mb.throwOnConstruct = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('MarketplaceMap — fallback panel', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', '');
  });

  it('counts only listings with a real pickup point (plural)', () => {
    render(
      <MarketplaceMap
        listings={[
          makeListing({ id: 'a' }),
          makeListing({ id: 'b' }),
          makeListing({ id: 'no-coords', pickup_lat: null, pickup_lng: null }),
          // (0,0) is the legacy "not geocoded" placeholder, not a real place.
          makeListing({ id: 'null-island', pickup_lat: 0, pickup_lng: 0 }),
        ]}
      />,
    );
    expect(screen.getByText('2 listings with location data')).toBeInTheDocument();
    expect(screen.getByText(/Interactive map is not available right now/)).toBeInTheDocument();
    expect(mb.mapOptions).toHaveLength(0);
  });

  it('uses the singular for exactly one', () => {
    render(<MarketplaceMap listings={[makeListing()]} />);
    expect(screen.getByText('1 listing with location data')).toBeInTheDocument();
  });

  it('counts a listing on the equator or prime meridian as located', () => {
    render(
      <MarketplaceMap
        listings={[
          makeListing({ id: 'equator', pickup_lat: 0, pickup_lng: 12.5 }),
          makeListing({ id: 'no-lng', pickup_lat: 12.5, pickup_lng: null }),
        ]}
      />,
    );
    expect(screen.getByText('1 listing with location data')).toBeInTheDocument();
  });

  it('says so when no listing has location data', () => {
    render(
      <MarketplaceMap listings={[makeListing({ pickup_lat: null, pickup_lng: null })]} className="h-96" />,
    );
    expect(screen.getByText('No listings with location data available')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-map-fallback')).toHaveClass('h-96');
  });
});

describe('MarketplaceMap — initial view', () => {
  it('centres on the average of the located listings at zoom 10', async () => {
    render(
      <MarketplaceMap
        listings={[
          makeListing({ id: 'a', pickup_lat: 30, pickup_lng: -98 }),
          makeListing({ id: 'b', pickup_lat: 32, pickup_lng: -96 }),
          makeListing({ id: 'skip', pickup_lat: 0, pickup_lng: 0 }),
        ]}
      />,
    );
    await waitForMap();
    expect(mapOptions().center).toEqual([-97, 31]);
    expect(mapOptions().zoom).toBe(10);
    expect(mb.controls.map((c) => c.position)).toEqual(['top-right']);
  });

  it('falls back to Austin when nothing can be plotted', async () => {
    render(<MarketplaceMap listings={[]} />);
    await waitForMap();
    expect(mapOptions().center).toEqual([-97.7431, 30.2672]);
  });

  it('prefers the explicit centre and zoom over the derived ones', async () => {
    render(
      <MarketplaceMap listings={[makeListing()]} initialCenter={[-122.4, 37.8]} initialZoom={13} />,
    );
    await waitForMap();
    expect(mapOptions().center).toEqual([-122.4, 37.8]);
    expect(mapOptions().zoom).toBe(13);
  });

  it('renders the labelled map surface while the map is healthy', async () => {
    render(<MarketplaceMap listings={[makeListing()]} className="h-96" />);
    await waitForMap();
    expect(screen.getByRole('application', { name: 'Marketplace listings map' })).toBe(
      mapOptions().container,
    );
    expect(screen.getByTestId('marketplace-map')).toHaveClass('h-96');
  });
});

describe('MarketplaceMap — once the style has loaded', () => {
  it('registers a clustered source and the three layers', async () => {
    await renderLoaded([makeListing()]);
    expect(mb.sources).toEqual([
      {
        id: 'listings',
        spec: {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
        },
      },
    ]);
    expect(mb.layers).toEqual([
      { id: 'clusters', type: 'circle' },
      { id: 'cluster-count', type: 'symbol' },
      { id: 'unclustered-dot', type: 'circle' },
    ]);
  });

  it('feeds the source one [lng, lat] feature per plottable listing', async () => {
    await renderLoaded([
      makeListing({ id: 'a', title: 'Oak table', current_bid_cents: 4500 }),
      makeListing({ id: 'skip', pickup_lat: null, pickup_lng: null }),
    ]);
    expect(lastSetData()).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-97.74, 30.27] },
          properties: { id: 'a', title: 'Oak table', price: 4500 },
        },
      ],
    });
  });

  it('draws a price chip per listing, labelled with title and formatted price', async () => {
    await renderLoaded([
      makeListing({ id: 'a', title: 'Oak table', current_bid_cents: 4500 }),
      makeListing({ id: 'b', title: 'Road bike', current_bid_cents: 123456, pickup_lat: 31, pickup_lng: -98 }),
    ]);
    const [a, b] = markers();
    expect(a?.el.tagName).toBe('BUTTON');
    expect(a?.el).toHaveTextContent('$45.00');
    expect(a?.el).toHaveAttribute('aria-label', 'Oak table — $45.00');
    expect(a?.el).toHaveAttribute('data-listing-id', 'a');
    expect(a?.lngLat).toEqual([-97.74, 30.27]);
    expect(b?.el).toHaveTextContent('$1,234.56');
    expect(b?.lngLat).toEqual([-98, 31]);
    expect(a?.addedTo).toBeDefined();
  });

  it('puts the cover photo in the popup when the listing has one', async () => {
    await renderLoaded([
      makeListing({
        title: 'Oak table',
        photos: [
          { id: 'p1', url: 'https://cdn.test/cover.jpg', sort_order: 0 },
          { id: 'p2', url: 'https://cdn.test/second.jpg', sort_order: 1 },
        ] as Listing['photos'],
      }),
    ]);
    const img = markers()[0]?.popupContent?.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://cdn.test/cover.jpg');
    expect(img).toHaveAttribute('alt', 'Oak table');
  });

  it('omits the image when the listing has no photos', async () => {
    await renderLoaded([makeListing({ photos: [] })]);
    expect(markers()[0]?.popupContent?.querySelector('img')).toBeNull();
  });

  it.each([
    ['hours when more than an hour remains', 2 * 3_600_000 + 59 * 60_000, '2h left'],
    ['"1h left" at exactly one hour', 3_600_000, '1h left'],
    ['minutes under an hour', 59 * 60_000 + 59_000, '59m left'],
    ['at least "1m left" in the final seconds', 20_000, '1m left'],
    ['"Ended" at the closing instant', 0, 'Ended'],
    ['"Ended" after close', -60_000, 'Ended'],
  ])('popup shows %s', async (_label, endsInMs, expected) => {
    await renderLoaded([
      makeListing({ auction_ends_at: new Date(NOW + endsInMs).toISOString() }),
    ]);
    expect(popupLines(markers()[0])).toEqual(['Oak table', 'Current bid: $45.00', expected]);
  });

  it('leaves the time line out when the listing has no end time', async () => {
    await renderLoaded([makeListing({ auction_ends_at: null })]);
    expect(popupLines(markers()[0])).toEqual(['Oak table', 'Current bid: $45.00']);
  });

  it('reports the clicked listing and keeps the click from reaching the map', async () => {
    const onListingSelect = vi.fn<(listing: Listing) => void>();
    const target = makeListing({ id: 'b', pickup_lat: 31, pickup_lng: -98 });
    await renderLoaded([makeListing({ id: 'a' }), target], { onListingSelect });
    const chip = markers()[1]?.el;
    if (!chip) throw new Error('expected a second marker');
    const outer = vi.fn();
    document.body.appendChild(chip);
    document.body.addEventListener('click', outer);
    try {
      chip.click();
    } finally {
      document.body.removeEventListener('click', outer);
      chip.remove();
    }
    expect(onListingSelect).toHaveBeenCalledTimes(1);
    expect(onListingSelect).toHaveBeenCalledWith(target);
    expect(outer).not.toHaveBeenCalled();
  });

  it('a chip click without a select handler is harmless', async () => {
    await renderLoaded([makeListing()]);
    expect(() => {
      markers()[0]?.el.click();
    }).not.toThrow();
  });

  it('replaces the markers and the source data when the listings change', async () => {
    const first = makeListing({ id: 'a' });
    const view = await renderLoaded([first]);
    const oldMarker = markers()[0];
    view.rerender(
      <MarketplaceMap
        listings={[
          makeListing({ id: 'b', title: 'Road bike', pickup_lat: 31, pickup_lng: -98 }),
          makeListing({ id: 'c', title: 'Lamp', pickup_lat: 32, pickup_lng: -99 }),
        ]}
      />,
    );
    await waitFor(() => {
      expect(markers()).toHaveLength(3);
    });
    expect(oldMarker?.remove).toHaveBeenCalledTimes(1);
    expect(lastSetData().features.map((f) => f.properties.id)).toEqual(['b', 'c']);
    // Still the one map instance — listings changes never rebuild it.
    expect(mb.mapOptions).toHaveLength(1);
  });

  it('still draws markers when the cluster source is missing or not GeoJSON', async () => {
    mb.sourceKind = 'missing';
    await renderLoaded([makeListing()]);
    expect(mb.setData).toHaveLength(0);
    expect(markers()).toHaveLength(1);
  });

  it('does not push data into a non-GeoJSON source', async () => {
    mb.sourceKind = 'other';
    await renderLoaded([makeListing()]);
    expect(mb.setData).toHaveLength(0);
  });
});

describe('MarketplaceMap — viewport changes', () => {
  it('reports the visible bounds after the map stops moving', async () => {
    const onViewportChange = vi.fn<(bounds: MapBounds) => void>();
    mb.bounds = {
      getNorth: () => 30.5,
      getSouth: () => 30.1,
      getEast: () => -97.5,
      getWest: () => -98.0,
    };
    render(<MarketplaceMap listings={[makeListing()]} onViewportChange={onViewportChange} />);
    await waitForMap();
    fire('moveend');
    expect(onViewportChange).toHaveBeenCalledWith({
      north: 30.5,
      south: 30.1,
      east: -97.5,
      west: -98.0,
    });
  });

  it('reports nothing while the map has no bounds yet', async () => {
    const onViewportChange = vi.fn<(bounds: MapBounds) => void>();
    mb.bounds = null;
    render(<MarketplaceMap listings={[makeListing()]} onViewportChange={onViewportChange} />);
    await waitForMap();
    fire('moveend');
    expect(onViewportChange).not.toHaveBeenCalled();
  });

  it('tolerates a move with no viewport handler', async () => {
    render(<MarketplaceMap listings={[makeListing()]} />);
    await waitForMap();
    expect(() => {
      fire('moveend');
    }).not.toThrow();
  });
});

describe('MarketplaceMap — errors and teardown', () => {
  it('swaps in the fallback when the map errors before it ever loaded', async () => {
    render(<MarketplaceMap listings={[makeListing()]} />);
    await waitForMap();
    fire('error');
    expect(screen.getByTestId('marketplace-map-fallback')).toBeInTheDocument();
    expect(screen.getByText('1 listing with location data')).toBeInTheDocument();
  });

  it('keeps a working map on screen when an error arrives after load', async () => {
    await renderLoaded([makeListing()]);
    fire('error');
    expect(screen.getByTestId('marketplace-map')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-map-fallback')).toBeNull();
  });

  it('swaps in the fallback when the map cannot be constructed', async () => {
    mb.throwOnConstruct = true;
    render(<MarketplaceMap listings={[makeListing()]} />);
    expect(await screen.findByTestId('marketplace-map-fallback')).toBeInTheDocument();
  });

  it('removes the map and its markers on unmount', async () => {
    const view = await renderLoaded([makeListing()]);
    const marker = markers()[0];
    view.unmount();
    expect(mb.mapRemove).toHaveBeenCalledTimes(1);
    expect(marker?.remove).toHaveBeenCalledTimes(1);
  });

  it('ignores map events that arrive after unmount', async () => {
    const view = render(<MarketplaceMap listings={[makeListing()]} />);
    await waitForMap();
    view.unmount();
    fire('load');
    fire('error');
    expect(mb.sources).toHaveLength(0);
    expect(mb.layers).toHaveLength(0);
  });

  it('never builds a map if it is unmounted before mapbox finishes loading', async () => {
    const view = render(<MarketplaceMap listings={[makeListing()]} />);
    view.unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mb.mapOptions).toHaveLength(0);
  });
});
