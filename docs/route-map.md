# NoMarkup REST-to-gRPC Route Map

API Gateway: Chi router on `:8080`
Base path: `/api/v1/`

## Rate Limit Tiers

| Tier       | Description                                      |
|------------|--------------------------------------------------|
| `none`     | No rate limiting (internal or health endpoints)   |
| `standard` | Default authenticated-user limit (60 req/min)     |
| `strict`   | Tight limit for expensive operations (10 req/min) |
| `auth`     | Unauthenticated auth endpoints (20 req/min)       |

## Auth Levels

| Level            | Description                                 |
|------------------|---------------------------------------------|
| `public`         | No authentication required                  |
| `authenticated`  | Any valid JWT                               |
| `role:customer`  | JWT with customer role enabled              |
| `role:provider`  | JWT with provider role enabled              |
| `role:admin`     | JWT with admin role                         |
| `role:support`   | JWT with support or admin role              |

---

## Health Check

| Method | Path             | Handler        | Auth   | Rate Limit |
|--------|------------------|----------------|--------|------------|
| GET    | /healthz         | Gateway health | public | none       |
| GET    | /readyz          | Gateway ready  | public | none       |

---

## 1. User Service (36 RPCs)

### Auth

| Method | Path                              | gRPC Method                    | Auth           | Rate Limit | Input Source          |
|--------|-----------------------------------|--------------------------------|----------------|------------|-----------------------|
| POST   | /api/v1/auth/register             | UserService.Register           | public         | auth       | JSON body             |
| POST   | /api/v1/auth/login                | UserService.Login              | public         | auth       | JSON body             |
| POST   | /api/v1/auth/refresh              | UserService.RefreshToken       | public         | auth       | JSON body             |
| POST   | /api/v1/auth/logout               | UserService.Logout             | authenticated  | standard   | JSON body             |
| POST   | /api/v1/auth/verify-email         | UserService.VerifyEmail        | public         | auth       | JSON body             |
| POST   | /api/v1/auth/verify-phone         | UserService.VerifyPhone        | authenticated  | auth       | JSON body             |
| POST   | /api/v1/auth/send-phone-otp       | UserService.SendPhoneOTP       | authenticated  | strict     | JSON body             |
| POST   | /api/v1/auth/request-password-reset | UserService.RequestPasswordReset | public       | strict     | JSON body             |
| POST   | /api/v1/auth/reset-password       | UserService.ResetPassword      | public         | auth       | JSON body             |

### MFA

| Method | Path                       | gRPC Method            | Auth          | Rate Limit | Input Source |
|--------|----------------------------|------------------------|---------------|------------|--------------|
| POST   | /api/v1/auth/mfa/enable    | UserService.EnableMFA  | authenticated | strict     | JSON body    |
| POST   | /api/v1/auth/mfa/verify    | UserService.VerifyMFA  | authenticated | auth       | JSON body    |
| POST   | /api/v1/auth/mfa/disable   | UserService.DisableMFA | authenticated | strict     | JSON body    |

### Profile

| Method | Path                            | gRPC Method                  | Auth          | Rate Limit | Input Source            |
|--------|---------------------------------|------------------------------|---------------|------------|-------------------------|
| GET    | /api/v1/users/{userId}          | UserService.GetUser          | authenticated | standard   | path params             |
| PATCH  | /api/v1/users/me                | UserService.UpdateUser       | authenticated | standard   | JSON body               |
| POST   | /api/v1/users/me/enable-role    | UserService.EnableRole       | authenticated | strict     | JSON body               |
| POST   | /api/v1/users/me/deactivate     | UserService.DeactivateAccount| authenticated | strict     | JSON body               |

### Provider Profile

| Method | Path                                           | gRPC Method                          | Auth           | Rate Limit | Input Source |
|--------|------------------------------------------------|--------------------------------------|----------------|------------|--------------|
| GET    | /api/v1/providers/{providerId}                 | UserService.GetProviderProfile       | public         | standard   | path params  |
| PATCH  | /api/v1/providers/me                           | UserService.UpdateProviderProfile    | role:provider  | standard   | JSON body    |
| PUT    | /api/v1/providers/me/terms                     | UserService.SetGlobalTerms           | role:provider  | standard   | JSON body    |
| PUT    | /api/v1/providers/me/categories                | UserService.UpdateServiceCategories  | role:provider  | standard   | JSON body    |
| PUT    | /api/v1/providers/me/portfolio                 | UserService.UpdatePortfolio          | role:provider  | standard   | JSON body    |
| PUT    | /api/v1/providers/me/instant-availability      | UserService.SetInstantAvailability   | role:provider  | standard   | JSON body    |

### Properties

| Method | Path                                   | gRPC Method               | Auth           | Rate Limit | Input Source            |
|--------|----------------------------------------|---------------------------|----------------|------------|-------------------------|
| POST   | /api/v1/properties                     | UserService.CreateProperty| role:customer  | standard   | JSON body               |
| PATCH  | /api/v1/properties/{propertyId}        | UserService.UpdateProperty| role:customer  | standard   | path params + JSON body |
| DELETE | /api/v1/properties/{propertyId}        | UserService.DeleteProperty| role:customer  | standard   | path params             |
| GET    | /api/v1/properties                     | UserService.ListProperties| role:customer  | standard   | query params            |

### Verification Documents

| Method | Path                                  | gRPC Method                  | Auth           | Rate Limit | Input Source            |
|--------|---------------------------------------|------------------------------|----------------|------------|-------------------------|
| POST   | /api/v1/verification/documents        | UserService.UploadDocument   | role:provider  | strict     | JSON body               |
| GET    | /api/v1/verification/documents/{docId}| UserService.GetDocumentStatus| role:provider  | standard   | path params             |
| GET    | /api/v1/verification/documents        | UserService.ListDocuments    | role:provider  | standard   | query params            |

