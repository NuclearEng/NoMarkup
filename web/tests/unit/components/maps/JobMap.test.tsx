import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { JobMap } from '@/components/maps/JobMap';
import type { Job } from '@/types';

// Mock the dynamic mapbox-gl import — JobMap imports it via `await import('mapbox-gl')`
vi.mock('mapbox-gl', () => {
  const Map = vi.fn().mockImplementation(() => ({
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
  }));
  const Marker = vi.fn(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    setPopup: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
  }));
  const Popup = vi.fn(() => ({
    setDOMContent: vi.fn().mockReturnThis(),
  }));
  const NavigationControl = vi.fn();
  const LngLatBounds = vi.fn(() => ({
    extend: vi.fn(),
  }));
  return {
    default: { Map, Marker, Popup, NavigationControl, LngLatBounds, accessToken: '' },
  };
});

// Avoid CSS import errors in jsdom
vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

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

describe('JobMap', () => {
  it('renders the fallback list when no Mapbox token is set', () => {
    const original = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

    render(<JobMap jobs={[makeJob()]} />);
    expect(screen.getByText('Fix kitchen sink')).toBeDefined();
    expect(screen.getByText('123 Main St')).toBeDefined();

    if (original !== undefined) process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = original;
  });

  it('shows "no jobs with location" message when jobs lack coordinates', () => {
    const original = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

    render(
      <JobMap jobs={[makeJob({ location_lat: null, location_lng: null })]} />,
    );
    expect(screen.getByText(/No jobs with location data available/i)).toBeDefined();

    if (original !== undefined) process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = original;
  });

  it('invokes onJobSelect when a fallback row is clicked', async () => {
    const original = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

    const onSelect = vi.fn();
    render(<JobMap jobs={[makeJob()]} onJobSelect={onSelect} />);
    await userEvent.click(screen.getByText('Fix kitchen sink'));
    expect(onSelect).toHaveBeenCalledTimes(1);

    if (original !== undefined) process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = original;
  });

  it('renders the map container with accessibility attributes when token is set', () => {
    const original = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = 'pk.test.token';

    const { container } = render(<JobMap jobs={[]} className="custom-map" />);
    const region = container.querySelector('[aria-label="Job locations map"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('role')).toBe('application');

    if (original === undefined) {
      delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    } else {
      process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = original;
    }
  });

  it('shows bid count badges in the fallback list', () => {
    const original = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

    render(<JobMap jobs={[makeJob({ bid_count: 5 })]} />);
    expect(screen.getByText('5 bids')).toBeDefined();

    if (original !== undefined) process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] = original;
  });
});
