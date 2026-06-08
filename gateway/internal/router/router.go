package router

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/handler"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// New creates and configures the HTTP router with all middleware and routes.
// When production is true, HSTS headers are applied and wildcard CORS origins are rejected.
//
// dbPool is used by per-route ownership middleware (RequireOwnership /
// RequirePartyAccess / RequireJoinedPartyAccess) to verify that the
// authenticated user owns or is a party to the resource identified by the
// URL path parameter. Required.
func New(
	allowedOrigins []string,
	production bool,
	dbPool *pgxpool.Pool,
	cacheClient *cache.Client,
	rateLimiter *middleware.RateLimiter,
	authMW *middleware.AuthMiddleware,
	authHandler *handler.AuthHandler,
	userHandler *handler.UserHandler,
	providerHandler *handler.ProviderHandler,
	categoriesHandler *handler.CategoriesHandler,
	jobHandler *handler.JobHandler,
	bidHandler *handler.BidHandler,
	contractHandler *handler.ContractHandler,
	paymentHandler *handler.PaymentHandler,
	webhookHandler *handler.WebhookHandler,
	chatHandler *handler.ChatHandler,
	reviewHandler *handler.ReviewHandler,
	trustHandler *handler.TrustHandler,
	fraudHandler *handler.FraudHandler,
	notificationHandler *handler.NotificationHandler,
	imageHandler *handler.ImageHandler,
	subscriptionHandler *handler.SubscriptionHandler,
	analyticsHandler *handler.AnalyticsHandler,
	adminUsersHandler *handler.AdminUsersHandler,
	adminVerificationHandler *handler.AdminVerificationHandler,
	adminJobsHandler *handler.AdminJobsHandler,
	adminDisputesHandler *handler.AdminDisputesHandler,
	adminReviewsHandler *handler.AdminReviewsHandler,
	adminPaymentsHandler *handler.AdminPaymentsHandler,
	adminBankingHandler *handler.AdminBankingHandler,
	adminPlatformHandler *handler.AdminPlatformHandler,
	propertyHandler *handler.PropertyHandler,
	verificationHandler *handler.VerificationHandler,
	workingCapitalHandler *handler.WorkingCapitalHandler,
	expenseHandler *handler.ExpenseHandler,
	taxHandler *handler.TaxHandler,
	auctionWSHandler *handler.AuctionWSHandler,
	spectatorWSHandler *handler.SpectatorWSHandler,
	marketplaceSpectatorWSHandler *handler.MarketplaceSpectatorWSHandler,
	featureFlagHandler *handler.FeatureFlagHandler,
	pricingHandler *handler.PricingHandler,
	oauthHandler *handler.OAuthHandler,
	auctionReplayHandler *handler.AuctionReplayHandler,
	challengeHandler *handler.ChallengeHandler,
	installmentHandler *handler.InstallmentHandler,
	insuranceHandler *handler.InsuranceHandler,
	workspaceHandler *handler.WorkspaceHandler,
	instantMatchHandler *handler.InstantMatchHandler,
	disputeHandler *handler.DisputeHandler,
	employeesHandler *handler.EmployeesHandler,
	adminMarketplaceHandler *handler.AdminMarketplaceHandler,
	listingOrdersHandler *handler.ListingOrdersHandler,
	listingsHandler *handler.ListingsHandler,
	watchlistHandler *handler.WatchlistHandler,
	followsHandler *handler.FollowsHandler,
	listingsSearchHandler *handler.ListingsSearchHandler,
	pushSubscriptionsHandler *handler.PushSubscriptionsHandler,
	complianceHandler *handler.ComplianceHandler,
	bidBondHandler *handler.BidBondHandler,
	offersHandler *handler.OffersHandler,
	listingReplayHandler *handler.ListingReplayHandler,
	chatRelayHandler *handler.ChatRelayHandler,
	userBlocksHandler *handler.UserBlocksHandler,
	chatTemplatesHandler *handler.ChatTemplatesHandler,
	referralsHandler *handler.ReferralsHandler,
	sellerAnalyticsHandler *handler.SellerAnalyticsHandler,
	promotedListingsHandler *handler.PromotedListingsHandler,
	csvExportHandler *handler.CSVExportHandler,
	categoryQuestionsHandler *handler.CategoryQuestionsHandler,
	quoteTemplatesHandler *handler.QuoteTemplatesHandler,
	contractTipHandler *handler.ContractTipHandler,
	calendarExportHandler *handler.CalendarExportHandler,
) *chi.Mux {
	r := chi.NewRouter()

	// Global middleware stack
	r.Use(middleware.Recovery)
	r.Use(middleware.Metrics)
	r.Use(middleware.Logging)
	r.Use(middleware.CORS(allowedOrigins, production))
	r.Use(middleware.SecurityHeaders(production))
	r.Use(rateLimiter.Middleware)

	// Observability endpoints (public, no auth).
	// /healthz   — liveness: always returns 200 if the process can respond.
	// /readyz    — readiness: 200 only if backend dependencies are reachable.
	// /metrics   — Prometheus exposition.
	// /health    — legacy alias (kept for backward compatibility with older
	//              load balancer configs and the launch-checklist smoke tests).
	r.Get("/healthz", healthHandler)
	r.Get("/health", healthHandler)
	r.Get("/readyz", readinessHandler(dbPool, cacheClient))
	r.Handle("/metrics", promhttp.Handler())

	// Public auth routes (no auth middleware)
	r.Route("/api/v1/auth", func(r chi.Router) {
		r.Post("/register", authHandler.Register)
		r.Post("/login", authHandler.Login)
		r.Post("/refresh", authHandler.Refresh)
		r.Post("/verify-email", authHandler.VerifyEmail)
		r.Post("/resend-verification", authHandler.ResendVerification)
		r.Post("/request-password-reset", authHandler.RequestPasswordReset)
		r.Post("/reset-password", authHandler.ResetPassword)

		// OAuth routes (public, no auth required).
		r.Get("/oauth/google", oauthHandler.InitGoogleOAuth)
		r.Get("/callback/google", oauthHandler.GoogleOAuthCallback)
		r.Get("/oauth/apple", oauthHandler.InitAppleOAuth)
		r.Post("/callback/apple", oauthHandler.AppleOAuthCallback)
		r.Get("/oauth/facebook", oauthHandler.InitFacebookOAuth)
		r.Get("/callback/facebook", oauthHandler.FacebookOAuthCallback)

		// Phone-only signup. Body: { phone, otp_code }. Verifies an OTP
		// the client requested via a separate (anonymous) phone-OTP path
		// and returns the standard token pair. Migration note: this path
		// synthesizes a placeholder email until user-service ships a
		// dedicated RegisterByPhone RPC — see auth.go::RegisterPhoneOnly.
		r.Post("/register-phone", authHandler.RegisterPhoneOnly)

		// MFA verify does not require auth (uses challenge token from login).
		r.Post("/mfa/verify", authHandler.VerifyMFA)

		// Logout and phone verification require authentication.
		r.With(authMW.Handler).Post("/logout", authHandler.Logout)
		r.With(authMW.Handler).Post("/verify-phone", authHandler.VerifyPhone)
		r.With(authMW.Handler).Post("/send-phone-otp", authHandler.SendPhoneOTP)

		// MFA enable/disable/confirm require authentication.
		r.With(authMW.Handler).Post("/mfa/enable", authHandler.EnableMFA)
		r.With(authMW.Handler).Post("/mfa/verify-setup", authHandler.ConfirmMFASetup)
		r.With(authMW.Handler).Delete("/mfa/disable", authHandler.DisableMFA)
	})

	// Public category routes (no auth required)
	r.Route("/api/v1/categories", func(r chi.Router) {
		r.Get("/", categoriesHandler.List)
		r.Get("/tree", categoriesHandler.Tree)
		// Pre-quote questions are public so the post-job form can render
		// them before the visitor authenticates (Wave 5 audit Section H).
		r.Get("/{id}/questions", categoryQuestionsHandler.ListByCategory)
	})

	// iCal feed — auth via cookie OR ?token= so calendar-app subscriptions
	// (Apple Calendar, Google, Outlook) work without forwarding cookies.
	// The handler authorises internally; mounted outside the auth-required
	// block so the optional-token branch is reachable.
	r.Get("/api/v1/me/calendar.ics", calendarExportHandler.ExportICS)

	// All job routes in one group (mix of public and authenticated)
	r.Route("/api/v1/jobs", func(r chi.Router) {
		// Public
		r.Get("/", jobHandler.Search)
		r.Get("/map", jobHandler.MapView)
		r.Get("/{id}", optionalAuth(authMW, jobHandler.GetJob))
		r.With(authMW.Handler).Get("/{id}/bids", bidHandler.ListBidsForJob)
		r.Get("/{id}/bids/count", bidHandler.GetBidCount)

		// Authenticated
		r.With(authMW.Handler).Get("/mine", jobHandler.ListMine)
		r.With(authMW.Handler).Get("/drafts", jobHandler.ListDrafts)
		r.With(authMW.Handler).Post("/", jobHandler.Create)
		r.With(authMW.Handler).Patch("/{id}", jobHandler.Update)
		r.With(authMW.Handler).Delete("/{id}", jobHandler.Delete)
		r.With(authMW.Handler).Post("/{id}/publish", jobHandler.Publish)
		r.With(authMW.Handler).Post("/{id}/close", jobHandler.Close)
		r.With(authMW.Handler).Post("/{id}/cancel", jobHandler.Cancel)
		r.With(authMW.Handler).Post("/{id}/bids", bidHandler.PlaceBid)
		r.With(authMW.Handler).Post("/{id}/bids/accept-offer", bidHandler.AcceptOffer)
		r.With(authMW.Handler).Post("/{id}/bids/{bidID}/award", bidHandler.AwardBid)

		// Viewer count (ping requires auth, count is public)
		r.With(authMW.Handler).Post("/{id}/ping-viewer", jobHandler.PingViewer)
		r.Get("/{id}/viewer-count", jobHandler.GetViewerCount)

		// Instant match
		r.With(authMW.Handler).Post("/{id}/instant-match", instantMatchHandler.CreateInstantMatch)

		// Live auction endpoints — public (optional auth) so logged-out
		// visitors can spectate live auctions (drives excitement). The
		// handlers don't read claims; matches the public job-detail route.
		r.Get("/{id}/auction/state", optionalAuth(authMW, bidHandler.GetLiveAuctionState))
		r.Get("/{id}/auction/events", optionalAuth(authMW, bidHandler.GetAuctionEvents))

		// Pre-quote answers (Wave 5 audit Section H). Auth-bound:
		// the handler enforces customer-only writes and customer +
		// bidding-provider reads so the question payload can be quoted
		// against accurately.
		r.With(authMW.Handler).Post("/{id}/answers", categoryQuestionsHandler.SubmitAnswers)
		r.With(authMW.Handler).Get("/{id}/answers", categoryQuestionsHandler.GetAnswers)
	})

	// Public trust tier requirements (no auth required)
	r.Route("/api/v1/trust", func(r chi.Router) {
		r.Get("/tiers", trustHandler.GetTierRequirements)
	})

	// Public webhook routes (no auth, verified by Stripe signature via stripe.webhooks.constructEvent)
	r.Route("/api/v1/webhooks", func(r chi.Router) {
		r.Post("/stripe", webhookHandler.HandleStripeWebhook)
		r.Post("/subscription", webhookHandler.HandleSubscriptionWebhook)
	})

	// Public subscription tier routes (no auth required)
	r.Route("/api/v1/subscriptions/tiers", func(r chi.Router) {
		r.Get("/", subscriptionHandler.ListTiers)
		r.Get("/{id}", subscriptionHandler.GetTier)
	})

	// Public notification unsubscribe (token-based, no auth required)
	r.Post("/api/v1/notifications/unsubscribe", notificationHandler.Unsubscribe)

	// Public provider search (no auth required)
	r.Get("/api/v1/providers/search", providerHandler.SearchProviders)

	// Public feature flags (no auth required)
	r.Get("/api/v1/flags", featureFlagHandler.GetFeatureFlags)

	// Public Fair Price Index routes (no auth required, SEO-friendly)
	r.Get("/api/v1/pricing", pricingHandler.GetPricingOverview)
	r.Get("/api/v1/pricing/{category}", pricingHandler.GetPricingByCategory)

	// Public insurance products (no auth required)
	r.Get("/api/v1/insurance/products", insuranceHandler.ListProducts)

	// Public auction replay (no auth required — completed auctions are public)
	r.Get("/api/v1/auctions/{jobId}/replay", auctionReplayHandler.GetAuctionReplay)

	// ── Compliance: cookie-consent log + ToS surface ──────────────────
	// POST /api/v1/cookie-consent is public (anonymous visitors trigger
	// the banner); GET /api/v1/tos/current is public so signup/login
	// can render the legal link before auth. The authenticated half of
	// this surface (POST /me/tos-acceptance, PUT /me/dob) lives inside
	// the protected /api/v1 block below.
	r.Post("/api/v1/cookie-consent", complianceHandler.LogCookieConsent)
	r.Get("/api/v1/tos/current", complianceHandler.GetCurrentToS)

	// Public "report this listing" endpoint — anonymous visitors can flag a
	// listing as stolen/counterfeit/prohibited. Rate-limited by the global
	// IP rate limiter; logged-in users get a duplicate-suppression check
	// inside the handler. The trigger on listing_reports auto-hides a
	// listing once ≥3 open reports exist.
	r.Post("/api/v1/listings/{id}/report", adminMarketplaceHandler.CreateReport)

	// ── Public marketplace browse + spectator surface ──────────────────
	// The whole point of the wedge: anonymous visitors land on the
	// scoreboard at `/marketplace`, watch live auctions, and ping for
	// watcher counts. Bid placement (POST .../bid) is auth-gated and
	// lives inside the protected /api/v1 block below.
	r.Get("/api/v1/listings", listingsHandler.ListListings)
	// Search-as-you-type + similar rails (Meilisearch-backed). Registered
	// before `/listings/{id}` so chi's literal-segment match wins over
	// the {id} wildcard. Both are public (no auth) — typeahead UX must
	// be reachable from the anonymous landing surface.
	r.Get("/api/v1/listings/autocomplete", listingsSearchHandler.Autocomplete)
	r.Get("/api/v1/listings/{id}/similar", listingsSearchHandler.Similar)
	// Authenticated static-segment reads must be registered with their inline
	// auth middleware BEFORE the public `/listings/{id}` wildcard. chi merges
	// the /listings subtree across route blocks, so if these lived only inside
	// the protected /api/v1 block below, the literal `mine` / `bids/mine` nodes
	// would resolve without the auth middleware and the handler would see empty
	// claims → 401. Mirrors the /jobs/{id} (public) vs /jobs/mine (protected)
	// convention above.
	r.With(authMW.Handler).Get("/api/v1/listings/mine", listingsHandler.MyListings)
	r.With(authMW.Handler).Get("/api/v1/listings/bids/mine", listingsHandler.MyListingBids)
	r.Get("/api/v1/listings/{id}", listingsHandler.GetListing)
	r.Get("/api/v1/listings/{id}/bids", listingsHandler.GetListingBids)
	// Goods-side auction replay — public, mirrors the services-side
	// /api/v1/auctions/{jobId}/replay surface. PII-stripped.
	r.Get("/api/v1/listings/{id}/replay", listingReplayHandler.GetListingReplay)
	r.Post("/api/v1/listings/{id}/ping-viewer", listingsHandler.PingViewer)

	// Public followers list — anyone can see who follows a seller (mirrors
	// Whatnot/Twitter social-proof surface). Auth-gated follow/unfollow,
	// my-follows, and my-feed live inside the protected /api/v1 block below.
	r.Get("/api/v1/users/{id}/followers", followsHandler.ListFollowers)

	// Market analytics routes (require authentication)
	r.Route("/api/v1/analytics/market", func(r chi.Router) {
		r.Use(authMW.Handler)
		r.Get("/range", analyticsHandler.GetMarketRange)
		r.Get("/trends", analyticsHandler.GetMarketTrends)
	})

	// Protected API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(authMW.Handler)

		r.Route("/users", func(r chi.Router) {
			r.Get("/me", userHandler.GetMe)
			r.Patch("/me", userHandler.UpdateMe)
			r.Post("/me/roles", userHandler.EnableRole)
			r.Get("/me/savings", userHandler.GetSavings)
			// GDPR / CCPA right-to-erasure pipeline.
			r.Delete("/me", userHandler.RequestMyDeletion)
			r.Post("/me/restore", userHandler.RestoreMyAccount)
			r.Get("/{id}", userHandler.GetUser)
			r.Get("/{id}/reviews", reviewHandler.ListReviewsForUser)
			r.Get("/{id}/trust-score", trustHandler.GetTrustScore)
			r.Get("/{id}/trust-history", trustHandler.GetTrustScoreHistory)
		})

		// ── Web Push subscriptions (PWA / W3C Web Push) ─────────────────
		// Closes audit Section J's "FCM-only push" gap — buyers running
		// the installed PWA register a PushSubscription here. Coexists
		// with /notifications/devices (FCM/APNs); the notification
		// service iterates both lists when fanning a notification out.
		r.Post("/me/push-subscriptions", pushSubscriptionsHandler.Subscribe)
		r.Delete("/me/push-subscriptions/{id}", pushSubscriptionsHandler.Unsubscribe)

		// ── Compliance (auth half) ─────────────────────────────────────
		// ToS re-acceptance: the web client polls GET /api/v1/tos/current
		// (public) and compares against the user's last-accepted version
		// from GET /me/tos-acceptance. If they differ, render the modal
		// and POST the new version to /me/tos-acceptance.
		//
		// Age gate: PUT /me/dob accepts a YYYY-MM-DD DOB and stamps
		// users.dob_verified_at. DOB is never returned via GET; only the
		// "verified" boolean is exposed via /me/age-status.
		r.Get("/me/tos-acceptance", complianceHandler.GetMyToSAcceptance)
		r.Post("/me/tos-acceptance", complianceHandler.AcceptToS)
		r.Put("/me/dob", complianceHandler.SetDOB)
		r.Get("/me/age-status", complianceHandler.GetMyAgeStatus)

		// ── Bid bond pre-auth (anti-fraud) ─────────────────────────────
		// First-time bidders post a Stripe SetupIntent-based bond before
		// their first bid is accepted. The bond is released the moment
		// they complete OR lose the auction (released → trusted forever).
		// Captured on confirmed no-show. eBay/Whatnot ship this; we now do too.
		r.Post("/listings/{id}/bid-bond", bidBondHandler.CreateBidBond)
		r.Post("/listings/{id}/bid-bond/confirm", bidBondHandler.ConfirmBidBond)

		// ── Followable seller (Whatnot retention mechanic) ──────────────
		// Mirrors the watchlist surface in shape: per-target follow toggle
		// + an authenticated my-follows list and an activity feed of the
		// followed sellers' active auctions. The public followers list is
		// mounted above the auth boundary because anyone (including
		// anonymous visitors) can read social proof on a seller profile.
		r.Post("/users/{id}/follow", followsHandler.Follow)
		r.Delete("/users/{id}/follow", followsHandler.Unfollow)
		r.Get("/me/follows", followsHandler.MyFollows)
		r.Get("/me/feed", followsHandler.MyFeed)

		// ── Referral program (onboarding/growth) ────────────────────────
		// Migration 048 + handler/referrals.go. Code is auto-generated on
		// first GET; redemption is one-shot per redeemer; the credit
		// ledger funds the $10/$10 split that activates on the redeemer's
		// first completed transaction.
		r.Get("/me/referrals/code", referralsHandler.GetMyReferralCode)
		r.Post("/me/referrals/redeem", referralsHandler.RedeemReferralCode)
		r.Get("/me/referrals", referralsHandler.ListMyReferrals)

		// ── NPS surveys (post-transaction) ──────────────────────────────
		// The notification scheduler queues a row in `nps_surveys` 48h
		// after a contract or listing-order completes. The web mounts an
		// <NPSSurvey> modal when /me/nps/pending returns ≥1 row; submitting
		// the modal POSTs to /me/nps/{id}.
		r.Get("/me/nps/pending", referralsHandler.ListPendingNPS)
		r.Post("/me/nps/{id}", referralsHandler.SubmitNPS)

		r.Route("/providers", func(r chi.Router) {
			// Public-to-any-authed-user: viewing a provider's public profile.
			// NOT gated by RequireProvider — customers must be able to view
			// seller profiles.
			r.Get("/{id}", providerHandler.GetProvider)

			// Provider-SELF routes. A non-provider (e.g. a customer-only token)
			// must never reach these — gate the whole group with RequireProvider
			// (admin allowed through). Mirrors how RequireAdmin gates /admin.
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireProvider)

				r.Get("/me", providerHandler.GetMe)
				r.Patch("/me", providerHandler.UpdateMe)
				r.Put("/me/terms", providerHandler.SetGlobalTerms)
				r.Put("/me/categories", providerHandler.UpdateCategories)
				r.Put("/me/portfolio", providerHandler.UpdatePortfolio)
				r.Put("/me/availability", providerHandler.SetAvailability)
				r.Get("/me/streaks", providerHandler.GetStreaks)

				// Provider verification documents
				r.Post("/me/documents", verificationHandler.UploadDocument)
				r.Get("/me/documents", verificationHandler.ListDocuments)
				r.Get("/me/documents/{type}/status", verificationHandler.GetDocumentStatus)

				// Provider employees (team management).
				r.Get("/me/employees", employeesHandler.List)
				r.Post("/me/employees", employeesHandler.Create)
				r.Patch("/me/employees/{id}", employeesHandler.Update)
				r.Delete("/me/employees/{id}", employeesHandler.Delete)

				// Stripe Connect routes for providers
				r.Post("/me/stripe/account", paymentHandler.CreateStripeAccount)
				r.Get("/me/stripe/onboarding", paymentHandler.GetStripeOnboardingLink)
				r.Get("/me/stripe/status", paymentHandler.GetStripeAccountStatus)

				// Working Capital advances
				r.Route("/me/advances", func(r chi.Router) {
					r.Post("/", workingCapitalHandler.RequestAdvance)
					r.Get("/", workingCapitalHandler.ListMyAdvances)
					r.Get("/{id}", workingCapitalHandler.GetAdvance)
				})

				// Credit limit
				r.Get("/me/credit-limit", workingCapitalHandler.GetCreditLimit)

				// Expenses
				r.Route("/me/expenses", func(r chi.Router) {
					r.Post("/", expenseHandler.CreateExpense)
					r.Get("/", expenseHandler.ListExpenses)
					r.Delete("/{id}", expenseHandler.DeleteExpense)
				})

				// Tax Forms (1099-NEC)
				r.Route("/me/tax-forms", func(r chi.Router) {
					r.Get("/", taxHandler.ListTaxForms)
					r.Get("/{year}", taxHandler.GetTaxForm)
					r.Post("/{year}/generate", taxHandler.GenerateTaxForm)
					r.Get("/{year}/download", taxHandler.DownloadTaxForm)
				})

				// Reusable quote templates (Wave 5 audit Section H). Owner-bound
				// inside the handler — every endpoint scopes to the caller's
				// user_id so a provider can never see another's templates.
				r.Route("/me/quote-templates", func(r chi.Router) {
					r.Get("/", quoteTemplatesHandler.List)
					r.Post("/", quoteTemplatesHandler.Create)
					r.Patch("/{id}", quoteTemplatesHandler.Update)
					r.Delete("/{id}", quoteTemplatesHandler.Delete)
					r.Post("/{id}/use", quoteTemplatesHandler.IncrementUse)
				})
			})
		})

		// Property routes
		r.Route("/properties", func(r chi.Router) {
			r.Get("/", propertyHandler.List)
			r.Post("/", propertyHandler.Create)
			r.Put("/{id}", propertyHandler.Update)
			r.Delete("/{id}", propertyHandler.Delete)
		})

		// Bid routes not nested under a specific job
		r.Route("/bids", func(r chi.Router) {
			r.Get("/mine", bidHandler.ListMyBids)
			r.Get("/analytics", bidHandler.GetBidAnalytics)
			r.Get("/{id}", bidHandler.GetBid)
			r.Patch("/{id}", bidHandler.UpdateBid)
			r.Delete("/{id}", bidHandler.WithdrawBid)
		})

		// Contract routes
		r.Route("/contracts", func(r chi.Router) {
			r.Get("/", contractHandler.ListContracts)

			// All /{id}/* routes are gated by RequirePartyAccess: only the
			// contract's customer or provider (or admin) may access. Closes
			// the IDOR class the audit identified beyond jobs.
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequirePartyAccess(dbPool, middleware.PartyAccessConfig{
					Table: "contracts", Column1: "customer_id", Column2: "provider_id",
					IDColumn: "id", URLParam: "id",
				}))

				r.Get("/{id}", contractHandler.GetContract)
				r.Post("/{id}/accept", contractHandler.AcceptContract)
				r.Post("/{id}/start", contractHandler.StartWork)
				r.Post("/{id}/complete", contractHandler.MarkComplete)
				r.Post("/{id}/approve-completion", contractHandler.ApproveCompletion)
				r.Post("/{id}/cancel", contractHandler.CancelContract)
				r.Post("/{id}/reviews", reviewHandler.CreateReview)
				r.Get("/{id}/reviews/eligibility", reviewHandler.GetReviewEligibility)

				// Change orders
				r.Post("/{id}/change-orders", contractHandler.CreateChangeOrder)
				r.Get("/{id}/change-orders", contractHandler.ListChangeOrders)
				r.Put("/{id}/change-orders/{orderId}", contractHandler.RespondToChangeOrder)

				// Disputes
				r.Post("/{id}/disputes", contractHandler.OpenDispute)

				// Guarantee claims
				r.Post("/{id}/guarantee-claim", contractHandler.SubmitGuaranteeClaim)
				r.Get("/{id}/guarantee-claim", contractHandler.GetGuaranteeClaim)

				// No-show / abandonment
				r.Post("/{id}/report-noshow", contractHandler.ReportNoShow)
				r.Post("/{id}/report-abandonment", contractHandler.ReportAbandonment)

				// PDF export
				r.Get("/{id}/pdf", contractHandler.ExportPDF)

				// Invoice generation
				r.Post("/{id}/invoice", taxHandler.GenerateInvoice)
				r.Get("/{id}/invoice/download", taxHandler.DownloadInvoice)

				// Provider workspace (check-in/out, completion photos)
				r.Post("/{id}/checkin", workspaceHandler.CheckIn)
				r.Post("/{id}/checkout", workspaceHandler.CheckOut)
				r.Get("/{id}/work-session", workspaceHandler.GetWorkSession)
				r.Post("/{id}/completion-photos", workspaceHandler.UploadCompletionPhoto)

				// Post-completion tip / gratuity (Wave 5 audit Section H).
				// Customer-only enforcement is internal to the handler;
				// RequirePartyAccess above already screens out non-parties.
				r.Post("/{id}/tip", contractTipHandler.Tip)
			})
		})

		// Review routes — both reviewer and reviewee can read; only reviewer
		// can update/respond. Both parties bypass via RequirePartyAccess on
		// (reviewer_id, reviewee_id); handler enforces the writer-only check.
		r.Route("/reviews", func(r chi.Router) {
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequirePartyAccess(dbPool, middleware.PartyAccessConfig{
					Table: "reviews", Column1: "reviewer_id", Column2: "reviewee_id",
					IDColumn: "id", URLParam: "id",
				}))
				r.Get("/{id}", reviewHandler.GetReview)
				r.Post("/{id}/respond", reviewHandler.RespondToReview)
				r.Post("/{id}/flag", reviewHandler.FlagReview)
			})
		})

		// Milestone routes
		r.Route("/milestones", func(r chi.Router) {
			r.Post("/{id}/submit", contractHandler.SubmitMilestone)
			r.Post("/{id}/approve", contractHandler.ApproveMilestone)
			r.Post("/{id}/revision", contractHandler.RequestRevision)
		})

		// Marketplace listing-order routes — buyer-facing pickup confirmation
		// and dispute filing. Buyer auth is enforced by the handler (admin
		// can override confirm-pickup). Idempotency keys are NOT required
		// here because the underlying SQL transitions are themselves
		// idempotent (state-machine guards the transitions).
		// See docs/operations/marketplace-escrow.md for the lifecycle.
		r.Route("/orders", func(r chi.Router) {
			r.Post("/{id}/confirm-pickup", listingOrdersHandler.ConfirmPickup)
			r.Post("/{id}/file-dispute", listingOrdersHandler.FileListingDispute)
			// Wave 5 polish — mutual handshake + no-show counters.
			r.Post("/{id}/seller-confirm", listingOrdersHandler.SellerConfirm)
			r.Post("/{id}/report-no-show", listingOrdersHandler.ReportNoShow)
		})

		// ── Power-seller surface (Wave 5) ─────────────────────────────
		// Daily-revenue chart, sell-through pill, top categories, CSV
		// export, and paid promotions. The CSV is served directly from
		// the gateway (no payment service round-trip) since it's pure
		// SQL. Promotion charges flip listings.is_promoted via the
		// Stripe webhook on charge.success — see promoted_listings.go.
		r.Get("/me/seller-analytics", sellerAnalyticsHandler.GetSellerAnalytics)
		r.Get("/me/sales.csv", csvExportHandler.ExportSales)
		r.Post("/listings/{id}/promote", promotedListingsHandler.PromoteListing)
		r.Post("/listings/{id}/promote/confirm", promotedListingsHandler.ConfirmPromotion)

		// ── Marketplace buyer/seller write paths ────────────────────────
		// Read paths are public and live above. These routes require
		// authentication. Bid placement publishes a `listing:{id}` Redis
		// event consumed by the marketplace spectator WebSocket.
		//
		// Path conventions match the web client at web/src/hooks/useListings.ts:
		//   - /listings/mine            (the requesting user's listings)
		//   - /listings/bids/mine       (the requesting user's bid history)
		//   - /listings/{id}/bids       (place a bid; plural matches eBay/StockX)
		//
		// NOTE: The two GET reads (/listings/mine, /listings/bids/mine) are
		// registered above in the public block via r.With(authMW.Handler),
		// before the public /listings/{id} wildcard. Registering them here
		// instead let chi's merged /listings subtree resolve the literal
		// `mine` node without auth middleware → empty claims → 401.
		r.Post("/listings/{id}/bids", listingsHandler.PlaceListingBid)

		// Seller write paths — create, edit, cancel, delete-draft.
		// The web client at web/src/hooks/useListings.ts:101-153 calls
		// these endpoints. Implementation lives in handler/listings_write.go.
		r.Post("/listings", listingsHandler.CreateListing)
		r.Patch("/listings/{id}", listingsHandler.UpdateListing)
		r.Post("/listings/{id}/cancel", listingsHandler.CancelListing)
		r.Delete("/listings/{id}", listingsHandler.DeleteListingDraft)

		// Buy-It-Now closeout — buyer pays seller's pre-set fixed price,
		// auction flips to status='sold' and a listing_orders row is
		// created in escrow_status='held'. See listings_bid.go::BuyItNow.
		r.Post("/listings/{id}/buy-now", listingsHandler.BuyItNow)

		// 60-second eBay-style retraction window for the leading bidder.
		// Only status='active' bids placed within the last 60s qualify;
		// demoted bids cannot be undone. See listings_bid.go::RetractBid.
		r.Post("/listings/{id}/bids/{bidId}/retract", listingsHandler.RetractBid)

		// ── Best-Offer / counter-offer chain ────────────────────────────
		// Buyers post a sub-asking offer; sellers accept, reject, or
		// counter. Accept flips the listing to 'sold' and mints a
		// listing_orders row in the same tx (mirrors buy-now). See
		// handler/offers.go for the state machine.
		r.Post("/listings/{id}/offers", offersHandler.CreateOffer)
		r.Get("/listings/{id}/offers", offersHandler.ListOffersForListing)
		r.Patch("/offers/{id}", offersHandler.UpdateOffer)

		// ── Watchlist + saved searches (retention loop) ─────────────────
		// Buyers can favorite a listing without bidding ("watch") and
		// persist a SearchListingsParams payload as a saved search with
		// alert cadence. The notification scheduler in services/notification
		// reads listing_watchlist directly to fan closing-soon and outbid
		// events out to every watcher.
		r.Post("/listings/{id}/watch", watchlistHandler.Watch)
		r.Delete("/listings/{id}/watch", watchlistHandler.Unwatch)
		r.Get("/me/watchlist", watchlistHandler.MyWatchlist)
		r.Post("/me/saved-searches", watchlistHandler.CreateSavedSearch)
		r.Get("/me/saved-searches", watchlistHandler.ListSavedSearches)
		r.Delete("/me/saved-searches/{id}", watchlistHandler.DeleteSavedSearch)

		// Payment routes — all POST/PUT mutations require an Idempotency-Key.
		r.Route("/payments", func(r chi.Router) {
			r.Use(middleware.RequireIdempotencyKey(cacheClient))
			r.Post("/", paymentHandler.CreatePayment)
			r.Get("/", paymentHandler.ListPayments)
			r.Post("/setup-intent", paymentHandler.CreateSetupIntent)
			r.Get("/methods", paymentHandler.ListPaymentMethods)
			r.Post("/dev/methods", paymentHandler.AddDevPaymentMethod)
			r.Delete("/methods/{id}", paymentHandler.DeletePaymentMethod)
			r.Post("/calculate-fees", paymentHandler.CalculateFees)
			r.Post("/instant-payout", paymentHandler.InstantPayout)

			// /{id}/* mutations: only the payment's customer or provider may access.
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequirePartyAccess(dbPool, middleware.PartyAccessConfig{
					Table: "payments", Column1: "customer_id", Column2: "provider_id",
					IDColumn: "id", URLParam: "id",
				}))
				r.Get("/{id}", paymentHandler.GetPayment)
				r.Post("/{id}/process", paymentHandler.ProcessPayment)
				r.Post("/{id}/refund", paymentHandler.RefundPayment)
				r.Post("/{id}/release", paymentHandler.ReleasePayment)
			})

			// BNPL installment plan routes
			r.Route("/installment-plans", func(r chi.Router) {
				r.Post("/", installmentHandler.CreateInstallmentPlan)
				r.Get("/", installmentHandler.ListInstallmentPlans)
				r.Get("/{id}", installmentHandler.GetInstallmentPlan)
			})
		})

		// Insurance routes
		r.Route("/insurance", func(r chi.Router) {
			r.Post("/quote", insuranceHandler.GetQuote)
			r.Post("/purchase", insuranceHandler.PurchaseInsurance)
			r.Get("/policies", insuranceHandler.ListPolicies)
			r.Get("/policies/{id}", insuranceHandler.GetPolicy)
			r.Post("/claims", insuranceHandler.FileClaim)
			r.Get("/claims/{id}", insuranceHandler.GetClaim)
		})

		// Chat routes
		r.Route("/channels", func(r chi.Router) {
			r.Get("/", chatHandler.ListChannels)
			r.Get("/unread", chatHandler.GetUnreadCount)
			r.Get("/{id}", chatHandler.GetChannel)
			r.Get("/{id}/messages", chatHandler.ListMessages)
			r.Post("/{id}/messages", chatHandler.SendMessage)
			r.Post("/{id}/read", chatHandler.MarkRead)
		})

		// ── Communication polish (Wave 5 / Agent P) ─────────────────────
		// Chat relay aliases — anonymous email/phone, Craigslist-style.
		// /me/chat/aliases POST creates (or returns the existing) per-user
		// per-context proxy alias. GET lists aliases plus surfaces whether
		// the Twilio Proxy service is wired up (the UI hides "call" when
		// not). See chat_relay.go for the dev/prod contract.
		r.Post("/me/chat/aliases", chatRelayHandler.CreateAlias)
		r.Get("/me/chat/aliases", chatRelayHandler.ListAliases)

		// Per-user quick-reply templates. The chat composer reads
		// /me/chat/templates and merges with a built-in default list when
		// the user has no rows yet. /use bumps use_count so most-used
		// templates float to the top.
		r.Get("/me/chat/templates", chatTemplatesHandler.ListMyTemplates)
		r.Post("/me/chat/templates", chatTemplatesHandler.CreateTemplate)
		r.Patch("/me/chat/templates/{id}", chatTemplatesHandler.UpdateTemplate)
		r.Delete("/me/chat/templates/{id}", chatTemplatesHandler.DeleteTemplate)
		r.Post("/me/chat/templates/{id}/use", chatTemplatesHandler.UseTemplate)

		// Block / unblock + my-blocks list. The block path feeds the
		// SendMessage handler's block check, which returns 403 with
		// "blocked" before forwarding to the chat gRPC service.
		r.Post("/users/{id}/block", userBlocksHandler.Block)
		r.Delete("/users/{id}/block", userBlocksHandler.Unblock)
		r.Get("/me/blocks", userBlocksHandler.MyBlocks)

		// Image pipeline routes
		r.Route("/images", func(r chi.Router) {
			r.Post("/upload-url", imageHandler.GetUploadURL)
			r.Post("/confirm", imageHandler.ConfirmUpload)
			r.Post("/process", imageHandler.ProcessImage)
			r.Post("/process/job-photos", imageHandler.ProcessJobPhotos)
			r.Post("/process/avatar", imageHandler.ProcessAvatar)
			r.Post("/process/portfolio", imageHandler.ProcessPortfolio)
			r.Post("/process/document", imageHandler.ProcessDocument)
		})

		// Admin routes with role enforcement
		r.Route("/admin", func(r chi.Router) {
			r.Use(middleware.RequireAdmin)

			// Fraud (moved from standalone block, now with admin role check)
			r.Route("/fraud", func(r chi.Router) {
				r.Get("/alerts", fraudHandler.ListAlerts)
				r.Post("/alerts/{id}/review", fraudHandler.ReviewAlert)
				r.Get("/users/{id}/risk", fraudHandler.GetUserRiskProfile)
			})

			// Users
			r.Route("/users", func(r chi.Router) {
				r.Get("/", adminUsersHandler.SearchUsers)
				r.Get("/{id}", adminUsersHandler.GetUser)
				r.Post("/{id}/suspend", adminUsersHandler.SuspendUser)
				r.Post("/{id}/ban", adminUsersHandler.BanUser)
				r.Post("/{id}/reactivate", adminUsersHandler.ReactivateUser)
				// GDPR/CCPA admin override — bypasses the 30-day grace and
				// runs the cascade now. Audit-logged at the user service.
				r.Post("/{id}/finalize-deletion", userHandler.AdminFinalizeDeletion)
			})

			// Verification
			r.Route("/verification", func(r chi.Router) {
				r.Get("/queue", adminVerificationHandler.ListPendingDocuments)
				r.Post("/{id}/review", adminVerificationHandler.ReviewDocument)
			})

			// Jobs
			r.Route("/jobs", func(r chi.Router) {
				r.Get("/", adminJobsHandler.ListJobs)
				r.Post("/{id}/suspend", adminJobsHandler.SuspendJob)
				r.Post("/{id}/remove", adminJobsHandler.RemoveJob)
			})

			// Disputes
			r.Route("/disputes", func(r chi.Router) {
				r.Get("/", adminDisputesHandler.ListDisputes)
				// Goods-specific list/resolve — reads `disputes.subject_kind='goods'`
				// directly from the DB. The contract-service ListDisputes path
				// only sees service disputes (it joins on contract_id, which is
				// NULL for goods disputes after migration 035).
				r.Get("/goods", adminMarketplaceHandler.ListGoodsDisputes)
				r.Post("/goods/{id}/resolve", adminMarketplaceHandler.ResolveGoodsDispute)
				r.Get("/{id}", adminDisputesHandler.GetDispute)
				r.Post("/{id}/resolve", adminDisputesHandler.ResolveDispute)
			})

			// Guarantee claims
			r.Route("/guarantee-claims", func(r chi.Router) {
				r.Get("/", adminDisputesHandler.ListGuaranteeClaims)
				r.Put("/{id}/review", adminDisputesHandler.ReviewGuaranteeClaim)
			})

			// Reviews
			r.Route("/reviews", func(r chi.Router) {
				r.Get("/flagged", adminReviewsHandler.ListFlaggedReviews)
				r.Post("/flags/{id}/resolve", adminReviewsHandler.ResolveFlag)
				r.Delete("/{id}", adminReviewsHandler.RemoveReview)
			})

			// Payments
			r.Route("/payments", func(r chi.Router) {
				r.Get("/", adminPaymentsHandler.ListPayments)
				r.Get("/fee-config", adminPaymentsHandler.GetFeeConfig)
				r.Put("/fee-config", adminPaymentsHandler.UpdateFeeConfigNested)
				r.Get("/{id}", adminPaymentsHandler.GetPaymentDetails)
			})
			r.Get("/revenue", adminPaymentsHandler.GetRevenueReport)
			r.Put("/fees", adminPaymentsHandler.UpdateFeeConfig)

			// Platform payout bank account — where all collected fees route.
			// The mutation calls Stripe, so guard the POST with an idempotency
			// key to avoid creating duplicate external accounts on retry.
			r.Route("/banking", func(r chi.Router) {
				r.Get("/", adminBankingHandler.GetPlatformBankAccount)
				r.With(middleware.RequireIdempotencyKey(cacheClient)).
					Post("/", adminBankingHandler.SetPlatformBankAccount)
				r.Delete("/{id}", adminBankingHandler.DeletePlatformBankAccount)
			})

			// Working Capital advances (admin review + disburse)
			r.Route("/advances", func(r chi.Router) {
				r.Get("/", workingCapitalHandler.AdminListAdvances)
				r.Post("/{id}/review", workingCapitalHandler.AdminReviewAdvance)
				r.Post("/{id}/disburse", workingCapitalHandler.AdminDisburseAdvance)
			})

			// Platform
			r.Route("/platform", func(r chi.Router) {
				r.Get("/metrics", adminPlatformHandler.GetPlatformMetrics)
				r.Get("/growth", adminPlatformHandler.GetGrowthMetrics)
				r.Get("/categories", adminPlatformHandler.GetCategoryMetrics)
				r.Get("/geographic", adminPlatformHandler.GetGeographicMetrics)
			})
			r.Get("/subscriptions", adminPlatformHandler.ListSubscriptions)

			// Challenges
			r.Route("/challenges", func(r chi.Router) {
				r.Get("/", challengeHandler.AdminListChallenges)
				r.Post("/", challengeHandler.AdminCreateChallenge)
			})

			// Insurance
			r.Route("/insurance/claims", func(r chi.Router) {
				r.Get("/", insuranceHandler.AdminListClaims)
				r.Post("/{id}/review", insuranceHandler.AdminReviewClaim)
			})

			// Marketplace listings (goods)
			r.Route("/listings", func(r chi.Router) {
				r.Get("/", adminMarketplaceHandler.ListListings)
				r.Post("/{id}/suspend", adminMarketplaceHandler.SuspendListing)
				r.Post("/{id}/reactivate", adminMarketplaceHandler.ReactivateListing)
				r.Post("/{id}/cancel", adminMarketplaceHandler.CancelListing)
			})

			// Marketplace prohibited-items reports
			r.Route("/goods-reports", func(r chi.Router) {
				r.Get("/", adminMarketplaceHandler.ListReports)
				r.Post("/{id}/resolve", adminMarketplaceHandler.ResolveReport)
			})

			// Pre-quote category questions CRUD (Wave 5 audit Section H).
			// Public read at /api/v1/categories/{id}/questions; admin
			// writes here. Cascade DELETE on category_questions cleans up
			// every job_question_answers row that referenced the question.
			r.Route("/category-questions", func(r chi.Router) {
				r.Post("/", categoryQuestionsHandler.AdminCreate)
				r.Patch("/{id}", categoryQuestionsHandler.AdminUpdate)
				r.Delete("/{id}", categoryQuestionsHandler.AdminDelete)
			})

			// Feature flags
			r.Get("/flags", featureFlagHandler.ListFeatureFlags)
			r.Put("/flags/{key}", featureFlagHandler.UpdateFeatureFlag)
		})

		// Notification routes
		r.Route("/notifications", func(r chi.Router) {
			r.Get("/", notificationHandler.ListNotifications)
			r.Post("/{id}/read", notificationHandler.MarkAsRead)
			r.Post("/read-all", notificationHandler.MarkAllAsRead)
			r.Get("/unread-count", notificationHandler.GetUnreadCount)
			r.Get("/preferences", notificationHandler.GetPreferences)
			r.Put("/preferences", notificationHandler.UpdatePreferences)
			r.Post("/devices", notificationHandler.RegisterDevice)
			r.Delete("/devices/{token}", notificationHandler.UnregisterDevice)
		})

		// Subscription routes (authenticated) — mutations require Idempotency-Key.
		r.Route("/subscriptions", func(r chi.Router) {
			r.Use(middleware.RequireIdempotencyKey(cacheClient))
			r.Get("/me", subscriptionHandler.GetSubscription)
			r.Post("/", subscriptionHandler.CreateSubscription)
			r.Post("/cancel", subscriptionHandler.CancelSubscription)
			r.Post("/change-tier", subscriptionHandler.ChangeTier)
			r.Get("/usage", subscriptionHandler.GetUsage)
			r.Get("/features/{feature}", subscriptionHandler.CheckFeatureAccess)
			r.Get("/invoices", subscriptionHandler.ListInvoices)
		})

		// Provider instant match offer routes — provider-self only; gate with
		// RequireProvider (admin allowed) so a customer-only token cannot reach them.
		r.Route("/provider/offers", func(r chi.Router) {
			r.Use(middleware.RequireProvider)
			r.Get("/", instantMatchHandler.ListProviderOffers)
			r.Post("/{jobId}/accept", instantMatchHandler.AcceptOffer)
			r.Post("/{jobId}/decline", instantMatchHandler.DeclineOffer)
		})

		// Dispute filing routes — disputes don't have direct party columns;
		// access is gated by joining to the parent contract and checking
		// (customer_id, provider_id).
		r.Route("/disputes", func(r chi.Router) {
			r.Post("/", disputeHandler.FileDispute)

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireJoinedPartyAccess(dbPool, middleware.JoinedPartyAccessConfig{
					Table: "disputes", IDColumn: "id",
					JoinColumn: "contract_id",
					JoinTable:  "contracts", JoinIDCol: "id",
					PartyCol1: "customer_id", PartyCol2: "provider_id",
					URLParam: "id",
				}))
				r.Get("/{id}", disputeHandler.GetDispute)
			})
		})

		// Challenge routes (authenticated)
		r.Route("/challenges", func(r chi.Router) {
			r.Get("/", challengeHandler.ListActiveChallenges)
			r.Get("/me", challengeHandler.GetMyProgress)
			r.Get("/{id}", challengeHandler.GetChallenge)
			r.Post("/{id}/join", challengeHandler.JoinChallenge)
		})

		// Analytics routes (authenticated)
		r.Route("/analytics", func(r chi.Router) {
			r.Get("/providers/{id}", analyticsHandler.GetProviderAnalytics)
			r.Get("/providers/{id}/earnings", analyticsHandler.GetProviderEarnings)
			r.Get("/customers/me/spending", analyticsHandler.GetCustomerSpending)
		})
	})

	// WebSocket chat endpoint (auth via query param, header, or cookie — validated in handler)
	r.Get("/ws/chat", chatHandler.WebSocket)

	// Auction WebSocket endpoint (auth via query param, header, or cookie — validated in handler)
	r.Get("/ws/auction/{jobId}", auctionWSHandler.WebSocket)

	// Spectator WebSocket endpoint (public, no auth required — anonymous viewers)
	r.Get("/ws/auction/{jobId}/spectate", spectatorWSHandler.SpectateAuction)

	// Marketplace (goods) spectator WebSocket — anonymous live-bid stream for
	// a single listing. PII-stripped, 3-second delayed.
	r.Get("/ws/marketplace/{listingId}/spectate", marketplaceSpectatorWSHandler.Spectate)

	return r
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	version := os.Getenv("BUILD_VERSION")
	if version == "" {
		version = "dev"
	}

	resp := map[string]string{
		"status":  "ok",
		"version": version,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// readinessHandler returns 200 only when all critical backing dependencies
// are reachable. Used by Kubernetes readiness probes and load balancers to
// remove the pod from rotation when it is unable to serve real traffic.
//
// Probes:
//   - PostgreSQL: pgxpool.Ping with 1s deadline (only when DATABASE_URL is set).
//   - Redis: cache.Ping with 1s deadline (only when REDIS_URL is set).
//
// Downstream gRPC services are NOT probed here because gateway uses
// grpc.NewClient with lazy connection — a 503 here would mask actual gateway
// health when a single dependency is briefly unhealthy. Prefer per-service
// readiness probes on each backend.
func readinessHandler(dbPool *pgxpool.Pool, cacheClient *cache.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 1*time.Second)
		defer cancel()

		checks := map[string]string{}
		ready := true

		if dbPool != nil {
			if err := dbPool.Ping(ctx); err != nil {
				checks["postgres"] = "unhealthy: " + err.Error()
				ready = false
			} else {
				checks["postgres"] = "ok"
			}
		} else {
			checks["postgres"] = "skipped (DATABASE_URL not set)"
		}

		if cacheClient != nil {
			if err := cacheClient.Ping(ctx); err != nil {
				checks["redis"] = "unhealthy: " + err.Error()
				ready = false
			} else {
				checks["redis"] = "ok"
			}
		} else {
			checks["redis"] = "skipped (REDIS_URL not set)"
		}

		status := http.StatusOK
		body := map[string]any{"status": "ready", "checks": checks}
		if !ready {
			status = http.StatusServiceUnavailable
			body["status"] = "not_ready"
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	}
}

// optionalAuth tries to extract auth claims if an Authorization header is present,
// but allows the request to proceed even without authentication.
func optionalAuth(authMW *middleware.AuthMiddleware, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader != "" {
			// Try to authenticate but don't fail if it doesn't work.
			// Use the middleware's handler logic wrapped to not reject unauthenticated requests.
			handler := authMW.Handler(http.HandlerFunc(next))
			handler.ServeHTTP(w, r)
			return
		}
		// No auth header, proceed without claims.
		next.ServeHTTP(w, r)
	}
}
