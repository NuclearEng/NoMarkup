import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PriceHeatMap } from '@/components/maps/PriceHeatMap';

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
} = {
  handlers: {},
  on: vi.fn(),
  off: vi.fn(),
  remove: vi.fn(),
  addControl: vi.fn(),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  getSource: vi.fn(),
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

const usePricingOverviewMock = vi.fn<() => unknown>();
vi.mock('@/hooks/usePricing', () => ({
  usePricingOverview: (): unknown => usePricingOverviewMock(),
}));

const ORIGINAL_TOKEN = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

function resetMapInstance(): void {
  mapInstance.handlers = {};
  mapInstance.on.mockReset();
  mapInstance.off.mockReset();
  mapInstance.remove.mockReset();
  mapInstance.addControl.mockReset();
  mapInstance.addSource.mockReset();
  mapInstance.addLayer.mockReset();
  mapInstance.getSource.mockReset();

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
  // Vitest 4 constructs mock implementations with Reflect.construct, so the
  // `new mapboxgl.Map(...)` call needs a constructible `function` implementation.
  MapMock.mockImplementation(function () {
    return mapInstance;
  });
  NavigationControlMock.mockReset();

  delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

  usePricingOverviewMock.mockReturnValue({
    data: {
      categories: [
        {
          category_name: 'Plumbing',
          category_slug: 'plumbing',
          total_jobs: 12,
          avg_median_cents: 25000,
          avg_savings_cents: 5000,
        },
        {
          category_name: 'Electrical',
          category_slug: 'electrical',
          total_jobs: 8,
          avg_median_cents: 30000,
          avg_savings_cents: null,
        },
      ],
    },
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
  it('renders an unavailable placeholder when no token is configured', () => {
    render(<PriceHeatMap />);
    expect(screen.getByText(/not available/i)).toBeDefined();
  });

  it('forwards className when no token is set', () => {
    const { container } = render(<PriceHeatMap className="extra-heat" />);
    expect(container.querySelector('.extra-heat')).not.toBeNull();
  });

  it('accepts a categorySlug prop without crashing', () => {
    expect(() => render(<PriceHeatMap categorySlug="plumbing" className="x" />)).not.toThrow();
  });

  it('uses muted background styling on the placeholder', () => {
    const { container } = render(<PriceHeatMap />);
    const placeholder = container.querySelector('.bg-muted');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.classList.contains('rounded-lg')).toBe(true);
    expect(placeholder?.classList.contains('border')).toBe(true);
  });

  it('renders the placeholder when pricing data is still loading and no token set', () => {
    usePricingOverviewMock.mockReturnValue({ data: undefined, isLoading: true });
    render(<PriceHeatMap />);
    expect(screen.getByText(/not available/i)).toBeDefined();
  });

  it('handles empty pricing data without crashing', () => {
    usePricingOverviewMock.mockReturnValue({
      data: { categories: [] },
      isLoading: false,
    });
    expect(() => render(<PriceHeatMap />)).not.toThrow();
  });

  it('handles undefined data gracefully and still shows the placeholder', () => {
    usePricingOverviewMock.mockReturnValue({ data: undefined, isLoading: false });
    render(<PriceHeatMap categorySlug="electrical" />);
    expect(screen.getByText(/not available/i)).toBeDefined();
  });

  it('handles a categorySlug filter that yields zero results', () => {
    usePricingOverviewMock.mockReturnValue({
      data: {
        categories: [
          {
            category_name: 'Plumbing',
            category_slug: 'plumbing',
            total_jobs: 12,
            avg_median_cents: 25000,
            avg_savings_cents: 5000,
          },
        ],
      },
      isLoading: false,
    });
    expect(() => render(<PriceHeatMap categorySlug="nonexistent" />)).not.toThrow();
  });

  it('forwards className through to the unavailable placeholder text container', () => {
    const { container } = render(<PriceHeatMap className="custom-cls" />);
    const placeholder = container.querySelector('.custom-cls');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toMatch(/not available/i);
  });

  it('handles undefined className without producing trailing whitespace artefacts', () => {
    const { container } = render(<PriceHeatMap />);
    expect(container.innerHTML).not.toContain('undefined');
  });

  it('returns the same placeholder element when re-rendered with new props', () => {
    const { container, rerender } = render(<PriceHeatMap className="a" />);
    const first = container.querySelector('.bg-muted');
    rerender(<PriceHeatMap className="b" categorySlug="plumbing" />);
    const second = container.querySelector('.bg-muted');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.classList.contains('b')).toBe(true);
  });

  it('still renders a placeholder when the hook returns categories with null savings', () => {
    usePricingOverviewMock.mockReturnValue({
      data: {
        categories: [
          {
            category_name: 'Roofing',
            category_slug: 'roof',
            total_jobs: 0,
            avg_median_cents: 0,
            avg_savings_cents: null,
          },
        ],
      },
      isLoading: false,
    });
    render(<PriceHeatMap categorySlug="roof" />);
    expect(screen.getByText(/not available/i)).toBeDefined();
  });

  it('does not invoke usePricingOverview hook with arguments', () => {
    render(<PriceHeatMap />);
    expect(usePricingOverviewMock).toHaveBeenCalled();
    expect(usePricingOverviewMock.mock.calls[0]).toEqual([]);
  });

  it('renders placeholder content as a text element accessible via role=paragraph fallback', () => {
    render(<PriceHeatMap />);
    const text = screen.getByText(/Category price comparison is not available/i);
    expect(text.tagName.toLowerCase()).toBe('p');
  });
});

