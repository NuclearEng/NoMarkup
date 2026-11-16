import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WatcherBadge } from '@/components/marketplace/WatcherBadge';

describe('WatcherBadge', () => {
  it('renders nothing when count is zero', () => {
    const { container } = render(<WatcherBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the count and an aria-label when nonzero', () => {
    render(<WatcherBadge count={12} />);
    expect(screen.getByText('12')).toBeDefined();
    expect(screen.getByLabelText(/12 people watching/i)).toBeDefined();
  });

  it('uses the warm tier styling at 15+', () => {
    const { container } = render(<WatcherBadge count={20} />);
    // Tier colours are semantic tokens since the token migration (44e22917).
    expect(container.querySelector('.text-trust-medium')).not.toBeNull();
    expect(container.querySelector('.text-destructive')).toBeNull();
  });

  it('uses the hot tier styling at 50+', () => {
    const { container } = render(<WatcherBadge count={73} />);
    expect(container.querySelector('.text-destructive')).not.toBeNull();
    expect(container.querySelector('.text-trust-medium')).toBeNull();
  });

  it('uses the cool tier styling under 15', () => {
    const { container } = render(<WatcherBadge count={3} />);
    expect(container.querySelector('.text-muted-foreground')).not.toBeNull();
    expect(container.querySelector('.text-destructive')).toBeNull();
    expect(container.querySelector('.text-trust-medium')).toBeNull();
  });
});
