# FR-6.2 review dimensions — residual CLOSED

**Status:** **CLOSED** 2026-08-02  
**Was:** Persona UI labels over shared customer wire fields only.  
**Now:** Provider→customer uses real columns/API fields:

- `payment_promptness_rating`
- `scope_accuracy_rating`
- `access_rating`

Customer→provider remains: `quality_rating`, `communication_rating`, `timeliness_rating`, `value_rating`.

Evidence: `services/job/internal/service/review.go` + tests; gateway `review.go`; web `ReviewForm` / `review-dimensions.ts`; iOS `LeaveReviewSheet`.

Role-filters ignore cross-direction fields on write.
