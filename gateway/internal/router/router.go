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

		r.Route("/jobs", func(r chi.Router) {
			r.Post("/", jobHandler.Create)
			r.Get("/mine", jobHandler.ListMine)
			r.Get("/drafts", jobHandler.ListDrafts)
			r.Patch("/{id}", jobHandler.Update)
			r.Delete("/{id}", jobHandler.Delete)
			r.Post("/{id}/publish", jobHandler.Publish)
			r.Post("/{id}/close", jobHandler.Close)
			r.Post("/{id}/cancel", jobHandler.Cancel)
		})
	})

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