### Search

| Method | Path                        | gRPC Method               | Auth   | Rate Limit | Input Source |
|--------|-----------------------------|---------------------------|--------|------------|--------------|
| GET    | /api/v1/providers/search    | UserService.SearchProviders| public | standard   | query params |

### Admin

| Method | Path                                        | gRPC Method                    | Auth       | Rate Limit | Input Source            |
|--------|---------------------------------------------|--------------------------------|------------|------------|-------------------------|
| GET    | /api/v1/admin/users/{userId}                | UserService.AdminGetUser       | role:admin | standard   | path params             |
| GET    | /api/v1/admin/users                         | UserService.AdminSearchUsers   | role:admin | standard   | query params            |
| POST   | /api/v1/admin/users/{userId}/suspend        | UserService.AdminSuspendUser   | role:admin | strict     | path params + JSON body |
| POST   | /api/v1/admin/users/{userId}/ban            | UserService.AdminBanUser       | role:admin | strict     | path params + JSON body |
| POST   | /api/v1/admin/documents/{docId}/review      | UserService.AdminReviewDocument| role:admin | standard   | path params + JSON body |

---

## 2. Job Service (21 RPCs)

### CRUD

| Method | Path                              | gRPC Method            | Auth           | Rate Limit | Input Source            |
|--------|-----------------------------------|------------------------|----------------|------------|-------------------------|
| POST   | /api/v1/jobs                      | JobService.CreateJob   | role:customer  | standard   | JSON body               |
| PATCH  | /api/v1/jobs/{jobId}              | JobService.UpdateJob   | role:customer  | standard   | path params + JSON body |
| GET    | /api/v1/jobs/{jobId}              | JobService.GetJob      | authenticated  | standard   | path params             |
| DELETE | /api/v1/jobs/{jobId}/draft        | JobService.DeleteDraft | role:customer  | standard   | path params             |
| POST   | /api/v1/jobs/{jobId}/publish      | JobService.PublishJob  | role:customer  | standard   | path params + JSON body |
| POST   | /api/v1/jobs/{jobId}/close-auction| JobService.CloseAuction| role:customer  | standard   | path params             |
| POST   | /api/v1/jobs/{jobId}/cancel       | JobService.CancelJob   | role:customer  | standard   | path params + JSON body |
| POST   | /api/v1/jobs/{jobId}/repost       | JobService.RepostJob   | role:customer  | standard   | path params + JSON body |

### Search & Lists

| Method | Path                                | gRPC Method                      | Auth           | Rate Limit | Input Source |
|--------|-------------------------------------|----------------------------------|----------------|------------|--------------|
| GET    | /api/v1/jobs/search                 | JobService.SearchJobs            | public         | standard   | query params |
| GET    | /api/v1/jobs/map                    | JobService.GetJobsOnMap          | public         | standard   | query params |
| GET    | /api/v1/customers/me/jobs           | JobService.ListCustomerJobs      | role:customer  | standard   | query params |
| GET    | /api/v1/providers/me/bidded-jobs    | JobService.ListProviderBiddedJobs| role:provider  | standard   | query params |
| GET    | /api/v1/jobs/drafts                 | JobService.ListDrafts            | role:customer  | standard   | query params |

### Taxonomy

| Method | Path                                  | gRPC Method                      | Auth   | Rate Limit | Input Source |
|--------|---------------------------------------|----------------------------------|--------|------------|--------------|
| GET    | /api/v1/categories                    | JobService.GetServiceCategories  | public | standard   | query params |
| GET    | /api/v1/categories/tree               | JobService.GetCategoryTree       | public | standard   | query params |

### Admin

| Method | Path                                        | gRPC Method                    | Auth       | Rate Limit | Input Source            |
|--------|---------------------------------------------|--------------------------------|------------|------------|-------------------------|
| GET    | /api/v1/admin/jobs                          | JobService.AdminListJobs       | role:admin | standard   | query params            |
| POST   | /api/v1/admin/jobs/{jobId}/suspend          | JobService.AdminSuspendJob     | role:admin | strict     | path params + JSON body |
| DELETE | /api/v1/admin/jobs/{jobId}                  | JobService.AdminRemoveJob      | role:admin | strict     | path params             |
| POST   | /api/v1/admin/categories                    | JobService.AdminCreateCategory | role:admin | standard   | JSON body               |
| PATCH  | /api/v1/admin/categories/{categoryId}       | JobService.AdminUpdateCategory | role:admin | standard   | path params + JSON body |
| DELETE | /api/v1/admin/categories/{categoryId}       | JobService.AdminDeleteCategory | role:admin | strict     | path params             |

---

## 3. Bid Service (12 RPCs)

### Bidding

| Method | Path                                    | gRPC Method               | Auth           | Rate Limit | Input Source            |
|--------|-----------------------------------------|---------------------------|----------------|------------|-------------------------|
| POST   | /api/v1/jobs/{jobId}/bids               | BidService.PlaceBid       | role:provider  | standard   | path params + JSON body |
| PATCH  | /api/v1/bids/{bidId}                    | BidService.UpdateBid      | role:provider  | standard   | path params + JSON body |
| DELETE | /api/v1/bids/{bidId}                    | BidService.WithdrawBid    | role:provider  | standard   | path params             |
| POST   | /api/v1/bids/{bidId}/accept-offer       | BidService.AcceptOfferPrice| role:provider  | standard   | path params             |

### Award

