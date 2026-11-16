import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SkeletonShimmer } from '@/components/ui/skeleton-shimmer';

describe('SkeletonShimmer', () => {
  it('renders without crashing', () => {
    const { container } = render(<SkeletonShimmer />);
    expect(container.firstChild).not.toBeNull();
  });

  it('forwards className', () => {
    const { container } = render(<SkeletonShimmer className="custom-skel" />);
    expect((container.firstChild as HTMLElement).className).toContain('custom-skel');
  });
});
