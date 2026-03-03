package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/nomarkup/nomarkup/gateway/internal/handler"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// New creates and configures the HTTP router with all middleware and routes.
func New(
	allowedOrigins []string,
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
) *chi.Mux {
	r := chi.NewRouter()

	// Global middleware stack
	r.Use(middleware.Recovery)
	r.Use(middleware.Logging)
	r.Use(middleware.CORS(allowedOrigins))
	r.Use(middleware.RateLimit)

	// Health check (public, no auth)
	r.Get("/health", healthHandler)

	// Public auth routes (no auth middleware)
	r.Route("/api/v1/auth", func(r chi.Router) {
		r.Post("/register", authHandler.Register)
		r.Post("/login", authHandler.Login)
		r.Post("/refresh", authHandler.Refresh)
		r.Post("/logout", authHandler.Logout)
		r.Post("/verify-email", authHandler.VerifyEmail)
	})

	// Public category routes (no auth required)
	r.Route("/api/v1/categories", func(r chi.Router) {
		r.Get("/", categoriesHandler.List)
		r.Get("/tree", categoriesHandler.Tree)
	})

	// Public job routes (no auth required for search and view)
	r.Route("/api/v1/jobs", func(r chi.Router) {
		r.Get("/", jobHandler.Search)
		// GET /api/v1/jobs/{id} - public with optional auth for address visibility
		r.Get("/{id}", optionalAuth(authMW, jobHandler.GetJob))
	})

	// Public trust tier requirements (no auth required)
	r.Route("/api/v1/trust", func(r chi.Router) {
		r.Get("/tiers", trustHandler.GetTierRequirements)
	})

	// Public webhook routes (no auth, verified by Stripe signature)
	r.Route("/api/v1/webhooks", func(r chi.Router) {
		r.Post("/stripe", webhookHandler.HandleStripeWebhook)
	})

	// Public subscription tier routes (no auth required)
	r.Route("/api/v1/subscriptions/tiers", func(r chi.Router) {
		r.Get("/", subscriptionHandler.ListTiers)
		r.Get("/{id}", subscriptionHandler.GetTier)
	})

	// Public market analytics routes (no auth required)
	r.Route("/api/v1/analytics/market", func(r chi.Router) {
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
			r.Get("/{id}", providerHandler.GetProvider)

			// Stripe Connect routes for providers
			r.Post("/me/stripe/account", paymentHandler.CreateStripeAccount)
			r.Get("/me/stripe/onboarding", paymentHandler.GetStripeOnboardingLink)
			r.Get("/me/stripe/status", paymentHandler.GetStripeAccountStatus)
		})

		r.Route("/jobs", func(r chi.Router) {
			r.Post("/", jobHandler.Create)
			r.Get("/mine", jobHandler.ListMine)
			r.Get("/drafts", jobHandler.ListDrafts)
			r.Patch("/{id}", jobHandler.Update)
			r.Delete("/{id}", jobHandler.Delete)
			r.Post("/{id}/publish", jobHandler.Publish)
			r.Post("/{id}/close", jobHandler.Close)
			r.Post("/{id}/cancel", jobHandler.Cancel)

			// Bid routes nested under jobs
			r.Post("/{jobID}/bids", bidHandler.PlaceBid)
			r.Post("/{jobID}/bids/accept-offer", bidHandler.AcceptOffer)
			r.Post("/{jobID}/bids/{bidID}/award", bidHandler.AwardBid)
			r.Get("/{jobID}/bids", bidHandler.ListBidsForJob)
			r.Get("/{jobID}/bids/count", bidHandler.GetBidCount)
		})

		// Bid routes not nested under a specific job
		r.Route("/bids", func(r chi.Router) {
			r.Get("/mine", bidHandler.ListMyBids)
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

		// Payment routes
		r.Route("/payments", func(r chi.Router) {
			r.Post("/", paymentHandler.CreatePayment)
			r.Get("/", paymentHandler.ListPayments)
			r.Post("/setup-intent", paymentHandler.CreateSetupIntent)
			r.Get("/methods", paymentHandler.ListPaymentMethods)
			r.Delete("/methods/{id}", paymentHandler.DeletePaymentMethod)
			r.Post("/calculate-fees", paymentHandler.CalculateFees)
			r.Get("/{id}", paymentHandler.GetPayment)
			r.Post("/{id}/process", paymentHandler.ProcessPayment)
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

			// Reviews
			r.Route("/reviews", func(r chi.Router) {
				r.Get("/flagged", adminReviewsHandler.ListFlaggedReviews)
				r.Post("/flags/{id}/resolve", adminReviewsHandler.ResolveFlag)
				r.Delete("/{id}", adminReviewsHandler.RemoveReview)
			})

			// Payments
			r.Route("/payments", func(r chi.Router) {
				r.Get("/", adminPaymentsHandler.ListPayments)
				r.Get("/{id}", adminPaymentsHandler.GetPaymentDetails)
			})
			r.Get("/revenue", adminPaymentsHandler.GetRevenueReport)
			r.Put("/fees", adminPaymentsHandler.UpdateFeeConfig)

			// Platform
			r.Route("/platform", func(r chi.Router) {
				r.Get("/metrics", adminPlatformHandler.GetPlatformMetrics)
				r.Get("/growth", adminPlatformHandler.GetGrowthMetrics)
				r.Get("/categories", adminPlatformHandler.GetCategoryMetrics)
				r.Get("/geographic", adminPlatformHandler.GetGeographicMetrics)
			})
			r.Get("/subscriptions", adminPlatformHandler.ListSubscriptions)
		})

		// Notification routes
		r.Route("/notifications", func(r chi.Router) {
			r.Get("/", notificationHandler.ListNotifications)
			r.Post("/{id}/read", notificationHandler.MarkAsRead)
			r.Post("/read-all", notificationHandler.MarkAllAsRead)
			r.Get("/unread-count", notificationHandler.GetUnreadCount)
			r.Get("/preferences", notificationHandler.GetPreferences)
			r.Put("/preferences", notificationHandler.UpdatePreferences)
		})

		// Subscription routes (authenticated)
		r.Route("/subscriptions", func(r chi.Router) {
			r.Get("/me", subscriptionHandler.GetSubscription)
			r.Post("/", subscriptionHandler.CreateSubscription)
			r.Post("/cancel", subscriptionHandler.CancelSubscription)
			r.Post("/change-tier", subscriptionHandler.ChangeTier)
			r.Get("/usage", subscriptionHandler.GetUsage)
			r.Get("/features/{feature}", subscriptionHandler.CheckFeatureAccess)
			r.Get("/invoices", subscriptionHandler.ListInvoices)
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

	return r
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
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
