package middleware

import (
	"net/http"
)

// RequireSupport is an HTTP middleware that enforces the support or admin role on requests.
// It must be applied after the auth middleware so that claims are available in the context.
func RequireSupport(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := GetClaims(r.Context())
		if !ok {
			http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
			return
		}

		hasAccess := false
		for _, role := range claims.Roles {
			if role == "support" || role == "admin" {
				hasAccess = true
				break
			}
		}
		if !hasAccess {
			http.Error(w, `{"error":"support access required"}`, http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}
