import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

import { Logo } from '@/components/layout/Logo';

describe('Logo', () => {
  it('renders as a link by default pointing at /', () => {
    render(<Logo />);
    const link = screen.getByLabelText('NoMarkup Home');
    expect(link.getAttribute('href')).toBe('/');
  });

  it('renders without a link when asLink is false', () => {
    const { container } = render(<Logo asLink={false} />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders the brand text', () => {
    render(<Logo />);
    expect(screen.getByText('No')).toBeDefined();
    expect(screen.getByText('Markup')).toBeDefined();
  });

  it('applies the custom className', () => {
    const { container } = render(<Logo asLink={false} className="extra-logo" />);
    const root = container.firstElementChild;
    expect(root?.className).toContain('extra-logo');
  });

  it('honors the size prop', () => {
    const { container } = render(<Logo asLink={false} size="lg" />);
    const root = container.firstElementChild;
    expect(root?.className).toContain('text-3xl');
  });

  it('renders the SpringBoard app-icon tile', () => {
    const { container } = render(<Logo asLink={false} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/icons/icon-192.png');
  });

  it('supports a custom href and aria label', () => {
    render(<Logo href="/dashboard" ariaLabel="Go to Dashboard" />);
    const link = screen.getByLabelText('Go to Dashboard');
    expect(link.getAttribute('href')).toBe('/dashboard');
  });

  it('can hide the app-icon tile', () => {
    const { container } = render(<Logo asLink={false} showMark={false} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
