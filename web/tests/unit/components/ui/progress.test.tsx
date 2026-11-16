import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Progress } from '@/components/ui/progress';

describe('Progress', () => {
  it('renders a progressbar', () => {
    render(<Progress value={50} />);
    expect(screen.getByRole('progressbar')).toBeDefined();
  });

  it('reflects the value via inline transform style', () => {
    render(<Progress value={42} />);
    const indicator = screen.getByRole('progressbar').firstChild as HTMLElement;
    expect(indicator.style.transform).toContain('58');
  });

  it('forwards className', () => {
    render(<Progress value={10} className="my-progress" />);
    expect(screen.getByRole('progressbar').className).toContain('my-progress');
  });

  it('handles undefined value gracefully', () => {
    render(<Progress />);
    expect(screen.getByRole('progressbar')).toBeDefined();
  });
});
