import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { Sparkline } from '@/components/ui/sparkline';

beforeAll(() => {
  // jsdom does not implement getTotalLength on path elements; stub via Element prototype
  (Element.prototype as Element & { getTotalLength: () => number }).getTotalLength =
    function getTotalLength() {
      return 100;
    };
});

describe('Sparkline', () => {
  it('renders an SVG with role img', () => {
    render(<Sparkline data={[1, 2, 3, 4]} />);
    expect(screen.getByRole('img')).toBeDefined();
  });

  it('describes the trend in aria-label when going up', () => {
    render(<Sparkline data={[1, 2, 3]} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('upward');
  });

  it('describes the trend in aria-label when going down', () => {
    render(<Sparkline data={[5, 3, 1]} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('downward');
  });

  it('forwards className', () => {
    render(<Sparkline data={[1, 2]} className="my-spark" />);
    expect(screen.getByRole('img').getAttribute('class')).toContain('my-spark');
  });

  it('renders a path for the line', () => {
    const { container } = render(<Sparkline data={[1, 2, 3, 2, 4]} />);
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
  });

  it('skips the gradient-fill path when gradientFill is false', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} gradientFill={false} />);
    const paths = container.querySelectorAll('path');
    // Only the line path is rendered, not a fill path.
    expect(paths.length).toBe(1);
    // Defs still emit the linearGradient.
    expect(container.querySelector('linearGradient')).not.toBeNull();
  });

  it('skips the pulsing dot when showLastDot is false', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} showLastDot={false} />);
    expect(container.querySelector('circle')).toBeNull();
  });

  it('renders the pulsing dot at the last data point by default', () => {
    const { container } = render(<Sparkline data={[1, 4, 2]} />);
    expect(container.querySelector('circle')).not.toBeNull();
  });

  it('uses a caller-supplied color when provided (ignores default red/green)', () => {
    const { container } = render(<Sparkline data={[3, 1]} color="#abcdef" />);
    const path = container.querySelector('path[stroke]');
    expect(path?.getAttribute('stroke')).toBe('#abcdef');
  });

  it('falls back to safe data and renders without crashing for an empty array', () => {
    render(<Sparkline data={[]} />);
    // safeData becomes [0,0] → single horizontal line. role img still present.
    expect(screen.getByRole('img')).toBeDefined();
  });

  it('falls back to safe data when only one data point is given', () => {
    render(<Sparkline data={[5]} />);
    expect(screen.getByRole('img')).toBeDefined();
  });

  it('treats a flat (all-equal) series as an upward trend (last >= first)', () => {
    render(<Sparkline data={[3, 3, 3]} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('upward');
  });

  it('renders width and height as SVG attributes', () => {
    render(<Sparkline data={[1, 2]} width={200} height={60} />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('width')).toBe('200');
    expect(svg.getAttribute('height')).toBe('60');
  });

  it('uses a stable gradient id derived from width/height/color', () => {
    const { container } = render(
      <Sparkline data={[1, 2]} width={50} height={20} color="#112233" />,
    );
    const gradient = container.querySelector('linearGradient');
    expect(gradient?.id).toContain('50');
    expect(gradient?.id).toContain('20');
    expect(gradient?.id).toContain('112233');
  });

  it('survives a sparse data array (some indices are undefined / hits ?? 0 fallback)', () => {
    // Sparse array — index 0 is "in bounds" but uninitialized → safeData[0] === undefined.
    // The component should still render without error.
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [, 2, 3] as unknown as number[];
    sparse.length = 3;
    expect(() => render(<Sparkline data={sparse} />)).not.toThrow();
  });

  it('does not animate the line when getTotalLength reports zero (pathLength=0 branch)', () => {
    const original = (Element.prototype as Element & { getTotalLength: () => number })
      .getTotalLength;
    (Element.prototype as Element & { getTotalLength: () => number }).getTotalLength =
      function getTotalLength() {
        return 0;
      };
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    // The line path should still be present.
    const lines = container.querySelectorAll('path');
    expect(lines.length).toBeGreaterThan(0);
    // Restore the stub for downstream tests.
    (Element.prototype as Element & { getTotalLength: () => number }).getTotalLength = original;
  });
});
