import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChunkPlaceholder } from '@/components/ui/chunk-placeholder';

describe('ChunkPlaceholder', () => {
  it('is a status region named by its label', () => {
    render(<ChunkPlaceholder label="Loading claim form…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading claim form…');
  });

  it('reserves height: a default minimum, plus whatever the caller passes', () => {
    const { rerender } = render(<ChunkPlaceholder label="Loading…" />);
    expect(screen.getByRole('status')).toHaveClass('min-h-[140px]');

    rerender(<ChunkPlaceholder label="Loading…" className="min-h-[480px]" />);
    const status = screen.getByRole('status');
    expect(status).toHaveClass('min-h-[480px]');
    // tailwind-merge keeps one min-height, the caller's.
    expect(status).not.toHaveClass('min-h-[140px]');
  });

  it('hides the decorative skeleton from assistive technology', () => {
    render(<ChunkPlaceholder label="Loading…" />);
    const skeleton = screen.getByRole('status').firstElementChild;
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
  });
});