| Method | Path                                    | gRPC Method          | Auth           | Rate Limit | Input Source            |
|--------|-----------------------------------------|----------------------|----------------|------------|-------------------------|
| POST   | /api/v1/bids/{bidId}/award              | BidService.AwardBid  | role:customer  | strict     | path params + JSON body |

### Query

| Method | Path                                    | gRPC Method                   | Auth           | Rate Limit | Input Source |
|--------|-----------------------------------------|-------------------------------|----------------|------------|--------------|
| GET    | /api/v1/bids/{bidId}                    | BidService.GetBid             | authenticated  | standard   | path params  |
| GET    | /api/v1/jobs/{jobId}/bids               | BidService.ListBidsForJob     | authenticated  | standard   | path params + query params |
| GET    | /api/v1/providers/me/bids               | BidService.ListBidsForProvider| role:provider  | standard   | query params |
| GET    | /api/v1/jobs/{jobId}/bids/count         | BidService.GetBidCount        | authenticated  | standard   | path params  |

### Analytics

| Method | Path                                    | gRPC Method               | Auth           | Rate Limit | Input Source |
|--------|-----------------------------------------|---------------------------|----------------|------------|--------------|
| GET    | /api/v1/bids/analytics                  | BidService.GetBidAnalytics| role:provider  | standard   | query params |

### Internal Only (not exposed through gateway)

| gRPC Method                    | Trigger                             |
|--------------------------------|-------------------------------------|
| BidService.ExpireAuction       | Scheduled job / JobService event    |
| BidService.CheckAuctionDeadlines | Cron job (runs every minute)      |

---

## 4. Contract Service (26 RPCs)

### Lifecycle

| Method | Path                                          | gRPC Method                     | Auth           | Rate Limit | Input Source            |
|--------|-----------------------------------------------|---------------------------------|----------------|------------|-------------------------|
| GET    | /api/v1/contracts/{contractId}                | ContractService.GetContract     | authenticated  | standard   | path params             |
| POST   | /api/v1/contracts/{contractId}/accept         | ContractService.AcceptContract  | role:provider  | strict     | path params             |
| POST   | /api/v1/contracts/{contractId}/start          | ContractService.StartWork       | role:provider  | strict     | path params             |
| GET    | /api/v1/contracts/{contractId}/pdf            | ContractService.ExportContractPDF| authenticated | standard   | path params             |
| GET    | /api/v1/contracts                             | ContractService.ListContracts   | authenticated  | standard   | query params            |

### Milestones

| Method | Path                                                         | gRPC Method                         | Auth           | Rate Limit | Input Source            |
|--------|--------------------------------------------------------------|-------------------------------------|----------------|------------|-------------------------|
| POST   | /api/v1/contracts/{contractId}/milestones/{milestoneId}/submit   | ContractService.SubmitMilestone | role:provider  | standard   | path params + JSON body |
| POST   | /api/v1/contracts/{contractId}/milestones/{milestoneId}/approve  | ContractService.ApproveMilestone| role:customer  | strict     | path params + JSON body |
| POST   | /api/v1/contracts/{contractId}/milestones/{milestoneId}/revise   | ContractService.RequestRevision | role:customer  | standard   | path params + JSON body |

### Completion

| Method | Path                                                    | gRPC Method                         | Auth           | Rate Limit | Input Source            |
|--------|---------------------------------------------------------|-------------------------------------|----------------|------------|-------------------------|
| POST   | /api/v1/contracts/{contractId}/complete                 | ContractService.MarkComplete        | role:provider  | strict     | path params + JSON body |
| POST   | /api/v1/contracts/{contractId}/approve-completion       | ContractService.ApproveCompletion   | role:customer  | strict     | path params + JSON body |

### Change Orders

| Method | Path                                                            | gRPC Method                           | Auth          | Rate Limit | Input Source            |
|--------|-----------------------------------------------------------------|---------------------------------------|---------------|------------|-------------------------|
| POST   | /api/v1/contracts/{contractId}/change-orders                    | ContractService.ProposeChangeOrder    | authenticated | standard   | path params + JSON body |
| POST   | /api/v1/contracts/{contractId}/change-orders/{changeOrderId}/respond | ContractService.RespondToChangeOrder | authenticated | standard   | path params + JSON body |

### Cancellation

| Method | Path                                              | gRPC Method                    | Auth          | Rate Limit | Input Source            |
|--------|---------------------------------------------------|--------------------------------|---------------|------------|-------------------------|
| POST   | /api/v1/contracts/{contractId}/cancel             | ContractService.CancelContract | authenticated | strict     | path params + JSON body |

### Recurring Contracts

| Method | Path                                                             | gRPC Method                                | Auth           | Rate Limit | Input Source            |
|--------|------------------------------------------------------------------|--------------------------------------------|----------------|------------|-------------------------|
| GET    | /api/v1/contracts/{contractId}/recurring                         | ContractService.GetRecurringConfig         | authenticated  | standard   | path params             |
| PATCH  | /api/v1/contracts/{contractId}/recurring                         | ContractService.UpdateRecurringConfig      | authenticated  | standard   | path params + JSON body |
| POST   | /api/v1/contracts/{contractId}/recurring/pause                   | ContractService.PauseRecurring             | authenticated  | standard   | path params             |
| POST   | /api/v1/contracts/{contractId}/recurring/resume                  | ContractService.ResumeRecurring            | authenticated  | standard   | path params             |
| POST   | /api/v1/contracts/{contractId}/recurring/cancel                  | ContractService.CancelRecurring            | authenticated  | strict     | path params + JSON body |
| GET    | /api/v1/contracts/{contractId}/recurring/instances               | ContractService.ListRecurringInstances     | authenticated  | standard   | path params + query params |
| POST   | /api/v1/contracts/{contractId}/recurring/instances/{instanceId}/complete | ContractService.CompleteRecurringInstance | role:provider | standard   | path params + JSON body |
| POST   | /api/v1/contracts/{contractId}/recurring/instances/{instanceId}/approve  | ContractService.ApproveRecurringInstance | role:customer | strict     | path params + JSON body |

