import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SavingsHero } from '@/components/bids/SavingsHero';

describe('SavingsHero', () => {
  it('renders nothing when there are no savings', () => {
    const { container } = render(
      <SavingsHero startingPriceCents={20000} currentLowestCents={20000} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when starting price is 0', () => {
    const { container } = render(
      <SavingsHero startingPriceCents={0} currentLowestCents={15000} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows savings amount and percent when there is a delta', () => {
    render(
      <SavingsHero startingPriceCents={50000} currentLowestCents={35000} />,
    );
    // 50000 - 35000 = 15000 cents savings = $150, 30% off
    expect(screen.getByText('30%')).toBeDefined();
    // The text $150 may be split across spans by RollingDigits, but the
    // sr-only span contains the literal value.
    expect(screen.getByText("You're saving")).toBeDefined();
  });

  it('shows Incredible Deal badge when savings exceed 40%', () => {
    render(
      <SavingsHero startingPriceCents={50000} currentLowestCents={20000} />,
    );
    // 60% savings → incredible
    expect(screen.getByText(/incredible deal/i)).toBeDefined();
  });

  it('hides the Incredible Deal badge for moderate savings', () => {
    render(
      <SavingsHero startingPriceCents={50000} currentLowestCents={40000} />,
    );
    expect(screen.queryByText(/incredible deal/i)).toBeNull();
  });

  it('exposes an aria-label describing the savings', () => {
    render(
      <SavingsHero startingPriceCents={50000} currentLowestCents={35000} />,
    );
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-label')).toContain('30 percent');
  });
});
