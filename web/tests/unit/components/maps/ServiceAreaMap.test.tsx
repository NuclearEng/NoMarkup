import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ServiceAreaMap } from '@/components/maps/ServiceAreaMap';

vi.mock('mapbox-gl', () => {
  const Map = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(),
    fitBounds: vi.fn(),
  }));
  return {
    default: { Map, accessToken: '' },
  };
});

vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

describe('ServiceAreaMap', () => {
  it('renders nothing when no Mapbox token is configured', () => {
    const original = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

    const { container } = render(<ServiceAreaMap radiusKm={10} />);
    expect(container.firstChild).toBeNull();

    if (original !== undefined) process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = original;
  });

  it('renders the map container with role="application" when token is set', () => {
    const original = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test.token';

    const { container } = render(
      <ServiceAreaMap radiusKm={25} center={[-122.4194, 37.7749]} className="my-area" />,
    );
    const region = container.querySelector('[aria-label="Service area map"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('role')).toBe('application');
    expect(region?.className).toContain('my-area');

    if (original === undefined) {
      delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    } else {
      process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = original;
    }
  });

  it('uses the default center when none is provided', () => {
    const original = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test.token';

    expect(() => render(<ServiceAreaMap radiusKm={5} />)).not.toThrow();

    if (original === undefined) {
      delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    } else {
      process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = original;
    }
  });
});