### Disputes

| Method | Path                                                   | gRPC Method                         | Auth           | Rate Limit | Input Source            |
|--------|--------------------------------------------------------|-------------------------------------|----------------|------------|-------------------------|
| POST   | /api/v1/contracts/{contractId}/disputes                | ContractService.OpenDispute         | authenticated  | strict     | path params + JSON body |
| GET    | /api/v1/disputes/{disputeId}                           | ContractService.GetDispute          | authenticated  | standard   | path params             |
| GET    | /api/v1/disputes                                       | ContractService.ListDisputes        | authenticated  | standard   | query params            |
| POST   | /api/v1/admin/disputes/{disputeId}/resolve             | ContractService.AdminResolveDispute | role:admin     | strict     | path params + JSON body |

### No-Show / Abandonment

| Method | Path                                                   | gRPC Method                         | Auth          | Rate Limit | Input Source            |
|--------|--------------------------------------------------------|-------------------------------------|---------------|------------|-------------------------|
| POST   | /api/v1/contracts/{contractId}/report-noshow           | ContractService.ReportNoShow        | authenticated | strict     | path params + JSON body |
| POST   | /api/v1/contracts/{contractId}/report-abandonment      | ContractService.ReportAbandonment   | authenticated | strict     | path params + JSON body |

---

## 5. Payment Service (18 RPCs)

### Stripe Connect (Provider Onboarding)

| Method | Path                                       | gRPC Method                            | Auth           | Rate Limit | Input Source |
|--------|--------------------------------------------|----------------------------------------|----------------|------------|--------------|
| POST   | /api/v1/payments/stripe/account            | PaymentService.CreateStripeAccount     | role:provider  | strict     | JSON body    |
| GET    | /api/v1/payments/stripe/onboarding-link    | PaymentService.GetStripeOnboardingLink | role:provider  | standard   | query params |
| GET    | /api/v1/payments/stripe/account-status     | PaymentService.GetStripeAccountStatus  | role:provider  | standard   | query params |
| GET    | /api/v1/payments/stripe/dashboard-link     | PaymentService.GetStripeDashboardLink  | role:provider  | standard   | query params |

### Payment Methods

| Method | Path                                              | gRPC Method                        | Auth           | Rate Limit | Input Source |
|--------|---------------------------------------------------|------------------------------------|----------------|------------|--------------|
| POST   | /api/v1/payments/methods/setup-intent             | PaymentService.CreateSetupIntent   | authenticated  | standard   | JSON body    |
| GET    | /api/v1/payments/methods                          | PaymentService.ListPaymentMethods  | authenticated  | standard   | query params |
| DELETE | /api/v1/payments/methods/{paymentMethodId}        | PaymentService.DeletePaymentMethod | authenticated  | standard   | path params  |

### Payments

| Method | Path                                       | gRPC Method                     | Auth           | Rate Limit | Input Source            |
|--------|--------------------------------------------|---------------------------------|----------------|------------|-------------------------|
| POST   | /api/v1/payments                           | PaymentService.CreatePayment    | role:customer  | strict     | JSON body               |
| POST   | /api/v1/payments/{paymentId}/process       | PaymentService.ProcessPayment   | role:customer  | strict     | path params + JSON body |
| POST   | /api/v1/payments/{paymentId}/release       | PaymentService.ReleaseEscrow    | role:customer  | strict     | path params             |
| GET    | /api/v1/payments/{paymentId}               | PaymentService.GetPayment       | authenticated  | standard   | path params             |
| GET    | /api/v1/payments                           | PaymentService.ListPayments     | authenticated  | standard   | query params            |

### Refunds

| Method | Path                                       | gRPC Method                  | Auth          | Rate Limit | Input Source |
|--------|--------------------------------------------|------------------------------|---------------|------------|--------------|
| POST   | /api/v1/payments/{paymentId}/refund        | PaymentService.CreateRefund  | authenticated | strict     | path params + JSON body |

### Fees

| Method | Path                              | gRPC Method                   | Auth          | Rate Limit | Input Source |
|--------|-----------------------------------|-------------------------------|---------------|------------|--------------|
| POST   | /api/v1/payments/calculate-fees   | PaymentService.CalculateFees  | authenticated | standard   | JSON body    |
| GET    | /api/v1/payments/fee-config       | PaymentService.GetFeeConfig   | authenticated | standard   | query params |

### Revenue

| Method | Path                                     | gRPC Method                      | Auth          | Rate Limit | Input Source |
|--------|------------------------------------------|----------------------------------|---------------|------------|--------------|
| GET    | /api/v1/payments/revenue                 | PaymentService.GetRevenueReport  | role:provider | standard   | query params |

### Webhook

| Method | Path                              | gRPC Method                         | Auth   | Rate Limit | Input Source |
|--------|-----------------------------------|-------------------------------------|--------|------------|--------------|
| POST   | /api/v1/webhooks/stripe           | PaymentService.HandleStripeWebhook  | public | none       | JSON body (Stripe signature verified) |

### Admin

