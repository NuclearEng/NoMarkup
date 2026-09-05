import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PriceHeatMap } from '@/components/maps/PriceHeatMap';
import type { PricingHeatmapPoint } from '@/hooks/usePricing';

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
  getSource: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
} = {
  handlers: {},
  on: vi.fn(),
  off: vi.fn(),
  remove: vi.fn(),
  addControl: vi.fn(),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  getSource: vi.fn(),
  fitBounds: vi.fn(),
};

const MapMock = vi.fn();
const NavigationControlMock = vi.fn();

vi.mock('mapbox-gl', () => {
  return {
    default: {
      Map: MapMock,
      NavigationControl: NavigationControlMock,
      accessToken: '',
    },
  };
});

vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

const usePricingHeatmapMock = vi.fn<(slug?: string) => unknown>();
vi.mock('@/hooks/usePricing', () => ({
  usePricingHeatmap: (slug?: string): unknown => usePricingHeatmapMock(slug),
}));

const ORIGINAL_TOKEN = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

const seattle: PricingHeatmapPoint = {
  zip_code: '98103',
  lat: 47.67,
  lng: -122.34,
  median_price_cents: 18500,
  completed_jobs: 8,
};

const austin: PricingHeatmapPoint = {
  zip_code: '78701',
  lat: 30.2672,
  lng: -97.7431,
  median_price_cents: 22000,
  completed_jobs: 4,
};

function resetMapInstance(): void {
  mapInstance.handlers = {};
  mapInstance.on.mockReset();
  mapInstance.off.mockReset();
  mapInstance.remove.mockReset();
  mapInstance.addControl.mockReset();
  mapInstance.addSource.mockReset();
  mapInstance.addLayer.mockReset();
  mapInstance.getSource.mockReset();
  mapInstance.fitBounds.mockReset();

  mapInstance.on.mockImplementation((event: string, cb: () => void) => {
    if (event === 'load') mapInstance.handlers.load = cb;
    if (event === 'error') mapInstance.handlers.error = cb;
    return mapInstance;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMapInstance();
  MapMock.mockReset();
  MapMock.mockImplementation(function () {
    return mapInstance;
  });
  NavigationControlMock.mockReset();

  delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

  usePricingHeatmapMock.mockReturnValue({
    data: { points: [seattle, austin] },
    isLoading: false,
  });
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
  } else {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = ORIGINAL_TOKEN;
  }
});

describe('PriceHeatMap — no token branch', () => {
  it('renders the honest ZIP caption when no token is configured', () => {
    render(<PriceHeatMap />);
    expect(screen.getByText(/Completed jobs by ZIP \(where we have coordinates\)/i)).toBeDefined();
  });

  it('forwards className when no token is set', () => {
    const { container } = render(<PriceHeatMap className="extra-heat" />);
    expect(container.querySelector('.extra-heat')).not.toBeNull();
  });

  it('does not render a Live badge', () => {
    render(<PriceHeatMap />);
    expect(screen.queryByText(/^Live$/i)).toBeNull();
    expect(screen.queryByText(/live neighborhood/i)).toBeNull();
  });
});

describe('PriceHeatMap — empty points', () => {
  it('shows an empty state and does not construct a map', () => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.test');
    usePricingHeatmapMock.mockReturnValue({ data: { points: [] }, isLoading: false });
    render(<PriceHeatMap />);
    expect(screen.getByText(/No completed jobs with known ZIP coordinates/i)).toBeDefined();
    expect(MapMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('does not invent hash-offset coordinates when the list is empty', () => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.test');
    usePricingHeatmapMock.mockReturnValue({ data: { points: [] }, isLoading: false });
    const { container } = render(<PriceHeatMap />);
    expect(container.innerHTML).not.toContain('39.8283');
    expect(container.innerHTML).not.toContain('-98.5795');
    vi.unstubAllEnvs();
  });
});

describe('PriceHeatMap — token-set / real points', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('has no US-centroid or hash-offset constants in plotted coordinates', async () => {
    render(<PriceHeatMap />);
    await waitFor(() => {
      expect(MapMock).toHaveBeenCalled();
    });
    const callArgs = MapMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArgs?.['center']).toEqual([-122.34, 47.67]);
    expect(callArgs?.['center']).not.toEqual([-98.5795, 39.8283]);
  });

  it('renders the map container with the honest caption as the accessible name', async () => {
    render(<PriceHeatMap className="hot" />);
    await waitFor(() => {
      expect(MapMock).toHaveBeenCalled();
    });
    const region = screen.getByRole('application');
    expect(region.getAttribute('aria-label')).toMatch(/Completed jobs by ZIP/i);
  });

  it('adds the heatmap source from real ZIP points on map load', async () => {
    render(<PriceHeatMap />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    mapInstance.getSource.mockReturnValue(undefined);
    act(() => {
      mapInstance.handlers.load?.();
    });

    await waitFor(() => {
      expect(mapInstance.addSource).toHaveBeenCalledWith(
        'pricing',
        expect.objectContaining({ type: 'geojson' }),
      );
    });
    const source = mapInstance.addSource.mock.calls[0]?.[1] as {
      data: GeoJSON.FeatureCollection;
    };
    expect(source.data.features.length).toBe(2);
    const coords0 = source.data.features[0]?.geometry as GeoJSON.Point;
    expect(coords0.coordinates).toEqual([-122.34, 47.67]);
    const props0 = source.data.features[0]?.properties as Record<string, unknown>;
    expect(props0['zip_code']).toBe('98103');
    expect(props0['median_price']).toBe(185);
    expect(props0['jobs']).toBe(8);
  });

  it('passes the category slug through to the heatmap hook', () => {
    render(<PriceHeatMap categorySlug="electrical" />);
    expect(usePricingHeatmapMock).toHaveBeenCalledWith('electrical');
  });

  it('updates the existing source instead of re-adding when one already exists', async () => {
    render(<PriceHeatMap />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    const setData = vi.fn();
    mapInstance.getSource.mockReturnValue({ setData });
    act(() => {
      mapInstance.handlers.load?.();
    });

    await waitFor(() => {
      expect(setData).toHaveBeenCalled();
    });
    expect(mapInstance.addSource).not.toHaveBeenCalled();
  });

  it('shows the error placeholder if the Mapbox map emits an error event', async () => {
    render(<PriceHeatMap />);
    await waitFor(() => {
      expect(mapInstance.handlers.error).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.error?.();
    });
    await waitFor(() => {
      expect(screen.getByText(/Failed to load the map/i)).toBeDefined();
    });
  });

  it('cleans up the map on unmount by calling map.remove()', async () => {
    const { unmount } = render(<PriceHeatMap />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    unmount();
    expect(mapInstance.remove).toHaveBeenCalled();
  });

  it('shows a skeleton overlay while pricing data is loading', () => {
    usePricingHeatmapMock.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<PriceHeatMap />);
    const skeleton = container.querySelector('.bg-muted.overflow-hidden');
    expect(skeleton).not.toBeNull();
  });

  it('does not render a Live badge next to the map', async () => {
    const { container } = render(<PriceHeatMap />);
    expect(container.textContent).not.toMatch(/\bLive\b/);
  });
});
