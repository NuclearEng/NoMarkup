import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceAreaMap } from '@/components/maps/ServiceAreaMap';

interface MockHandlers {
  load?: () => void;
  error?: () => void;
}

const mapInstance: {
  handlers: MockHandlers;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  addSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
} = {
  handlers: {},
  on: vi.fn(),
  off: vi.fn(),
  remove: vi.fn(),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  getSource: vi.fn(),
  fitBounds: vi.fn(),
};

const MapMock = vi.fn();

vi.mock('mapbox-gl', () => {
  return {
    default: { Map: MapMock, accessToken: '' },
  };
});

vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

const ORIGINAL_TOKEN = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

function resetMapInstance(): void {
  mapInstance.handlers = {};
  mapInstance.on.mockReset();
  mapInstance.off.mockReset();
  mapInstance.remove.mockReset();
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

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  resetMapInstance();
  MapMock.mockReset();
  // Vitest 4 constructs mock implementations with Reflect.construct, so the
  // `new mapboxgl.Map(...)` call needs a constructible `function` implementation.
  MapMock.mockImplementation(function () {
    return mapInstance;
  });
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
  } else {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = ORIGINAL_TOKEN;
  }
});

describe('ServiceAreaMap — no token branch', () => {
  it('renders nothing when no Mapbox token is configured', () => {
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

    const { container } = render(<ServiceAreaMap radiusKm={10} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for very small radius values when token unset', () => {
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

    const { container } = render(<ServiceAreaMap radiusKm={0.5} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for very large radius values when token unset', () => {
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

    const { container } = render(<ServiceAreaMap radiusKm={500} center={[0, 0]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ServiceAreaMap — token-set / map render branch', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders the map container with role="application" when token is set', () => {
    const { container } = render(
      <ServiceAreaMap radiusKm={25} center={[-122.4194, 37.7749]} className="my-area" />,
    );
    const region = container.querySelector('[aria-label="Service area map"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('role')).toBe('application');
    expect(region?.className).toContain('my-area');
  });

  it('uses the default center when none is provided', () => {
    expect(() => render(<ServiceAreaMap radiusKm={5} />)).not.toThrow();
  });

  it('applies the default min-h-[250px] container styling when no className is provided', () => {
    const { container } = render(<ServiceAreaMap radiusKm={50} />);
    const region = container.querySelector('[aria-label="Service area map"]');
    expect(region).not.toBeNull();
    expect(region?.className).toContain('min-h-[250px]');
    expect(region?.className).toContain('rounded-md');
    expect(region?.className).toContain('border');
  });

  it('does not include "undefined" leakage in className when no className passed', () => {
    const { container } = render(<ServiceAreaMap radiusKm={5} />);
    expect(container.innerHTML).not.toContain('undefined');
  });

  it('updates without crashing when radiusKm prop changes', () => {
    const { rerender } = render(<ServiceAreaMap radiusKm={10} />);
    expect(() => {
      rerender(<ServiceAreaMap radiusKm={50} />);
    }).not.toThrow();
    expect(() => {
      rerender(<ServiceAreaMap radiusKm={100} />);
    }).not.toThrow();
  });

  it('updates without crashing when center prop changes', () => {
    const { rerender } = render(<ServiceAreaMap radiusKm={10} center={[0, 0]} />);
    expect(() => {
      rerender(<ServiceAreaMap radiusKm={10} center={[-122.4, 37.7]} />);
    }).not.toThrow();
  });

  it('cleans up and unmounts without throwing', () => {
    const { unmount } = render(<ServiceAreaMap radiusKm={20} />);
    expect(() => {
      unmount();
    }).not.toThrow();
  });

  it('applies a user-supplied className alongside the defaults', () => {
    const { container } = render(<ServiceAreaMap radiusKm={15} className="custom-area-cls" />);
    const region = container.querySelector('[aria-label="Service area map"]');
    expect(region?.className).toContain('custom-area-cls');
    expect(region?.className).toContain('min-h-[250px]');
  });

  // ---- Map construction branch coverage ----

  it('constructs the Mapbox Map with correct style, center, and zoom', async () => {
    render(<ServiceAreaMap radiusKm={25} center={[-122.4194, 37.7749]} />);
    await waitFor(() => {
      expect(MapMock).toHaveBeenCalled();
    });
    const opts = MapMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(opts?.['style']).toBe('mapbox://styles/mapbox/light-v11');
    expect(opts?.['center']).toEqual([-122.4194, 37.7749]);
    expect(opts?.['zoom']).toBe(8);
    expect(opts?.['container']).toBeInstanceOf(HTMLElement);
  });

  it('registers load and error event handlers on the map', async () => {
    render(<ServiceAreaMap radiusKm={20} />);
    await waitFor(() => {
      expect(mapInstance.on).toHaveBeenCalled();
    });
    const events = mapInstance.on.mock.calls.map((c) => c[0] as string);
    expect(events).toContain('load');
    expect(events).toContain('error');
  });

  it('adds the service-area source and two layers (fill + border) on map load', async () => {
    render(<ServiceAreaMap radiusKm={10} center={[-100, 40]} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });

    await waitFor(() => {
      expect(mapInstance.addSource).toHaveBeenCalledWith(
        'service-area',
        expect.objectContaining({ type: 'geojson' }),
      );
    });

    expect(mapInstance.addLayer).toHaveBeenCalledTimes(2);
    const layerIds = mapInstance.addLayer.mock.calls.map(
      (c) => (c[0] as { id: string }).id,
    );
    expect(layerIds).toEqual(expect.arrayContaining(['service-area-fill', 'service-area-border']));
  });

  it('builds a polygon geojson with 65 boundary points (64 segments + close)', async () => {
    render(<ServiceAreaMap radiusKm={10} center={[-100, 40]} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    await waitFor(() => {
      expect(mapInstance.addSource).toHaveBeenCalled();
    });

    const source = mapInstance.addSource.mock.calls[0]?.[1] as {
      data: GeoJSON.FeatureCollection;
    };
    const feat = source.data.features[0];
    expect(feat?.geometry.type).toBe('Polygon');
    const coords = (feat?.geometry as GeoJSON.Polygon).coordinates[0];
    expect(coords?.length).toBe(65);
  });

  it('calls fitBounds after adding the layer', async () => {
    render(<ServiceAreaMap radiusKm={20} center={[-100, 40]} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    await waitFor(() => {
      expect(mapInstance.fitBounds).toHaveBeenCalled();
    });
    const bounds = mapInstance.fitBounds.mock.calls[0]?.[0] as [number[], number[]];
    expect(bounds[0][0] ?? 0).toBeLessThan(bounds[1][0] ?? 0);
    expect(bounds[0][1] ?? 0).toBeLessThan(bounds[1][1] ?? 0);
  });

  it('updates the existing source data when radiusKm changes after map load', async () => {
    const { rerender } = render(<ServiceAreaMap radiusKm={10} center={[-100, 40]} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });

    const setData = vi.fn();
    mapInstance.getSource.mockReturnValue({ setData });

    rerender(<ServiceAreaMap radiusKm={50} center={[-100, 40]} />);

    await waitFor(() => {
      expect(setData).toHaveBeenCalled();
    });
    // fitBounds should be called again on re-render
    expect(mapInstance.fitBounds.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('still calls fitBounds when source does not exist on rerender', async () => {
    const { rerender } = render(<ServiceAreaMap radiusKm={10} center={[-100, 40]} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    mapInstance.fitBounds.mockClear();
    mapInstance.getSource.mockReturnValue(undefined);
    rerender(<ServiceAreaMap radiusKm={30} center={[-100, 40]} />);

    await waitFor(() => {
      expect(mapInstance.fitBounds).toHaveBeenCalled();
    });
  });

  it('renders nothing if the Mapbox map emits an error event', async () => {
    const { container } = render(<ServiceAreaMap radiusKm={10} />);
    await waitFor(() => {
      expect(mapInstance.handlers.error).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.error?.();
    });
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('cleans up the map on unmount by calling map.remove()', async () => {
    const { unmount } = render(<ServiceAreaMap radiusKm={10} />);
    await waitFor(() => {
      expect(mapInstance.handlers.load).toBeDefined();
    });
    act(() => {
      mapInstance.handlers.load?.();
    });
    unmount();
    expect(mapInstance.remove).toHaveBeenCalled();
  });
});