| Method | Path                                           | gRPC Method                          | Auth       | Rate Limit | Input Source            |
|--------|-------------------------------------------------|--------------------------------------|------------|------------|-------------------------|
| GET    | /api/v1/admin/payments/{paymentId}             | PaymentService.AdminGetPaymentDetails| role:admin | standard   | path params             |
| GET    | /api/v1/admin/payments                         | PaymentService.AdminListPayments     | role:admin | standard   | query params            |
| PATCH  | /api/v1/admin/payments/fee-config              | PaymentService.AdminUpdateFeeConfig  | role:admin | strict     | JSON body               |

---

## 6. Chat Service (11 RPCs)

### Channels

| Method | Path                                   | gRPC Method              | Auth          | Rate Limit | Input Source            |
|--------|----------------------------------------|--------------------------|---------------|------------|-------------------------|
| POST   | /api/v1/chat/channels                  | ChatService.CreateChannel| authenticated | standard   | JSON body               |
| GET    | /api/v1/chat/channels/{channelId}      | ChatService.GetChannel   | authenticated | standard   | path params             |
| GET    | /api/v1/chat/channels                  | ChatService.ListChannels | authenticated | standard   | query params            |

### Messages

| Method | Path                                                  | gRPC Method                | Auth          | Rate Limit | Input Source            |
|--------|-------------------------------------------------------|----------------------------|---------------|------------|-------------------------|
| POST   | /api/v1/chat/channels/{channelId}/messages            | ChatService.SendMessage    | authenticated | standard   | path params + JSON body |
| GET    | /api/v1/chat/channels/{channelId}/messages            | ChatService.ListMessages   | authenticated | standard   | path params + query params |
| POST   | /api/v1/chat/channels/{channelId}/read                | ChatService.MarkRead       | authenticated | standard   | path params + JSON body |

### Contacts

| Method | Path                                                      | gRPC Method                  | Auth          | Rate Limit | Input Source            |
|--------|-----------------------------------------------------------|------------------------------|---------------|------------|-------------------------|
| POST   | /api/v1/chat/channels/{channelId}/share-contact           | ChatService.ShareContactInfo | authenticated | strict     | path params + JSON body |
| GET    | /api/v1/chat/channels/{channelId}/shared-contacts         | ChatService.GetSharedContacts| authenticated | standard   | path params             |

### Typing & Unread

| Method | Path                                                     | gRPC Method                     | Auth          | Rate Limit | Input Source            |
|--------|----------------------------------------------------------|---------------------------------|---------------|------------|-------------------------|
| POST   | /api/v1/chat/channels/{channelId}/typing                 | ChatService.SendTypingIndicator | authenticated | standard   | path params             |
| GET    | /api/v1/chat/unread-count                                | ChatService.GetUnreadCount      | authenticated | standard   | query params            |

### Admin

| Method | Path                                                | gRPC Method                        | Auth         | Rate Limit | Input Source            |
|--------|-----------------------------------------------------|------------------------------------|--------------|------------|-------------------------|
| GET    | /api/v1/admin/chat/channels/{channelId}/messages    | ChatService.AdminGetChannelMessages| role:support | standard   | path params + query params |

---

## 7. Review Service (11 RPCs)

### Reviews

| Method | Path                                         | gRPC Method                      | Auth           | Rate Limit | Input Source            |
|--------|----------------------------------------------|----------------------------------|----------------|------------|-------------------------|
| POST   | /api/v1/reviews                              | ReviewService.CreateReview       | authenticated  | strict     | JSON body               |
| GET    | /api/v1/reviews/{reviewId}                   | ReviewService.GetReview          | public         | standard   | path params             |
| GET    | /api/v1/users/{userId}/reviews               | ReviewService.ListReviewsForUser | public         | standard   | path params + query params |
| GET    | /api/v1/users/{userId}/reviews/written       | ReviewService.ListReviewsByUser  | authenticated  | standard   | path params + query params |

### Response

| Method | Path                                          | gRPC Method                    | Auth          | Rate Limit | Input Source            |
|--------|-----------------------------------------------|--------------------------------|---------------|------------|-------------------------|
| POST   | /api/v1/reviews/{reviewId}/respond            | ReviewService.RespondToReview  | authenticated | standard   | path params + JSON body |

### Flags & Eligibility

| Method | Path                                          | gRPC Method                        | Auth          | Rate Limit | Input Source            |
|--------|-----------------------------------------------|------------------------------------|---------------|------------|-------------------------|
| POST   | /api/v1/reviews/{reviewId}/flag               | ReviewService.FlagReview           | authenticated | strict     | path params + JSON body |
| GET    | /api/v1/reviews/eligibility                   | ReviewService.GetReviewEligibility | authenticated | standard   | query params            |

### Admin

| Method | Path                                           | gRPC Method                        | Auth         | Rate Limit | Input Source            |
|--------|-------------------------------------------------|------------------------------------|--------------|------------|-------------------------|
| DELETE | /api/v1/admin/reviews/{reviewId}               | ReviewService.AdminRemoveReview    | role:admin   | strict     | path params + JSON body |
| GET    | /api/v1/admin/reviews/flagged                  | ReviewService.AdminListFlaggedReviews | role:support | standard | query params           |
| POST   | /api/v1/admin/reviews/{reviewId}/resolve-flag  | ReviewService.AdminResolveFlag     | role:support | standard   | path params + JSON body |

---

## 8. Trust Service (10 RPCs)

### Query

| Method | Path                                        | gRPC Method                       | Auth          | Rate Limit | Input Source            |
|--------|---------------------------------------------|-----------------------------------|---------------|------------|-------------------------|
| GET    | /api/v1/trust/{userId}                      | TrustService.GetTrustScore        | authenticated | standard   | path params             |
| GET    | /api/v1/trust/{userId}/history              | TrustService.GetTrustScoreHistory | authenticated | standard   | path params + query params |
| GET    | /api/v1/trust/tiers                         | TrustService.GetTierRequirements  | public        | standard   | query params            |

