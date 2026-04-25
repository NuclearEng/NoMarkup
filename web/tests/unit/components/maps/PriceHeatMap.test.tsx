import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PriceHeatMap } from '@/components/maps/PriceHeatMap';

vi.mock('mapbox-gl', () => {
  const Map = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    addControl: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(),
  }));
  const NavigationControl = vi.fn();
  return {
    default: { Map, NavigationControl, accessToken: '' },
  };
});

vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

vi.mock('@/hooks/usePricing', () => ({
  usePricingOverview: vi.fn(() => ({
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
  })),
}));

describe('PriceHeatMap', () => {
  it('renders an unavailable placeholder when no token is configured', () => {
    const original = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

    // Re-import so MAPBOX_TOKEN is re-evaluated against the new env
    vi.resetModules();
    render(<PriceHeatMap />);
    expect(screen.getByText(/not available/i)).toBeDefined();

    if (original !== undefined) process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = original;
  });

  it('forwards className when no token is set', () => {
    const original = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

    const { container } = render(<PriceHeatMap className="extra-heat" />);
    expect(container.querySelector('.extra-heat')).not.toBeNull();

    if (original !== undefined) process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = original;
  });

  it('accepts a categorySlug prop without crashing', () => {
    const original = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

    expect(() =>
      render(<PriceHeatMap categorySlug="plumbing" className="x" />),
    ).not.toThrow();

    if (original !== undefined) process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = original;
  });
});
