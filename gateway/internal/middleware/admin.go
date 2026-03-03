package middleware

import (
	"net/http"
)

// RequireAdmin is an HTTP middleware that enforces the admin role on requests.
// It must be applied after the auth middleware so that claims are available in the context.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := GetClaims(r.Context())
		if !ok {
			http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
			return
		}

		hasAdmin := false
		for _, role := range claims.Roles {
			if role == "admin" {
				hasAdmin = true
				break
			}
		}
		if !hasAdmin {
			http.Error(w, `{"error":"admin access required"}`, http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}