### Admin

| Method | Path                                          | gRPC Method                         | Auth       | Rate Limit | Input Source            |
|--------|-----------------------------------------------|-------------------------------------|------------|------------|-------------------------|
| POST   | /api/v1/admin/trust/{userId}/override         | TrustService.AdminOverrideTrustScore| role:admin | strict     | path params + JSON body |
| GET    | /api/v1/admin/trust/{userId}/breakdown        | TrustService.AdminGetTrustBreakdown | role:admin | standard   | path params             |

### Internal Only (not exposed through gateway)

| gRPC Method                          | Trigger                                    |
|--------------------------------------|--------------------------------------------|
| TrustService.ComputeTrustScore       | Called by ContractService on completion     |
| TrustService.BatchComputeTrustScores | Scheduled nightly batch recomputation      |
| TrustService.RecordFeedbackSignal    | Called by ReviewService on review creation  |
| TrustService.RecordVolumeSignal      | Called by ContractService on contract events|
| TrustService.RecordRiskSignal        | Called by FraudService on risk detection    |

---

## 9. Fraud Service (11 RPCs)

### Risk Profile

| Method | Path                                    | gRPC Method                     | Auth          | Rate Limit | Input Source |
|--------|-----------------------------------------|---------------------------------|---------------|------------|--------------|
| GET    | /api/v1/fraud/risk/{userId}             | FraudService.GetUserRiskProfile | role:admin    | standard   | path params  |

### Admin

| Method | Path                                             | gRPC Method                         | Auth       | Rate Limit | Input Source            |
|--------|--------------------------------------------------|-------------------------------------|------------|------------|-------------------------|
| GET    | /api/v1/admin/fraud/alerts                       | FraudService.AdminListFraudAlerts   | role:admin | standard   | query params            |
| POST   | /api/v1/admin/fraud/alerts/{alertId}/review      | FraudService.AdminReviewFraudAlert  | role:admin | standard   | path params + JSON body |
| GET    | /api/v1/admin/fraud/dashboard                    | FraudService.AdminGetFraudDashboard | role:admin | standard   | query params            |

### Internal Only (not exposed through gateway)

| gRPC Method                        | Trigger                                           |
|------------------------------------|---------------------------------------------------|
| FraudService.CheckTransaction      | Called by PaymentService before processing payment |
| FraudService.CheckRegistration     | Called by UserService during registration          |
| FraudService.CheckBid              | Called by BidService on bid placement              |
| FraudService.RecordSignal          | Called by various services on suspicious activity  |
| FraudService.BatchRecordSignals    | Called by analytics pipeline                       |
| FraudService.RecordSession         | Called by gateway middleware on each request        |
| FraudService.GetSessionHistory     | Called by FraudService.CheckTransaction internally |

---

## 10. Notification Service (12 RPCs)

### In-App Notifications

| Method | Path                                         | gRPC Method                           | Auth          | Rate Limit | Input Source            |
|--------|----------------------------------------------|---------------------------------------|---------------|------------|-------------------------|
| GET    | /api/v1/notifications                        | NotificationService.ListNotifications | authenticated | standard   | query params            |
| POST   | /api/v1/notifications/{notificationId}/read  | NotificationService.MarkAsRead        | authenticated | standard   | path params             |
| POST   | /api/v1/notifications/read-all               | NotificationService.MarkAllAsRead     | authenticated | standard   | JSON body               |
| GET    | /api/v1/notifications/unread-count           | NotificationService.GetUnreadCount    | authenticated | standard   | query params            |

### Devices

| Method | Path                                   | gRPC Method                           | Auth          | Rate Limit | Input Source |
|--------|----------------------------------------|---------------------------------------|---------------|------------|--------------|
| POST   | /api/v1/notifications/devices          | NotificationService.RegisterDevice    | authenticated | standard   | JSON body    |
| DELETE | /api/v1/notifications/devices/{deviceId}| NotificationService.UnregisterDevice  | authenticated | standard   | path params  |

### Preferences

| Method | Path                                  | gRPC Method                           | Auth          | Rate Limit | Input Source |
|--------|---------------------------------------|---------------------------------------|---------------|------------|--------------|
| GET    | /api/v1/notifications/preferences     | NotificationService.GetPreferences    | authenticated | standard   | query params |
| PATCH  | /api/v1/notifications/preferences     | NotificationService.UpdatePreferences | authenticated | standard   | JSON body    |

### Unsubscribe

| Method | Path                                  | gRPC Method                       | Auth   | Rate Limit | Input Source |
|--------|---------------------------------------|-----------------------------------|--------|------------|--------------|
| GET    | /api/v1/notifications/unsubscribe     | NotificationService.Unsubscribe   | public | standard   | query params (signed token) |

### Internal Only (not exposed through gateway)

| gRPC Method                              | Trigger                                    |
|------------------------------------------|--------------------------------------------|
| NotificationService.SendNotification     | Called by backend services on events        |
| NotificationService.SendBulkNotification | Called by admin tools or scheduled jobs     |

---

## 11. Imaging Service (10 RPCs)

### Upload Flow

| Method | Path                                   | gRPC Method                   | Auth          | Rate Limit | Input Source |
|--------|----------------------------------------|-------------------------------|---------------|------------|--------------|
| POST   | /api/v1/images/upload-url              | ImagingService.GetUploadURL   | authenticated | standard   | JSON body    |
| POST   | /api/v1/images/confirm-upload          | ImagingService.ConfirmUpload  | authenticated | standard   | JSON body    |

### Context-Specific Processing

