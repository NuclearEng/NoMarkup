/**
 * FR-6.2 category sub-ratings.
 *
 * Wire fields are fixed: quality_rating, communication_rating,
 * timeliness_rating, value_rating (CreateReview API + proto). The DB also has
 * payment_promptness_rating / scope_accuracy_rating / access_rating columns,
 * but CreateReview does not write or return them — residual until an API
 * extension maps provider→customer into those columns.
 *
 * Until then: same four wire keys both ways; UI labels are persona-specific.
 */

import { REVIEW_DIRECTION } from '@/types';

export type ReviewDimensionKey =
  | 'quality'
  | 'communication'
  | 'timeliness'
  | 'value';

export interface ReviewDimensionDef {
  /** Form field / wire mapping key. */
  key: ReviewDimensionKey;
  /** Wire JSON field on CreateReviewInput. */
  wireField:
    | 'quality_rating'
    | 'communication_rating'
    | 'timeliness_rating'
    | 'value_rating';
  /** react-hook-form field name. */
  formField:
    | 'qualityRating'
    | 'communicationRating'
    | 'timelinessRating'
    | 'valueRating';
  /** Short UI label. */
  label: string;
  /** Accessible label for star input. */
  a11yLabel: string;
}

const CUSTOMER_TO_PROVIDER_DIMS: readonly ReviewDimensionDef[] = [
  {
    key: 'quality',
    wireField: 'quality_rating',
    formField: 'qualityRating',
    label: 'Quality of work',
    a11yLabel: 'Quality of work rating',
  },
  {
    key: 'communication',
    wireField: 'communication_rating',
    formField: 'communicationRating',
    label: 'Communication',
    a11yLabel: 'Communication rating',
  },
  {
    key: 'timeliness',
    wireField: 'timeliness_rating',
    formField: 'timelinessRating',
    label: 'Timeliness',
    a11yLabel: 'Timeliness rating',
  },
  {
    key: 'value',
    wireField: 'value_rating',
    formField: 'valueRating',
    label: 'Value',
    a11yLabel: 'Value rating',
  },
] as const;

/**
 * Provider→customer PRD dims mapped onto the fixed 4 wire keys:
 * payment promptness → quality_rating
 * communication → communication_rating
 * accuracy of scope → timeliness_rating
 * property access → value_rating
 */
const PROVIDER_TO_CUSTOMER_DIMS: readonly ReviewDimensionDef[] = [
  {
    key: 'quality',
    wireField: 'quality_rating',
    formField: 'qualityRating',
    label: 'Payment promptness',
    a11yLabel: 'Payment promptness rating',
  },
  {
    key: 'communication',
    wireField: 'communication_rating',
    formField: 'communicationRating',
    label: 'Communication',
    a11yLabel: 'Communication rating',
  },
  {
    key: 'timeliness',
    wireField: 'timeliness_rating',
    formField: 'timelinessRating',
    label: 'Accuracy of scope',
    a11yLabel: 'Accuracy of scope rating',
  },
  {
    key: 'value',
    wireField: 'value_rating',
    formField: 'valueRating',
    label: 'Property access',
    a11yLabel: 'Property access rating',
  },
] as const;

/** Persona-specific labels for the fixed four CreateReview wire fields. */
export function reviewDimensionsForDirection(
  direction: string | undefined | null,
): readonly ReviewDimensionDef[] {
  if (direction === REVIEW_DIRECTION.PROVIDER_TO_CUSTOMER) {
    return PROVIDER_TO_CUSTOMER_DIMS;
  }
  return CUSTOMER_TO_PROVIDER_DIMS;
}
