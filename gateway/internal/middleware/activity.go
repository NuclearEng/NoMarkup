package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/observability"
)

const activityPathMaxLen = 200

// activityExecer is the insert surface used by Activity. *pgxpool.Pool
// implements it; tests inject a fake so the authenticated user_id path
// runs without Postgres.
type activityExecer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// Activity records each HTTP hop into user_request_activity after the
// handler returns. Fail-soft: a nil DB or insert error is slog-warned and
// never fails the request. Mount AFTER Logging so the access log still
// wraps the writer.
//
// Auth is inner (route-group) so GetClaims on the outer request is usually
// empty; when auth is provided we re-validate the Bearer token after the
// hop to attribute user_id. Unauthenticated hops store user_id NULL.
//
// Does not persist bodies, Authorization, cookies, query strings, or IP.
func Activity(db *pgxpool.Pool, auth ...*AuthMiddleware) func(http.Handler) http.Handler {
	var exec activityExecer
	if db != nil {
		exec = db
	}
	var validator *AuthMiddleware
	if len(auth) > 0 {
		validator = auth[0]
	}
	return activity(exec, validator)
}

func activity(db activityExecer, auth *AuthMiddleware) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if skipActivityPath(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}

			start := time.Now()
			wrapped := &wrappedWriter{ResponseWriter: w, statusCode: http.StatusOK}
			next.ServeHTTP(wrapped, r)

			if db == nil {
				return
			}

			path := sanitizeActivityPath(r.URL.Path)
			requestID := activityRequestID(r)
			if requestID == "" {
				return
			}
			method := r.Method
			if len(method) > 16 {
				method = method[:16]
			}
			durationMs := int(time.Since(start).Milliseconds())
			if durationMs < 0 {
				durationMs = 0
			}

			ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 2*time.Second)
			defer cancel()

			_, err := db.Exec(ctx, `
				INSERT INTO user_request_activity
				    (user_id, request_id, method, path, status, duration_ms)
				VALUES ($1, $2, $3, $4, $5, $6)`,
				activityUserID(r, auth),
				requestID,
				method,
				path,
				wrapped.statusCode,
				durationMs,
			)
			if err != nil {
				slog.WarnContext(r.Context(), "activity: insert failed", "error", err)
			}
		})
	}
}

func skipActivityPath(path string) bool {
	switch path {
	case "/healthz", "/health", "/readyz", "/metrics":
		return true
	}
	if strings.HasPrefix(path, "/static/") || strings.HasPrefix(path, "/assets/") {
		return true
	}
	return false
}

// sanitizeActivityPath strips query/hash, defaults empty to "/", and caps
// length at 200. Fail-closed: never persist '?' or '#'.
func sanitizeActivityPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "/"
	}
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "/"
	}
	if len(raw) > activityPathMaxLen {
		raw = raw[:activityPathMaxLen]
	}
	return raw
}

func activityRequestID(r *http.Request) string {
	id := observability.RequestIDFromContext(r.Context())
	if id == "" {
		id = observability.SanitizeRequestID(r.Header.Get(observability.HeaderRequestID))
	}
	if id == "" {
		id = observability.NewRequestID()
	}
	if len(id) > 64 {
		id = id[:64]
	}
	return id
}

// activityUserID returns a UUID string suitable for the user_id column, or
// nil for unauthenticated / malformed subjects. Prefer verified claims on
// the request; fall back to re-validating the Bearer token because this
// middleware sits outside the auth route group.
func activityUserID(r *http.Request, auth *AuthMiddleware) any {
	if claims, ok := GetClaims(r.Context()); ok && isValidUUID(claims.UserID) {
		return claims.UserID
	}
	if auth == nil {
		return nil
	}
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return nil
	}
	claims, err := auth.ValidateToken(strings.TrimPrefix(header, "Bearer "))
	if err != nil || claims == nil || !isValidUUID(claims.UserID) {
		return nil
	}
	return claims.UserID
}
