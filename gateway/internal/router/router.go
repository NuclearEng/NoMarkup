package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// New creates and configures the HTTP router with all middleware and routes.
func New(allowedOrigins []string) *chi.Mux {
	r := chi.NewRouter()

	// Global middleware stack
	r.Use(middleware.Recovery)
	r.Use(middleware.Logging)
	r.Use(middleware.CORS(allowedOrigins))
	r.Use(middleware.RateLimit)

	// Health check (public, no auth)
	r.Get("/health", healthHandler)

	// API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middleware.Auth)

		// Route groups will be registered here as handlers are implemented
		// r.Route("/auth", authRoutes)
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
