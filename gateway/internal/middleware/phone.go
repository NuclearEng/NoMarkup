package middleware

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PhoneNotVerifiedCode is the stable machine code returned when an
// authenticated non-admin caller hits a transact route without users.phone_verified.
const PhoneNotVerifiedCode = "phone_not_verified"

const (
	phoneVerifiedQuery = `SELECT phone_verified FROM users WHERE id = $1 AND deleted_at IS NULL`

	phoneNotVerifiedBody = `{"error":"Phone verification required before transacting. Verify your phone in Account → Verification.","code":"` + PhoneNotVerifiedCode + `"}`
	phoneGateUnavailable = `{"error":"Unable to confirm phone verification. Try again.","code":"phone_verification_unavailable"}`
)

// RequirePhoneVerified returns middleware that blocks money / bid-authorization
// mutations until users.phone_verified is true for the JWT subject (FR-1.9).
//
// It must run after auth middleware so claims are in context. Admins skip
// (ops). A database error or missing pool fails closed with 503 — never allow
// a transact through on an unknown verification state. Missing / deleted users
// are 403. Browse, profile, and the OTP routes themselves must not mount this.
func RequirePhoneVerified(db OwnershipQuerier) func(http.Handler) http.Handler {
	// Typed-nil *pgxpool.Pool boxed in the interface is not == nil.
	if p, ok := db.(*pgxpool.Pool); ok && p == nil {
		db = nil
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
				slog.ErrorContext(r.Context(), "phone verification check: database unavailable",
					"user_id", claims.UserID,
				)
				writePhoneGateJSON(w, http.StatusServiceUnavailable, phoneGateUnavailable)
				return
			}

			var verified bool
			err := db.QueryRow(r.Context(), phoneVerifiedQuery, claims.UserID).Scan(&verified)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					slog.WarnContext(r.Context(), "phone verification check: user not found",
						"user_id", claims.UserID,
					)
					http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
					return
				}
				slog.ErrorContext(r.Context(), "phone verification check: database error",
					"user_id", claims.UserID,
					"error", err,
				)
				writePhoneGateJSON(w, http.StatusServiceUnavailable, phoneGateUnavailable)
				return
			}

			if !verified {
				slog.InfoContext(r.Context(), "phone verification check: blocked unverified user",
					"user_id", claims.UserID,
					"path", r.URL.Path,
				)
				writePhoneGateJSON(w, http.StatusForbidden, phoneNotVerifiedBody)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func writePhoneGateJSON(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}
