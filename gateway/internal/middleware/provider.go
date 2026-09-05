package middleware

import (
	"net/http"
)

// RequireProvider is an HTTP middleware that enforces the provider role on requests.
// It must be applied after the auth middleware so that claims are available in the context.
// Admins are allowed through as well (admin can do anything).
func RequireProvider(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := GetClaims(r.Context())
		if !ok {
			http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
			return
		}

		hasAccess := false
		for _, role := range claims.Roles {
			if role == "provider" || role == "admin" {
				hasAccess = true
				break
			}
		}
		if !hasAccess {
			http.Error(w, `{"error":"provider access required"}`, http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}
