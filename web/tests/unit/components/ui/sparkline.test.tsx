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
});
