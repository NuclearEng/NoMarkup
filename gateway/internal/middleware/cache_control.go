package middleware

import (
	"net/http"
)

// PrivateNoStore sets `Cache-Control: private, no-store` as the DEFAULT on
// every response in the subtree it wraps. Authenticated responses are
// per-user, so a shared cache (CDN, corporate proxy) must never store them —
// without an explicit header, intermediaries are free to apply heuristic
// caching (RFC 9111 §3), which could leak one user's data to another.
//
// The default is set BEFORE the handler runs, so any handler that explicitly
// sets its own Cache-Control via w.Header().Set (e.g. calendar_export's
// `private, max-age=300`, or writeCachedJSON's public CDN policy) simply
// overwrites it — headers are not flushed until the first WriteHeader/Write.
//
// Mount this INSIDE the authenticated subtree only; public catalog reads use
// writeCachedJSON's `public, s-maxage` policy and live outside it.
func PrivateNoStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		next.ServeHTTP(w, r)
	})
}
