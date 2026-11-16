/**
 * FR-6.2 category sub-ratings — real wire fields by persona.
 *
 * Customer → provider: quality / communication / timeliness / value
 * Provider → customer: payment_promptness / scope_accuracy / access
 *
 * Columns exist on `reviews` and are written/returned by CreateReview + list.
 */

import { REVIEW_DIRECTION } from '@/types';

export type CustomerReviewDimensionKey =
  | 'quality'
  | 'communication'
  | 'timeliness'
  | 'value';

export type ProviderReviewDimensionKey =
  | 'payment_promptness'
  | 'scope_accuracy'
  | 'access';

export type ReviewDimensionKey =
  | CustomerReviewDimensionKey
  | ProviderReviewDimensionKey;

export type ReviewWireField =
  | 'quality_rating'
  | 'communication_rating'
  | 'timeliness_rating'
  | 'value_rating'
  | 'payment_promptness_rating'
  | 'scope_accuracy_rating'
  | 'access_rating';

export type ReviewFormField =
  | 'qualityRating'
  | 'communicationRating'
  | 'timelinessRating'
  | 'valueRating'
  | 'paymentPromptnessRating'
  | 'scopeAccuracyRating'
  | 'accessRating';

export interface ReviewDimensionDef {
  /** Form field / wire mapping key. */
  key: ReviewDimensionKey;
  /** Wire JSON field on CreateReviewInput. */
  wireField: ReviewWireField;
  /** react-hook-form field name. */
  formField: ReviewFormField;
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

/** Provider→customer dims on real DB columns (FR-6.2). */
const PROVIDER_TO_CUSTOMER_DIMS: readonly ReviewDimensionDef[] = [
  {
    key: 'payment_promptness',
    wireField: 'payment_promptness_rating',
    formField: 'paymentPromptnessRating',
    label: 'Payment promptness',
    a11yLabel: 'Payment promptness rating',
  },
  {
    key: 'scope_accuracy',
    wireField: 'scope_accuracy_rating',
    formField: 'scopeAccuracyRating',
    label: 'Accuracy of scope',
    a11yLabel: 'Accuracy of scope rating',
  },
  {
    key: 'access',
    wireField: 'access_rating',
    formField: 'accessRating',
    label: 'Property access',
    a11yLabel: 'Property access rating',
  },
] as const;

/** Persona-specific CreateReview dimensions with real wire fields. */
export function reviewDimensionsForDirection(
  direction: string | undefined | null,
): readonly ReviewDimensionDef[] {
  if (direction === REVIEW_DIRECTION.PROVIDER_TO_CUSTOMER) {
    return PROVIDER_TO_CUSTOMER_DIMS;
  }
  return CUSTOMER_TO_PROVIDER_DIMS;
}
