package router

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/handler"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// New creates and configures the HTTP router with all middleware and routes.
// When production is true, HSTS headers are applied and wildcard CORS origins are rejected.
func New(
	allowedOrigins []string,
	production bool,
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
	adminPlatformHandler *handler.AdminPlatformHandler,
	propertyHandler *handler.PropertyHandler,
	verificationHandler *handler.VerificationHandler,
	workingCapitalHandler *handler.WorkingCapitalHandler,
	expenseHandler *handler.ExpenseHandler,
	taxHandler *handler.TaxHandler,
	auctionWSHandler *handler.AuctionWSHandler,
	spectatorWSHandler *handler.SpectatorWSHandler,
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
) *chi.Mux {
	r := chi.NewRouter()

	// Global middleware stack
	r.Use(middleware.Recovery)
	r.Use(middleware.Metrics)
	r.Use(middleware.Logging)
	r.Use(middleware.CORS(allowedOrigins, production))
	r.Use(middleware.SecurityHeaders(production))
	r.Use(rateLimiter.Middleware)

	// Observability endpoints (public, no auth)
	r.Get("/health", healthHandler)
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
	})

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

		// Live auction endpoints
		r.With(authMW.Handler).Get("/{id}/auction/state", bidHandler.GetLiveAuctionState)
		r.With(authMW.Handler).Get("/{id}/auction/events", bidHandler.GetAuctionEvents)
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
			r.Get("/{id}", userHandler.GetUser)
			r.Get("/{id}/reviews", reviewHandler.ListReviewsForUser)
			r.Get("/{id}/trust-score", trustHandler.GetTrustScore)
			r.Get("/{id}/trust-history", trustHandler.GetTrustScoreHistory)
		})

		r.Route("/providers", func(r chi.Router) {
			r.Get("/me", providerHandler.GetMe)
			r.Patch("/me", providerHandler.UpdateMe)
			r.Put("/me/terms", providerHandler.SetGlobalTerms)
			r.Put("/me/categories", providerHandler.UpdateCategories)
			r.Put("/me/portfolio", providerHandler.UpdatePortfolio)
			r.Put("/me/availability", providerHandler.SetAvailability)
			r.Get("/me/streaks", providerHandler.GetStreaks)
			r.Get("/{id}", providerHandler.GetProvider)

			// Provider verification documents
			r.Post("/me/documents", verificationHandler.UploadDocument)
			r.Get("/me/documents", verificationHandler.ListDocuments)
			r.Get("/me/documents/{type}/status", verificationHandler.GetDocumentStatus)

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
		})

		// Review routes
		r.Route("/reviews", func(r chi.Router) {
			r.Get("/{id}", reviewHandler.GetReview)
			r.Post("/{id}/respond", reviewHandler.RespondToReview)
			r.Post("/{id}/flag", reviewHandler.FlagReview)
		})

		// Milestone routes
		r.Route("/milestones", func(r chi.Router) {
			r.Post("/{id}/submit", contractHandler.SubmitMilestone)
			r.Post("/{id}/approve", contractHandler.ApproveMilestone)
			r.Post("/{id}/revision", contractHandler.RequestRevision)
		})

		// Payment routes — all POST/PUT mutations require an Idempotency-Key.
		r.Route("/payments", func(r chi.Router) {
			r.Use(middleware.RequireIdempotencyKey(cacheClient))
			r.Post("/", paymentHandler.CreatePayment)
			r.Get("/", paymentHandler.ListPayments)
			r.Post("/setup-intent", paymentHandler.CreateSetupIntent)
			r.Get("/methods", paymentHandler.ListPaymentMethods)
			r.Delete("/methods/{id}", paymentHandler.DeletePaymentMethod)
			r.Post("/calculate-fees", paymentHandler.CalculateFees)
			r.Post("/instant-payout", paymentHandler.InstantPayout)
			r.Get("/{id}", paymentHandler.GetPayment)
			r.Post("/{id}/process", paymentHandler.ProcessPayment)
			r.Post("/{id}/refund", paymentHandler.RefundPayment)
			r.Post("/{id}/release", paymentHandler.ReleasePayment)

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

		// Provider instant match offer routes
		r.Route("/provider/offers", func(r chi.Router) {
			r.Get("/", instantMatchHandler.ListProviderOffers)
			r.Post("/{jobId}/accept", instantMatchHandler.AcceptOffer)
			r.Post("/{jobId}/decline", instantMatchHandler.DeclineOffer)
		})

		// Dispute filing routes
		r.Route("/disputes", func(r chi.Router) {
			r.Post("/", disputeHandler.FileDispute)
			r.Get("/{id}", disputeHandler.GetDispute)
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
