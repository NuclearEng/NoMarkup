package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/nomarkup/nomarkup/gateway/internal/handler"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// New creates and configures the HTTP router with all middleware and routes.
func New(allowedOrigins []string, authMW *middleware.AuthMiddleware, authHandler *handler.AuthHandler) *chi.Mux {
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

	// Protected API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(authMW.Handler)

		// Protected route groups will be registered here as handlers are implemented.
		// r.Route("/users", userRoutes)
		// r.Route("/jobs", jobRoutes)
		// r.Route("/bids", bidRoutes)
		// r.Route("/contracts", contractRoutes)
		// r.Route("/payments", paymentRoutes)
		// r.Route("/chat", chatRoutes)
		// r.Route("/reviews", reviewRoutes)
		// r.Route("/notifications", notificationRoutes)
	})

	return r
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}