| Method | Path                                   | gRPC Method                          | Auth           | Rate Limit | Input Source |
|--------|----------------------------------------|--------------------------------------|----------------|------------|--------------|
| POST   | /api/v1/images/job-photos              | ImagingService.ProcessJobPhotos      | role:customer  | standard   | JSON body    |
| POST   | /api/v1/images/portfolio               | ImagingService.ProcessPortfolioImage | role:provider  | standard   | JSON body    |
| POST   | /api/v1/images/avatar                  | ImagingService.ProcessAvatar         | authenticated  | standard   | JSON body    |
| POST   | /api/v1/images/document                | ImagingService.ProcessDocument       | role:provider  | standard   | JSON body    |

### Internal Only (not exposed through gateway)

| gRPC Method                        | Trigger                                         |
|------------------------------------|-------------------------------------------------|
| ImagingService.ProcessImage        | Called internally after ConfirmUpload            |
| ImagingService.GenerateThumbnail   | Called internally during image processing        |
| ImagingService.BatchProcessImages  | Called by scheduled job for bulk reprocessing    |

---

## 12. Subscription Service (12 RPCs)

### Tiers (Public)

| Method | Path                                  | gRPC Method                         | Auth   | Rate Limit | Input Source |
|--------|---------------------------------------|-------------------------------------|--------|------------|--------------|
| GET    | /api/v1/subscriptions/tiers           | SubscriptionService.ListTiers       | public | standard   | query params |
| GET    | /api/v1/subscriptions/tiers/{tierId}  | SubscriptionService.GetTier         | public | standard   | path params  |

### Subscription Management

| Method | Path                                          | gRPC Method                              | Auth          | Rate Limit | Input Source            |
|--------|-----------------------------------------------|------------------------------------------|---------------|------------|-------------------------|
| POST   | /api/v1/subscriptions                         | SubscriptionService.CreateSubscription   | authenticated | strict     | JSON body               |
| GET    | /api/v1/subscriptions/me                      | SubscriptionService.GetSubscription      | authenticated | standard   | query params            |
| POST   | /api/v1/subscriptions/me/cancel               | SubscriptionService.CancelSubscription   | authenticated | strict     | JSON body               |
| POST   | /api/v1/subscriptions/me/change-tier          | SubscriptionService.ChangeSubscriptionTier| authenticated| strict     | JSON body               |

### Usage & Access

| Method | Path                                          | gRPC Method                            | Auth          | Rate Limit | Input Source |
|--------|-----------------------------------------------|----------------------------------------|---------------|------------|--------------|
| GET    | /api/v1/subscriptions/me/usage                | SubscriptionService.GetUsage           | authenticated | standard   | query params |
| GET    | /api/v1/subscriptions/me/feature-access       | SubscriptionService.CheckFeatureAccess | authenticated | standard   | query params |

### Billing

| Method | Path                                          | gRPC Method                        | Auth          | Rate Limit | Input Source |
|--------|-----------------------------------------------|------------------------------------|---------------|------------|--------------|
| GET    | /api/v1/subscriptions/me/invoices             | SubscriptionService.ListInvoices   | authenticated | standard   | query params |

### Webhook

| Method | Path                                          | gRPC Method                                  | Auth   | Rate Limit | Input Source |
|--------|-----------------------------------------------|----------------------------------------------|--------|------------|--------------|
| POST   | /api/v1/webhooks/subscription                 | SubscriptionService.HandleSubscriptionWebhook| public | none       | JSON body (Stripe signature verified) |

### Admin

| Method | Path                                                  | gRPC Method                              | Auth       | Rate Limit | Input Source            |
|--------|-------------------------------------------------------|------------------------------------------|------------|------------|-------------------------|
| GET    | /api/v1/admin/subscriptions                           | SubscriptionService.AdminListSubscriptions| role:admin | standard   | query params            |
| PATCH  | /api/v1/admin/subscriptions/tiers/{tierId}            | SubscriptionService.AdminUpdateTier      | role:admin | strict     | path params + JSON body |
| POST   | /api/v1/admin/subscriptions/{userId}/grant            | SubscriptionService.AdminGrantSubscription| role:admin | strict     | path params + JSON body |

---

## 13. Analytics Service (10 RPCs)

### Market

| Method | Path                                    | gRPC Method                          | Auth          | Rate Limit | Input Source |
|--------|-----------------------------------------|--------------------------------------|---------------|------------|--------------|
| GET    | /api/v1/analytics/market/range          | AnalyticsService.GetMarketRange      | authenticated | standard   | query params |
| GET    | /api/v1/analytics/market/trends         | AnalyticsService.GetMarketTrends     | authenticated | standard   | query params |

### Provider

| Method | Path                                        | gRPC Method                            | Auth           | Rate Limit | Input Source |
|--------|---------------------------------------------|----------------------------------------|----------------|------------|--------------|
| GET    | /api/v1/analytics/provider/overview         | AnalyticsService.GetProviderAnalytics  | role:provider  | standard   | query params |
| GET    | /api/v1/analytics/provider/earnings         | AnalyticsService.GetProviderEarnings   | role:provider  | standard   | query params |

### Customer

| Method | Path                                        | gRPC Method                            | Auth           | Rate Limit | Input Source |
|--------|---------------------------------------------|----------------------------------------|----------------|------------|--------------|
| GET    | /api/v1/analytics/customer/spending         | AnalyticsService.GetCustomerSpending   | role:customer  | standard   | query params |

### Platform (Admin)

