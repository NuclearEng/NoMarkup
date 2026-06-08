package middleware

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// isValidUUID reports whether s is a well-formed UUID. The ownership middleware
// validates the URL id before querying so that a malformed id returns 400 rather
// than letting Postgres reject it as an invalid uuid (SQLSTATE 22P02) and
// surfacing as a 500. Kept local to the middleware package to avoid importing the
// handler package (wrong dependency direction / import cycle risk).
func isValidUUID(s string) bool {
	return uuid.Validate(s) == nil
}

// softDeleteTables is the set of gated tables that actually have a `deleted_at`
// column, so the ownership/party-access queries may safely append
// `AND deleted_at IS NULL`. Tables NOT in this set (e.g., reviews, payments) have
// no such column — appending the clause there produces SQLSTATE 42703 and a hard
// failure on every request, which is the bug this map prevents.
//
// Source of truth (verified against the live schema):
//
//	SELECT table_name FROM information_schema.columns WHERE column_name = 'deleted_at';
//	-> chat_messages, contracts, jobs, platform_bank_account, properties, users
//
// Keep this in sync when a gated table gains or loses its `deleted_at` column.
var softDeleteTables = map[string]bool{
	"contracts":  true,
	"jobs":       true,
	"properties": true,
	"users":      true,
	// reviews, payments, disputes: NO deleted_at column — intentionally absent.
}

// softDeleteClause returns the ` AND deleted_at IS NULL` SQL fragment for tables
// that have a soft-delete column, or an empty string otherwise. The table name
// comes from config-time route wiring (never user input), so the lookup and the
// returned constant fragment are safe to splice into the query string.
func softDeleteClause(table string) string {
	if softDeleteTables[table] {
		return " AND deleted_at IS NULL"
	}
	return ""
}

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
	// names come from hardcoded route configuration, not from user input. The
	// soft-delete filter is only appended for tables that actually have a
	// `deleted_at` column (see softDeleteTables).
	query := fmt.Sprintf(
		"SELECT %s FROM %s WHERE %s = $1%s",
		resource.OwnerColumn, resource.Table, resource.IDColumn,
		softDeleteClause(resource.Table),
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
			// Reject a malformed id up front so it returns 400 instead of the DB
			// rejecting it as an invalid uuid and surfacing as 500.
			if !isValidUUID(resourceID) {
				http.Error(w, `{"error":"invalid resource ID"}`, http.StatusBadRequest)
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
				http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
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
		"SELECT %s, %s FROM %s WHERE %s = $1%s",
		cfg.Column1, cfg.Column2, cfg.Table, cfg.IDColumn,
		softDeleteClause(cfg.Table),
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
			// Reject a malformed id up front so it returns 400 instead of the DB
			// rejecting it as an invalid uuid and surfacing as 500.
			if !isValidUUID(resourceID) {
				http.Error(w, `{"error":"invalid resource ID"}`, http.StatusBadRequest)
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
				http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
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

// JoinedPartyAccessConfig defines how to look up the two parties of a resource
// that are stored on a joined parent table (e.g., a dispute joins its parent
// contract for customer_id/provider_id). Both parties of the parent row are
// allowed to access the child resource.
type JoinedPartyAccessConfig struct {
	Table       string // e.g., "disputes"
	IDColumn    string // e.g., "id"
	JoinColumn  string // e.g., "contract_id"
	JoinTable   string // e.g., "contracts"
	JoinIDCol   string // e.g., "id" (PK of JoinTable)
	PartyCol1   string // e.g., "customer_id" (on JoinTable)
	PartyCol2   string // e.g., "provider_id" (on JoinTable)
	URLParam    string // e.g., "id"
}

// RequireJoinedPartyAccess returns middleware that verifies the authenticated
// user is one of the two parties on a joined parent row (e.g., the contract a
// dispute belongs to). Admins bypass.
//
// Usage:
//
//	r.With(middleware.RequireJoinedPartyAccess(db, middleware.JoinedPartyAccessConfig{
//	    Table: "disputes", IDColumn: "id",
//	    JoinColumn: "contract_id",
//	    JoinTable: "contracts", JoinIDCol: "id",
//	    PartyCol1: "customer_id", PartyCol2: "provider_id",
//	    URLParam: "id",
//	})).Get("/{id}", disputeHandler.GetDispute)
func RequireJoinedPartyAccess(db OwnershipQuerier, cfg JoinedPartyAccessConfig) func(http.Handler) http.Handler {
	// All identifiers come from hardcoded route configuration, not user input.
	query := fmt.Sprintf(
		"SELECT j.%s, j.%s FROM %s c JOIN %s j ON c.%s = j.%s WHERE c.%s = $1",
		cfg.PartyCol1, cfg.PartyCol2,
		cfg.Table, cfg.JoinTable,
		cfg.JoinColumn, cfg.JoinIDCol,
		cfg.IDColumn,
	)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := GetClaims(r.Context())
			if !ok || claims.UserID == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			if hasAdminRole(claims) {
				next.ServeHTTP(w, r)
				return
			}

			resourceID := chi.URLParam(r, cfg.URLParam)
			if resourceID == "" {
				http.Error(w, `{"error":"resource ID required"}`, http.StatusBadRequest)
				return
			}
			// Reject a malformed id up front so it returns 400 instead of the DB
			// rejecting it as an invalid uuid and surfacing as 500.
			if !isValidUUID(resourceID) {
				http.Error(w, `{"error":"invalid resource ID"}`, http.StatusBadRequest)
				return
			}

			var party1, party2 string
			err := db.QueryRow(r.Context(), query, resourceID).Scan(&party1, &party2)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
					return
				}
				slog.Error("joined party access check: database error",
					"table", cfg.Table,
					"join_table", cfg.JoinTable,
					"resource_id", resourceID,
					"error", err,
				)
				http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
				return
			}

			if claims.UserID != party1 && claims.UserID != party2 {
				slog.Warn("joined party access check: access denied",
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
