import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppIcon } from '@/components/layout/AppIcon';

describe('AppIcon', () => {
  it('renders the iOS app-icon raster at the requested size', () => {
    const { container } = render(<AppIcon size="lg" alt="NoMarkup" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/icons/icon-192.png');
    expect(img?.getAttribute('width')).toBe('56');
    expect(img?.getAttribute('height')).toBe('56');
    expect(img?.getAttribute('alt')).toBe('NoMarkup');
    expect(img?.className).toContain('rounded-[22.5%]');
  });

  it('is decorative by default (empty alt)', () => {
    const { container } = render(<AppIcon />);
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  });
});
