import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GradientMesh } from '@/components/landing/GradientMesh';

describe('GradientMesh', () => {
  it('renders a non-interactive decorative container', () => {
    const { container } = render(<GradientMesh />);
    const root = container.firstChild as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute('aria-hidden')).toBe('true');
  });

  it('forwards className to the root element', () => {
    const { container } = render(<GradientMesh className="extra-mesh" />);
    expect(container.querySelector('.extra-mesh')).not.toBeNull();
  });

  it('renders the four gradient blob layers', () => {
    const { container } = render(<GradientMesh />);
    expect(container.querySelector('.gradient-blob-1')).not.toBeNull();
    expect(container.querySelector('.gradient-blob-2')).not.toBeNull();
    expect(container.querySelector('.gradient-blob-3')).not.toBeNull();
    expect(container.querySelector('.gradient-blob-4')).not.toBeNull();
  });

  it('uses pointer-events-none so it never blocks UI', () => {
    const { container } = render(<GradientMesh />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('pointer-events-none');
  });
});
