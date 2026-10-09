package middleware

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AgeNotVerifiedCode is the stable machine code returned when an
// authenticated non-admin caller mutates state before users.dob_verified_at
// is set. The check reads that timestamp only, never the date of birth.
const AgeNotVerifiedCode = "age_not_verified"

const (
	ageVerifiedQuery = `SELECT dob_verified_at IS NOT NULL FROM users WHERE id = $1 AND deleted_at IS NULL`

	ageNotVerifiedBody = `{"error":"Confirm you are at least 18 years old before continuing. Add your date of birth in Account.","code":"` + AgeNotVerifiedCode + `"}`
	ageGateUnavailable = `{"error":"Unable to confirm age verification. Try again.","code":"age_verification_unavailable"}`
)

// RequireAgeVerified blocks authenticated mutations until dob_verified_at
// is set for the JWT subject. Admins skip. A database error or missing
// pool fails closed with 503. Missing or deleted users are 403.
// accountGateExempt requests pass through without a query.
func RequireAgeVerified(db OwnershipQuerier) func(http.Handler) http.Handler {
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
				slog.ErrorContext(r.Context(), "age verification check: database unavailable",
					"user_id", claims.UserID,
				)
				writeGateJSON(w, http.StatusServiceUnavailable, ageGateUnavailable)
				return
			}

			var verified bool
			err := db.QueryRow(r.Context(), ageVerifiedQuery, claims.UserID).Scan(&verified)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					slog.WarnContext(r.Context(), "age verification check: user not found",
						"user_id", claims.UserID,
					)
					http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
					return
				}
				slog.ErrorContext(r.Context(), "age verification check: database error",
					"user_id", claims.UserID,
					"error", err,
				)
				writeGateJSON(w, http.StatusServiceUnavailable, ageGateUnavailable)
				return
			}

			if !verified {
				slog.InfoContext(r.Context(), "age verification check: blocked unverified user",
					"user_id", claims.UserID,
					"path", r.URL.Path,
				)
				writeGateJSON(w, http.StatusForbidden, ageNotVerifiedBody)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func writeGateJSON(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}