describe('PriceHeatMap — token-set / map render branch', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders the map container with role=application when token is set', () => {
    const { container } = render(<PriceHeatMap className="hot" />);
    const region = container.querySelector('[aria-label="Illustrative category price comparison"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('role')).toBe('application');
  });

  it('shows a Skeleton while the map is loading', () => {
    const { container } = render(<PriceHeatMap />);
    // Skeleton uses bg-muted + overflow-hidden + relative
    const skeleton = container.querySelector('.bg-muted.overflow-hidden');
    expect(skeleton).not.toBeNull();
  });

  it('constructs the Mapbox Map with the correct container, style, center, and zoom', async () => {
    render(<PriceHeatMap />);
    await waitFor(() => {
      expect(MapMock).toHaveBeenCalled();
    });
    const callArgs = MapMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArgs?.['style']).toBe('mapbox://styles/mapbox/light-v11');
    expect(callArgs?.['center']).toEqual([-98.5795, 39.8283]);
    expect(callArgs?.['zoom']).toBe(3);
    expect(callArgs?.['container']).toBeInstanceOf(HTMLElement);
  });

  it('attaches a NavigationControl after constructing the map', async () => {
    render(<PriceHeatMap />);
    await waitFor(() => {
      expect(mapInstance.addControl).toHaveBeenCalled();
    });
    const placement = mapInstance.addControl.mock.calls[0]?.[1] as string | undefined;
    expect(placement).toBe('top-right');
    expect(NavigationControlMock).toHaveBeenCalled();
  });

  it('registers load and error event handlers on the map', async () => {
    render(<PriceHeatMap />);
    await waitFor(() => {
      expect(mapInstance.on).toHaveBeenCalled();
    });
    const events = mapInstance.on.mock.calls.map((c) => c[0] as string);
    expect(events).toContain('load');
    expect(events).toContain('error');
  });

  it('adds the heatmap source and layer on map load', async () => {
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
    expect(mapInstance.addLayer).toHaveBeenCalled();
    const layer = mapInstance.addLayer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(layer['id']).toBe('pricing-heat');
    expect(layer['type']).toBe('heatmap');
    expect(layer['source']).toBe('pricing');
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

  it('builds a deterministic geojson with one feature per category', async () => {
    render(<PriceHeatMap />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    mapInstance.getSource.mockReturnValue(undefined);
    act(() => {
      mapInstance.handlers.load?.();
    });
    await waitFor(() => {
      expect(mapInstance.addSource).toHaveBeenCalled();
    });
    const source = mapInstance.addSource.mock.calls[0]?.[1] as {
      data: GeoJSON.FeatureCollection;
    };
    expect(source.data.features.length).toBe(2);
    const props0 = source.data.features[0]?.properties as Record<string, unknown>;
    expect(props0['category']).toBe('Plumbing');
    expect(props0['median_price']).toBe(250); // 25000 cents -> 250 dollars
    expect(props0['jobs']).toBe(12);
  });

  it('filters categories by categorySlug when provided', async () => {
    render(<PriceHeatMap categorySlug="electrical" />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    mapInstance.getSource.mockReturnValue(undefined);
    act(() => {
      mapInstance.handlers.load?.();
    });
    await waitFor(() => {
      expect(mapInstance.addSource).toHaveBeenCalled();
    });
    const source = mapInstance.addSource.mock.calls[0]?.[1] as {
      data: GeoJSON.FeatureCollection;
    };
    expect(source.data.features.length).toBe(1);
    const props0 = source.data.features[0]?.properties as Record<string, unknown>;
    expect(props0['category']).toBe('Electrical');
  });

  it('does not add layers when categories are empty after filtering', async () => {
    render(<PriceHeatMap categorySlug="nonexistent" />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    // No addSource call because categories.length === 0 short-circuits the effect
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
    usePricingOverviewMock.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<PriceHeatMap />);
    const skeleton = container.querySelector('.bg-muted.overflow-hidden');
    expect(skeleton).not.toBeNull();
  });
});
