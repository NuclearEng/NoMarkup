import { render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceAreaMap } from '@/components/maps/ServiceAreaMap';

const mapInstance = {
  on: vi.fn(),
  off: vi.fn(),
  remove: vi.fn(),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  getSource: vi.fn(),
  fitBounds: vi.fn(),
};

vi.mock('mapbox-gl', () => {
  const Map = vi.fn().mockImplementation(() => mapInstance);
  return {
    default: { Map, accessToken: '' },
  };
});

vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

const ORIGINAL_TOKEN = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

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
  for (const fn of Object.values(mapInstance)) {
    if (typeof fn === 'function') (fn as unknown as { mockClear?: () => void }).mockClear?.();
  }
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
  } else {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = ORIGINAL_TOKEN;
  }
});

describe('ServiceAreaMap', () => {
  it('renders nothing when no Mapbox token is configured', () => {
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

    const { container } = render(<ServiceAreaMap radiusKm={10} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the map container with role="application" when token is set', () => {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test.token';

    const { container } = render(
      <ServiceAreaMap radiusKm={25} center={[-122.4194, 37.7749]} className="my-area" />,
    );
    const region = container.querySelector('[aria-label="Service area map"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('role')).toBe('application');
    expect(region?.className).toContain('my-area');
  });

  it('uses the default center when none is provided', () => {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test.token';

    expect(() => render(<ServiceAreaMap radiusKm={5} />)).not.toThrow();
  });

  // ---- DEEPENING ----

  it('applies the default min-h-[250px] container styling when no className is provided', () => {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test.token';

    const { container } = render(<ServiceAreaMap radiusKm={50} />);
    const region = container.querySelector('[aria-label="Service area map"]');
    expect(region).not.toBeNull();
    expect(region?.className).toContain('min-h-[250px]');
    expect(region?.className).toContain('rounded-md');
    expect(region?.className).toContain('border');
  });

  it('does not include "undefined" leakage in className when no className passed', () => {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test.token';

    const { container } = render(<ServiceAreaMap radiusKm={5} />);
    expect(container.innerHTML).not.toContain('undefined');
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

  it('updates without crashing when radiusKm prop changes', () => {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test.token';

    const { rerender } = render(<ServiceAreaMap radiusKm={10} />);
    expect(() => {
      rerender(<ServiceAreaMap radiusKm={50} />);
    }).not.toThrow();
    expect(() => {
      rerender(<ServiceAreaMap radiusKm={100} />);
    }).not.toThrow();
  });

  it('updates without crashing when center prop changes', () => {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test.token';

    const { rerender } = render(<ServiceAreaMap radiusKm={10} center={[0, 0]} />);
    expect(() => {
      rerender(<ServiceAreaMap radiusKm={10} center={[-122.4, 37.7]} />);
    }).not.toThrow();
  });

  it('cleans up and unmounts without throwing', () => {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test.token';

    const { unmount } = render(<ServiceAreaMap radiusKm={20} />);
    expect(() => { unmount(); }).not.toThrow();
  });

  it('applies a user-supplied className alongside the defaults', () => {
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test.token';

    const { container } = render(
      <ServiceAreaMap radiusKm={15} className="custom-area-cls" />,
    );
    const region = container.querySelector('[aria-label="Service area map"]');
    expect(region?.className).toContain('custom-area-cls');
    expect(region?.className).toContain('min-h-[250px]');
  });
});
