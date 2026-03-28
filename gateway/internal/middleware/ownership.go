package middleware

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OwnershipQuerier is the interface required by ownership middleware to execute
// database queries. *pgxpool.Pool satisfies this interface.
type OwnershipQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
}

// compile-time check that *pgxpool.Pool satisfies OwnershipQuerier.
var _ OwnershipQuerier = (*pgxpool.Pool)(nil)

// ResourceOwnership defines how to look up the owner of a resource type.
// Table, OwnerColumn, and IDColumn are set at route configuration time (not from
// user input), so they are safe to interpolate into SQL.
type ResourceOwnership struct {
	Table       string // e.g., "jobs"
	OwnerColumn string // e.g., "customer_id"
	IDColumn    string // e.g., "id"
	URLParam    string // e.g., "id" (the Chi URL param name)
}

// RequireOwnership returns middleware that verifies the authenticated user owns
// the resource identified by the URL parameter. Admins bypass the ownership check.
//
// It must be applied after the auth middleware so that claims are available in the
// request context.
//
// Usage in router.go:
//
//	// Jobs — customer owns
//	r.With(middleware.RequireOwnership(db, middleware.ResourceOwnership{
//	    Table: "jobs", OwnerColumn: "customer_id", IDColumn: "id", URLParam: "id",
//	})).Patch("/{id}", jobHandler.Update)
//
//	// Properties — user owns
//	r.With(middleware.RequireOwnership(db, middleware.ResourceOwnership{
//	    Table: "properties", OwnerColumn: "user_id", IDColumn: "id", URLParam: "id",
//	})).Put("/{id}", propertyHandler.Update)
func RequireOwnership(db OwnershipQuerier, resource ResourceOwnership) func(http.Handler) http.Handler {
	// Build the query once at init time — no SQL injection risk since table/column
	// names come from hardcoded route configuration, not from user input.
	query := fmt.Sprintf(
		"SELECT %s FROM %s WHERE %s = $1 AND deleted_at IS NULL",
		resource.OwnerColumn, resource.Table, resource.IDColumn,
	)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := GetClaims(r.Context())
			if !ok || claims.UserID == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			// Admins bypass ownership check.
			if hasAdminRole(claims) {
				next.ServeHTTP(w, r)
				return
			}

			resourceID := chi.URLParam(r, resource.URLParam)
			if resourceID == "" {
				http.Error(w, `{"error":"resource ID required"}`, http.StatusBadRequest)
				return
			}

			var ownerID string
			err := db.QueryRow(r.Context(), query, resourceID).Scan(&ownerID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
					return
				}
				slog.Error("ownership check: database error",
					"table", resource.Table,
					"resource_id", resourceID,
					"error", err,
				)
				http.Error(w, `{"error":"service unavailable"}`, http.StatusServiceUnavailable)
				return
			}

			if ownerID != claims.UserID {
				slog.Warn("ownership check: access denied",
					"table", resource.Table,
					"resource_id", resourceID,
					"owner_id", ownerID,
					"requester_id", claims.UserID,
				)
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// PartyAccessConfig defines how to look up the two parties of a two-sided resource.
type PartyAccessConfig struct {
	Table    string // e.g., "contracts"
	Column1  string // e.g., "customer_id"
	Column2  string // e.g., "provider_id"
	IDColumn string // e.g., "id"
	URLParam string // e.g., "id" (the Chi URL param name)
}

// RequirePartyAccess returns middleware that verifies the authenticated user is
// one of the two parties in a two-sided resource (e.g., a contract has both a
// customer_id and a provider_id). Admins bypass the check.
//
// It must be applied after the auth middleware so that claims are available in the
// request context.
//
// Usage in router.go:
//
//	// Contracts — both customer and provider need access
//	r.With(middleware.RequirePartyAccess(db, middleware.PartyAccessConfig{
//	    Table:    "contracts",
//	    Column1:  "customer_id",
//	    Column2:  "provider_id",
//	    IDColumn: "id",
//	    URLParam: "id",
//	})).Get("/{id}", contractHandler.GetContract)
func RequirePartyAccess(db OwnershipQuerier, cfg PartyAccessConfig) func(http.Handler) http.Handler {
	query := fmt.Sprintf(
		"SELECT %s, %s FROM %s WHERE %s = $1 AND deleted_at IS NULL",
		cfg.Column1, cfg.Column2, cfg.Table, cfg.IDColumn,
	)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := GetClaims(r.Context())
			if !ok || claims.UserID == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			// Admins bypass party access check.
			if hasAdminRole(claims) {
				next.ServeHTTP(w, r)
				return
			}

			resourceID := chi.URLParam(r, cfg.URLParam)
			if resourceID == "" {
				http.Error(w, `{"error":"resource ID required"}`, http.StatusBadRequest)
				return
			}

			var party1, party2 string
			err := db.QueryRow(r.Context(), query, resourceID).Scan(&party1, &party2)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
					return
				}
				slog.Error("party access check: database error",
					"table", cfg.Table,
					"resource_id", resourceID,
					"error", err,
				)
				http.Error(w, `{"error":"service unavailable"}`, http.StatusServiceUnavailable)
				return
			}

			if claims.UserID != party1 && claims.UserID != party2 {
				slog.Warn("party access check: access denied",
					"table", cfg.Table,
					"resource_id", resourceID,
					"requester_id", claims.UserID,
				)
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// hasAdminRole checks whether the given claims include the "admin" role.
func hasAdminRole(claims *Claims) bool {
	for _, role := range claims.Roles {
		if role == "admin" {
			return true
		}
	}
	return false
}
