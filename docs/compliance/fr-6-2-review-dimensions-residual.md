# FR-6.2 asymmetric review dimensions — residual

**Status:** UI complete with documented API residual (2026-08-02).

## PRD

Customer reviewing provider: quality of work, timeliness, communication, value.

Provider reviewing customer: payment promptness, accuracy of scope, communication, property access.

## What ships

- **Web** (`web/src/lib/review-dimensions.ts`, `ReviewForm`, `ReviewCard`): both directions show four category stars; labels switch by `direction`.
- **iOS** (`LeaveReviewSheet`): same persona labels; still POSTs `quality_rating` / `communication_rating` / `timeliness_rating` / `value_rating`.
- CreateReview gateway/proto remains the fixed four optional int fields.

## Residual (not done)

1. **Wire/API:** No free-form category map and no named provider→customer fields on CreateReview.
2. **DB:** Migration `001` has `payment_promptness_rating`, `scope_accuracy_rating`, `access_rating` on `reviews`, but job service create/read **never** writes or selects them.
3. **Trust / aggregates:** Continue to interpret the shared four keys (no separate provider→customer trust inputs).

### Mapping (until API extension)

| Persona meaning (provider→customer) | Wire field used |
|-------------------------------------|-----------------|
| Payment promptness | `quality_rating` |
| Communication | `communication_rating` |
| Accuracy of scope | `timeliness_rating` |
| Property access | `value_rating` |

Closing the residual requires: proto + gateway JSON + domain/repo write/read of the three DB columns (communication stays shared), then stop remapping labels onto customer-oriented keys for storage.

## FR-18.7 residual (related)

Provider substitution is **not** automated. On cancelled recurring config, customer sees **Post a new job for remaining visits** (web deep-link prefill / iOS `PostJobView` prefill). No backend reassignment of the remaining schedule to a new provider.
