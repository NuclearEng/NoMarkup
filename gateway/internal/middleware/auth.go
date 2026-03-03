package middleware

import "net/http"

// Auth validates JWT RS256 tokens from the Authorization header
// and sets user claims in the request context.
func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// TODO: Extract Bearer token from Authorization header
		// TODO: Verify RS256 signature using public key
		// TODO: Extract user_id and roles from claims
		// TODO: Set claims in request context
		// TODO: Return 401 if token is invalid or expired
		next.ServeHTTP(w, r)
	})
}
