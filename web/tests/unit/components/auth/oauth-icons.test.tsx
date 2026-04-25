import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { AppleIcon, GoogleIcon } from '@/components/auth/oauth-icons';

describe('OAuth icons', () => {
  it('renders GoogleIcon as an svg', () => {
    const { container } = render(createElement(GoogleIcon, { className: 'h-5 w-5' }));
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('class')).toContain('h-5');
    // GoogleIcon contains 4 colored paths (Google brand colors)
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(4);
  });

  it('renders AppleIcon as an svg', () => {
    const { container } = render(createElement(AppleIcon, { className: 'h-5 w-5' }));
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });
});
