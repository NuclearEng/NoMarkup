import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const usePricingOverviewMock = vi.fn<() => unknown>();
vi.mock('@/hooks/usePricing', () => ({
  usePricingOverview: (): unknown => usePricingOverviewMock(),
}));

const ORIGINAL_TOKEN = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

beforeEach(() => {
  vi.clearAllMocks();
  // The component captures process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] at module
  // load time, so it stays undefined for the entire test run. We exercise the
  // graceful no-token branches here (placeholder + className forwarding) and
  // exercise the data-fetching branches via the hook mock.
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

describe('PriceHeatMap', () => {
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

  // ---- DEEPENING ----

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

  it('still rejects mapbox-gl import without crashing when categorySlug filters to zero results', () => {
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
    // No "undefined" string should leak into the DOM
    expect(container.innerHTML).not.toContain('undefined');
  });
});
