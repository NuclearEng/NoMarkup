import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GoldAccentCard } from '@/components/ui/gold-accent-card';

describe('GoldAccentCard', () => {
  it('renders children', () => {
    render(<GoldAccentCard>Body</GoldAccentCard>);
    expect(screen.getByText('Body')).toBeDefined();
  });

  it('forwards className', () => {
    const { container } = render(<GoldAccentCard className="my-gold">x</GoldAccentCard>);
    expect((container.firstChild as HTMLElement).className).toContain('my-gold');
  });

  it('applies the prominent variant', () => {
    const { container } = render(<GoldAccentCard variant="prominent">x</GoldAccentCard>);
    expect((container.firstChild as HTMLElement).className).toContain('border-l');
  });

  it('applies the winning variant', () => {
    const { container } = render(<GoldAccentCard variant="winning">x</GoldAccentCard>);
    expect((container.firstChild as HTMLElement).className).toContain('gold-border');
  });
});