| Method | Path                                        | gRPC Method                              | Auth       | Rate Limit | Input Source |
|--------|---------------------------------------------|------------------------------------------|------------|------------|--------------|
| GET    | /api/v1/admin/analytics/platform            | AnalyticsService.GetPlatformMetrics      | role:admin | standard   | query params |
| GET    | /api/v1/admin/analytics/growth              | AnalyticsService.GetGrowthMetrics        | role:admin | standard   | query params |
| GET    | /api/v1/admin/analytics/categories          | AnalyticsService.GetCategoryMetrics      | role:admin | standard   | query params |
| GET    | /api/v1/admin/analytics/geographic          | AnalyticsService.GetGeographicMetrics    | role:admin | standard   | query params |

### Internal Only (not exposed through gateway)

| gRPC Method                          | Trigger                                       |
|--------------------------------------|-----------------------------------------------|
| AnalyticsService.RecordTransaction   | Called by PaymentService on payment completion |
| AnalyticsService.RecordEvent         | Called by all services on significant events   |

---

## WebSocket Connections

| Protocol  | Path                    | Backend                   | Auth          | Description                              |
|-----------|-------------------------|---------------------------|---------------|------------------------------------------|
| WebSocket | /api/v1/ws/chat         | ChatService (streaming)   | authenticated | Real-time chat messages and typing indicators. Client sends JSON frames; server pushes new messages, typing events, and read receipts. |
| WebSocket | /api/v1/ws/notifications| NotificationService       | authenticated | Real-time push for in-app notifications and unread count updates. |

### WebSocket Chat Frame Types

**Client to Server:**
```json
{ "type": "message", "channelId": "...", "content": "..." }
{ "type": "typing", "channelId": "..." }
{ "type": "read", "channelId": "...", "messageId": "..." }
```

**Server to Client:**
```json
{ "type": "message", "channelId": "...", "message": { ... } }
{ "type": "typing", "channelId": "...", "userId": "..." }
{ "type": "read_receipt", "channelId": "...", "userId": "...", "messageId": "..." }
```

---

## Internal Service-to-Service RPCs (Full Summary)

These RPCs are called directly between backend microservices over gRPC. They are **not** exposed through the REST gateway.

| gRPC Method                              | Calling Service                        |
|------------------------------------------|----------------------------------------|
| BidService.ExpireAuction                 | Scheduler / JobService                 |
| BidService.CheckAuctionDeadlines         | Cron (every minute)                    |
| TrustService.ComputeTrustScore           | ContractService                        |
| TrustService.BatchComputeTrustScores     | Nightly batch job                      |
| TrustService.RecordFeedbackSignal        | ReviewService                          |
| TrustService.RecordVolumeSignal          | ContractService                        |
| TrustService.RecordRiskSignal            | FraudService                           |
| FraudService.CheckTransaction            | PaymentService                         |
| FraudService.CheckRegistration           | UserService                            |
| FraudService.CheckBid                    | BidService                             |
| FraudService.RecordSignal                | Various services                       |
| FraudService.BatchRecordSignals          | Analytics pipeline                     |
| FraudService.RecordSession               | Gateway middleware                     |
| FraudService.GetSessionHistory           | FraudService (internal)                |
| NotificationService.SendNotification     | All backend services                   |
| NotificationService.SendBulkNotification | Admin tools / scheduled jobs           |
| ImagingService.ProcessImage              | ImagingService (post-upload)           |
| ImagingService.GenerateThumbnail         | ImagingService (during processing)     |
| ImagingService.BatchProcessImages        | Scheduled reprocessing job             |
| AnalyticsService.RecordTransaction       | PaymentService                         |
| AnalyticsService.RecordEvent             | All backend services                   |

---

## Route Totals

| Service              | Public Routes | Internal RPCs | Total RPCs |
|----------------------|---------------|---------------|------------|
| UserService          | 36            | 0             | 36         |
| JobService           | 21            | 0             | 21         |
| BidService           | 10            | 2             | 12         |
| ContractService      | 26            | 0             | 26         |
| PaymentService       | 18            | 0             | 18         |
| ChatService          | 11            | 0             | 11         |
| ReviewService        | 11            | 0             | 11         |
| TrustService         | 5             | 5             | 10         |
| FraudService         | 4             | 7             | 11         |
| NotificationService  | 10            | 2             | 12         |
| ImagingService       | 6             | 4             | 10         |
| SubscriptionService  | 12            | 0             | 12         |
| AnalyticsService     | 9             | 2             | 10*        |
| **Total**            | **179**       | **22**        | **200**    |

\* AnalyticsService has 10 RPCs total: 8 query endpoints exposed via REST + 1 admin endpoint (GetGeographicMetrics) + 2 internal ingestion RPCs. The 9 public routes include all market, provider, customer, and platform admin analytics endpoints.

---

## Notes

1. **Path parameters** use `{camelCase}` naming (e.g., `{jobId}`, `{contractId}`).
2. **Query parameters** follow `snake_case` convention (e.g., `?page_size=20&page_token=abc`).
3. **Pagination** uses cursor-based pagination with `page_token` and `page_size` query params on all list endpoints.
4. **Stripe webhooks** bypass JWT auth but verify the `Stripe-Signature` header against the webhook signing secret.
5. **Subscription webhooks** also verify Stripe signatures for billing events.
6. **Admin routes** are grouped under `/api/v1/admin/` for clarity and middleware grouping.
7. **The `/me` convention** is used for current-user endpoints; the gateway resolves `me` to the authenticated user's ID from the JWT before forwarding to gRPC.
8. **Rate limit tiers** are enforced by gateway middleware before the request reaches the gRPC backend.
9. **Internal RPCs** are accessible only within the cluster network (no gateway route, no public ingress).
10. **WebSocket connections** require an initial HTTP upgrade with a valid JWT in the `Authorization` header or `token` query parameter.
