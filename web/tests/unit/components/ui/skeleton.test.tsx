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
});
