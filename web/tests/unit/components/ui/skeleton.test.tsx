import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from '@/components/ui/skeleton';

describe('Skeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).not.toBeNull();
  });

  it('forwards className', () => {
    const { container } = render(<Skeleton className="my-skel" />);
    expect((container.firstChild as HTMLElement).className).toContain('my-skel');
  });

  it('applies width and height as inline style', () => {
    const { container } = render(<Skeleton width={120} height={32} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('32px');
  });

  it('supports the circular variant', () => {
    const { container } = render(<Skeleton variant="circular" />);
    expect((container.firstChild as HTMLElement).className).toContain('rounded-full');
  });

  it('supports the text variant (rounded h-4)', () => {
    const { container } = render(<Skeleton variant="text" />);
    expect((container.firstChild as HTMLElement).className).toContain('h-4');
  });

  it('supports the card variant (rounded-xl)', () => {
    const { container } = render(<Skeleton variant="card" />);
    expect((container.firstChild as HTMLElement).className).toContain('rounded-xl');
  });

  it('supports the price variant (tabular-nums)', () => {
    const { container } = render(<Skeleton variant="price" />);
    expect((container.firstChild as HTMLElement).className).toContain('tabular-nums');
  });

  it('uses the default variant (rounded-md) when variant prop is omitted', () => {
    const { container } = render(<Skeleton />);
    expect((container.firstChild as HTMLElement).className).toContain('rounded-md');
  });

  it('accepts width as a CSS string (e.g. "50%")', () => {
    const { container } = render(<Skeleton width="50%" />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe('50%');
  });

  it('accepts height as a CSS string (e.g. "2rem")', () => {
    const { container } = render(<Skeleton height="2rem" />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.height).toBe('2rem');
  });

  it('does not set width/height when both are omitted', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe('');
    expect(el.style.height).toBe('');
  });

  it('merges incoming inline style with the computed sizeStyle', () => {
    const { container } = render(<Skeleton style={{ opacity: 0.5 }} width={64} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.opacity).toBe('0.5');
    expect(el.style.width).toBe('64px');
  });

  it('passes through extra HTML props (data-* attributes)', () => {
    const { container } = render(<Skeleton data-testid="skel" />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute('data-testid')).toBe('skel');
  });
});
