import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { Slider } from '@/components/ui/slider';

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

describe('Slider', () => {
  it('renders a slider control', () => {
    render(<Slider defaultValue={[25]} max={100} />);
    expect(screen.getByRole('slider')).toBeDefined();
  });

  it('exposes the current value via aria-valuenow', () => {
    render(<Slider defaultValue={[75]} max={100} />);
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('75');
  });

  it('forwards className', () => {
    const { container } = render(
      <Slider defaultValue={[10]} max={100} className="my-slider" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-slider');
  });

  it('exposes a min 44px hit target on root and thumb (FE-07)', () => {
    const { container } = render(<Slider defaultValue={[40]} max={100} />);
    const root = container.firstChild as HTMLElement;
    const thumb = screen.getByRole('slider');
    expect(root.className).toMatch(/min-h-11/);
    expect(thumb.className).toMatch(/h-11/);
    expect(thumb.className).toMatch(/w-11/);
  });
});
