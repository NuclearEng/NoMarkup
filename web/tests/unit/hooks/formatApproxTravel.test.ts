import { describe, expect, it } from 'vitest';

import { formatApproxTravel } from '@/hooks/useInstantMatch';

describe('formatApproxTravel', () => {
  it('returns null for missing or non-positive', () => {
    expect(formatApproxTravel(undefined)).toBeNull();
    expect(formatApproxTravel(null)).toBeNull();
    expect(formatApproxTravel(0)).toBeNull();
    expect(formatApproxTravel(-3)).toBeNull();
  });

  it('formats minutes and hours with honest approx. travel label', () => {
    expect(formatApproxTravel(12)).toBe('≈ 12 min approx. travel');
    expect(formatApproxTravel(60)).toBe('≈ 1h approx. travel');
    expect(formatApproxTravel(75)).toBe('≈ 1h 15m approx. travel');
  });
});
