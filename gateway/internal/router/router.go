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

	// Protected API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(authMW.Handler)

		r.Route("/users", func(r chi.Router) {
			r.Get("/me", userHandler.GetMe)
			r.Patch("/me", userHandler.UpdateMe)
			r.Post("/me/roles", userHandler.EnableRole)
			r.Get("/{id}", userHandler.GetUser)
		})

		r.Route("/providers", func(r chi.Router) {
			r.Get("/me", providerHandler.GetMe)
			r.Patch("/me", providerHandler.UpdateMe)
			r.Put("/me/terms", providerHandler.SetGlobalTerms)
			r.Put("/me/categories", providerHandler.UpdateCategories)
			r.Put("/me/portfolio", providerHandler.UpdatePortfolio)
			r.Put("/me/availability", providerHandler.SetAvailability)
			r.Get("/{id}", providerHandler.GetProvider)
		})
	})

	return r
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}
