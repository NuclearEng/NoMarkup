import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import {
  DirectionsButton,
  canOfferDirections,
  directionsUrl,
  formatExactAddress,
  formatLatLng,
  isDirectionsReady,
} from '@/components/maps/DirectionsButton';

describe('Directions helpers', () => {
  it('formats exact address and knows when it is directions-ready', () => {
    expect(
      formatExactAddress({ street: '1 Main', city: 'Austin', state: 'TX', zip_code: '78701' }),
    ).toBe('1 Main, Austin, TX, 78701');
    expect(formatExactAddress({})).toBeNull();
    expect(isDirectionsReady({ street: '1 Main' })).toBe(true);
    expect(isDirectionsReady({ city: 'Austin', state: 'TX' })).toBe(true);
    expect(isDirectionsReady({ city: 'Austin' })).toBe(false);
    expect(canOfferDirections('123 Main St')).toBe(true);
    expect(canOfferDirections('ab')).toBe(false);
    expect(formatLatLng(30.2, -97.7)).toBe('30.2,-97.7');
    expect(formatLatLng(null, -97.7)).toBeNull();
  });

  it('builds a maps directions URL', () => {
    const url = directionsUrl('123 Main St, Austin, TX');
    expect(url).toBeTruthy();
    expect(url).toMatch(/maps\.apple\.com|google\.com\/maps/);
    expect(url).toContain(encodeURIComponent('123 Main St, Austin, TX'));
  });
});

describe('DirectionsButton', () => {
  it('renders a 44px Get Directions control', () => {
    render(createElement(DirectionsButton, { address: '123 Main St, Austin, TX' }));
    const link = screen.getByRole('link', { name: /Get Directions/i });
    expect(link.getAttribute('href')).toMatch(/maps\.apple\.com|google\.com\/maps/);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.className).toMatch(/min-h-\[44px\]/);
  });

  it('renders nothing for an empty address', () => {
    const { container } = render(createElement(DirectionsButton, { address: '  ' }));
    expect(container.querySelector('a')).toBeNull();
  });
});
