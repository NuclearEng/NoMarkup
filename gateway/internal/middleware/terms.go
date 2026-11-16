package middleware

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TermsNotAcceptedCode is the stable machine code returned when an
// authenticated non-admin caller mutates state without accepting the
// latest tos_versions row. There is no baked-in version fallback.
const TermsNotAcceptedCode = "tos_not_accepted"

const (
	termsCurrentQuery = `SELECT current.version,
       EXISTS (
         SELECT 1 FROM tos_acceptances AS acceptance
          WHERE acceptance.user_id = $1
            AND acceptance.tos_version = current.version
       )
  FROM (
        SELECT version
          FROM tos_versions
         WHERE effective_at <= now()
         ORDER BY effective_at DESC
         LIMIT 1
       ) AS current`

	termsNotAcceptedBody = `{"error":"Accept the current Terms of Service before continuing.","code":"` + TermsNotAcceptedCode + `"}`
	termsGateUnavailable = `{"error":"Unable to confirm the current terms. Try again.","code":"tos_acceptance_unavailable"}`
)

// RequireCurrentTerms blocks authenticated mutations until the JWT subject
// has a tos_acceptances row for the latest tos_versions.version whose
// effective_at is already due (same predicate as GetCurrentToS). Admins
// skip. No published version, a blank version, a database error, or a
// missing pool fails closed with 503 — never a hardcoded version.
func RequireCurrentTerms(db OwnershipQuerier) func(http.Handler) http.Handler {
	// Typed-nil *pgxpool.Pool boxed in the interface is not == nil.
	if p, ok := db.(*pgxpool.Pool); ok && p == nil {
		db = nil
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if accountGateExempt(r) {
				next.ServeHTTP(w, r)
				return
			}

			claims, ok := GetClaims(r.Context())
			if !ok || claims.UserID == "" {
				http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
				return
			}

			if hasAdminRole(claims) {
				next.ServeHTTP(w, r)
				return
			}

			if db == nil {
				slog.ErrorContext(r.Context(), "terms acceptance check: database unavailable",
					"user_id", claims.UserID,
				)
				writeGateJSON(w, http.StatusServiceUnavailable, termsGateUnavailable)
				return
			}

			var version string
			var accepted bool
			err := db.QueryRow(r.Context(), termsCurrentQuery, claims.UserID).Scan(&version, &accepted)
			if err != nil || version == "" {
				if err != nil && !errors.Is(err, pgx.ErrNoRows) {
					slog.ErrorContext(r.Context(), "terms acceptance check: database error",
						"user_id", claims.UserID,
						"error", err,
					)
				} else {
					slog.ErrorContext(r.Context(), "terms acceptance check: current terms unavailable",
						"user_id", claims.UserID,
					)
				}
				writeGateJSON(w, http.StatusServiceUnavailable, termsGateUnavailable)
				return
			}

			if !accepted {
				slog.InfoContext(r.Context(), "terms acceptance check: current terms not accepted",
					"user_id", claims.UserID,
					"path", r.URL.Path,
				)
				writeGateJSON(w, http.StatusForbidden, termsNotAcceptedBody)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
