import { describe, expect, it } from 'vitest';

import { reviewDimensionsForDirection } from '@/lib/review-dimensions';
import { REVIEW_DIRECTION } from '@/types';

describe('reviewDimensionsForDirection (FR-6.2 residual)', () => {
  it('returns customer→provider labels by default', () => {
    const dims = reviewDimensionsForDirection(REVIEW_DIRECTION.CUSTOMER_TO_PROVIDER);
    expect(dims.map((d) => d.label)).toEqual([
      'Quality of work',
      'Communication',
      'Timeliness',
      'Value',
    ]);
    expect(dims.map((d) => d.wireField)).toEqual([
      'quality_rating',
      'communication_rating',
      'timeliness_rating',
      'value_rating',
    ]);
  });

  it('returns provider→customer persona labels on the same wire fields', () => {
    const dims = reviewDimensionsForDirection(REVIEW_DIRECTION.PROVIDER_TO_CUSTOMER);
    expect(dims.map((d) => d.label)).toEqual([
      'Payment promptness',
      'Communication',
      'Accuracy of scope',
      'Property access',
    ]);
    expect(dims.map((d) => d.wireField)).toEqual([
      'quality_rating',
      'communication_rating',
      'timeliness_rating',
      'value_rating',
    ]);
  });
});
