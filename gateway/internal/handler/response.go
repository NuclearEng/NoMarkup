package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// protoEnumToString converts a protobuf enum string like "USER_ROLE_CUSTOMER"
// to a lowercase, frontend-friendly form like "customer".
// It strips the prefix (everything up to and including the type portion),
// lowercases the remainder, and replaces underscores with underscores (kept for
// multi-word values like "in_progress").
func protoEnumToString(enumStr string, prefixes ...string) string {
	s := enumStr
	for _, p := range prefixes {
		s = strings.TrimPrefix(s, p)
	}
	return strings.ToLower(s)
}

var uuidRegex = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func isValidUUID(s string) bool {
	return uuidRegex.MatchString(s)
}

// maxMoneyCents is the inclusive upper bound for any user-supplied money amount
// (bids, offers, counters). $10,000,000.00 is far above any legitimate consumer
// goods/services transaction on the platform but bounds the value so a client
// cannot persist an absurd amount (e.g. $10 trillion) that corrupts auction
// state, downstream fee math, or analytics. Lower bound (> 0) is checked at each
// call site with its own message. Mirrors the cap pattern used for insurance
// coverage in insurance_competition.go.
const maxMoneyCents int64 = 1_000_000_000

// validateMoneyCents reports whether amount is a positive integer-cent value
// within the sane platform bounds. fieldName names the JSON field for the error
// message. Returns "" when valid, otherwise an intuitive 400-grade message.
func validateMoneyCents(fieldName string, amount int64) string {
	if amount <= 0 {
		return fieldName + " must be positive"
	}
	if amount > maxMoneyCents {
		return fmt.Sprintf("%s must be at most %d ($%d)", fieldName, maxMoneyCents, maxMoneyCents/100)
	}
	return ""
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("failed to encode response", "error", err)
	}
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// publicCachePolicy is the shared-cache policy writeCachedJSON emits for a
// request the gateway has NOT associated with any user.
//
//   - s-maxage:                CDN may serve the cached copy for this many seconds.
//   - stale-while-revalidate:  serve stale instantly while refreshing in the bg.
//   - stale-if-error (1d):     serve stale if the origin is down — resilience.
//   - max-age=0:               browsers always revalidate, so a user never sees
//     stale on refresh; the CDN absorbs the origin load.
func publicCachePolicy(sMaxAge, swr int) string {
	return fmt.Sprintf(
		"public, max-age=0, s-maxage=%d, stale-while-revalidate=%d, stale-if-error=86400",
		sMaxAge, swr,
	)
}

// privateCachePolicy is the fallback writeCachedJSON emits when the request
// carries a gateway-resolved user identity. It is byte-identical to the default
// that middleware.PrivateNoStore stamps on the authenticated subtree, so the two
// controls agree: nothing that can be user-specific is ever storable anywhere.
const privateCachePolicy = "private, no-store"

// cacheGuardReason names why writeCachedJSON refused to emit the public policy.
// Empty means the request was anonymous and the public policy applies.
type cacheGuardReason string

const (
	cacheGuardNone cacheGuardReason = ""
	// cacheGuardResolvedIdentity: middleware.AuthMiddleware (directly, or via the
	// router's optionalAuth wrapper) resolved a JWT and put *middleware.Claims in
	// the request context. This is the ONLY way a handler obtains a user identity
	// through the sanctioned mechanism, so it is exactly the condition under which
	// the response could become per-user.
	cacheGuardResolvedIdentity cacheGuardReason = "resolved_identity"
	// cacheGuardCredentialCookie: the request presented the httpOnly refresh-token
	// cookie. It is Path-scoped to /api/v1/auth so it never reaches a catalog read
	// today; the check costs nothing and closes the case where that scope widens.
	cacheGuardCredentialCookie cacheGuardReason = "credential_cookie"
)

// publicCacheDenied reports whether this request must NOT receive a shared-cache
// policy, and why.
//
// SEC — structural guard for the §14 DATA-layer CDN cache. writeCachedJSON is
// called from ~22 public catalog handlers. Nothing in the type system stops a
// future edit from personalizing one of them, and at a CDN a personalized
// response stamped `public, s-maxage` is one user's data served to everyone.
// This makes the unsafe combination unreachable at runtime instead of merely
// audited: if the gateway resolved a user for this request, the public policy is
// not emitted, whatever the handler put in the body.
//
// Deliberately NOT a trigger:
//
//   - A bare `Authorization` header with no resolved claims. On a public route
//     the auth middleware does not run, so the header is inert — a handler cannot
//     turn it into an identity without parsing the JWT itself, which the static
//     gate in response_cache_guard_test.go rejects at CI time. Downgrading on the
//     header would fire on the majority of catalog traffic (the web client
//     attaches a Bearer to every request once logged in) and, worse, would make a
//     logged-in client's stale-while-revalidate refresh return an unstorable
//     response to the CDN — evicting a warm entry and regressing the hit rate for
//     the anonymous traffic the cache exists to serve.
//   - The `has_session` sentinel cookie. It is a non-httpOnly constant ("1") with
//     Path=/ that carries no identity at all, so it cannot personalize anything —
//     but it IS sent on every request from a logged-in browser. Treating it as
//     authentication would disable edge caching for all signed-in browsing for
//     zero security gain.
func publicCacheDenied(r *http.Request) cacheGuardReason {
	if claims, ok := middleware.GetClaims(r.Context()); ok && claims != nil {
		return cacheGuardResolvedIdentity
	}
	if c, err := r.Cookie(refreshTokenCookieName); err == nil && c.Value != "" {
		return cacheGuardCredentialCookie
	}
	return cacheGuardNone
}

// writeCachedJSON writes a JSON response that is SAFE to cache at the CDN edge.
// Use ONLY for PUBLIC reads with no auth and no user-specific data — the body
// must be identical for every caller, so the edge can serve one copy to all.
//
// The public policy is emitted only for requests the gateway has not associated
// with a user (see publicCacheDenied). A request that DOES carry a resolved
// identity still gets the same body and the same ETag, but with
// `private, no-store` — so mounting one of these handlers behind optionalAuth
// degrades gracefully (anonymous traffic keeps the edge cache; signed-in callers
// get a correct, unstorable response) instead of poisoning the shared cache.
//
// A strong ETag (content hash) enables conditional requests: a matching
// If-None-Match returns 304 with no body, saving bandwidth. The 304 shortcut
// applies only to a safe method and a 200 response — 304 is a substitute for
// 200 and nothing else (RFC 9110 §15.4.5).
func writeCachedJSON(w http.ResponseWriter, r *http.Request, code int, v interface{}, sMaxAge, swr int) {
	body, err := json.Marshal(v)
	if err != nil {
		slog.ErrorContext(r.Context(), "failed to marshal cached response", "error", err)
		// An error response on a publicly-cacheable route must never be stored by
		// an intermediary under RFC 9111 heuristic freshness.
		w.Header().Set("Cache-Control", privateCachePolicy)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`

	w.Header().Set("Content-Type", "application/json")
	if reason := publicCacheDenied(r); reason != cacheGuardNone {
		w.Header().Set("Cache-Control", privateCachePolicy)
		// Zero-volume today: no writeCachedJSON call site is mounted behind auth.
		// If this ever fires, a public catalog read has gained an auth wrapper and
		// needs an audit — warn rather than silently degrade.
		slog.WarnContext(r.Context(), "public cache suppressed: request carries user identity",
			"path", r.URL.Path,
			"reason", string(reason),
		)
	} else {
		w.Header().Set("Cache-Control", publicCachePolicy(sMaxAge, swr))
	}
	w.Header().Set("ETag", etag)
	// Add, not Set: CORS middleware may already have written `Vary: Origin`, and
	// clobbering it would let one origin's response be reused for another.
	w.Header().Add("Vary", "Accept-Encoding")

	if code == http.StatusOK && isSafeMethod(r.Method) &&
		etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.WriteHeader(code)
	if _, err := w.Write(body); err != nil {
		slog.ErrorContext(r.Context(), "failed to write cached response", "error", err)
	}
}

// isSafeMethod reports whether the method is one for which a 304 may be returned
// in place of a 200. For other methods a matching If-None-Match is a
// precondition failure, not a cache validation, so the shortcut must not apply.
func isSafeMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == ""
}

// etagMatches reports whether an If-None-Match header value matches etag.
// Handles the "*" wildcard and comma-separated lists, and uses the WEAK
// comparison function that RFC 9110 §13.1.2 mandates for If-None-Match: a
// `W/"..."` entity-tag matches the same opaque value. This matters in practice —
// nginx and several CDNs weaken a strong ETag when they compress a response, so
// the validator that comes back on revalidation is not always the one we sent.
func etagMatches(ifNoneMatch, etag string) bool {
	ifNoneMatch = strings.TrimSpace(ifNoneMatch)
	if ifNoneMatch == "" {
		return false
	}
	if ifNoneMatch == "*" {
		return true
	}
	want := strings.TrimPrefix(etag, "W/")
	for _, tag := range strings.Split(ifNoneMatch, ",") {
		if strings.TrimPrefix(strings.TrimSpace(tag), "W/") == want {
			return true
		}
	}
	return false
}

// maxJSONBodyBytes caps the size of a JSON request body the gateway will read.
// 1 MiB is far more than any legitimate JSON payload here (the largest text
// fields — listing/job description, chat content — top out in the low KB), but
// is bounded so a malicious client can't stream an unbounded body and exhaust
// memory (DoS). This applies ONLY to JSON bodies decoded via decodeJSON; binary
// file uploads (completion photos, etc.) use multipart with their own, larger
// cap (maxUploadSize) and never pass through here.
const maxJSONBodyBytes = 1 << 20 // 1 MiB

func decodeJSON(w http.ResponseWriter, r *http.Request, dst interface{}) bool {
	// Bound the body BEFORE decoding so an oversized payload is rejected
	// without being fully buffered into memory.
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		// MaxBytesReader surfaces an *http.MaxBytesError once the cap is
		// exceeded — map that to 413 with an intuitive message rather than a
		// generic 400, so the client knows the body was simply too large.
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("request body too large: max %d bytes", maxJSONBodyBytes))
			return false
		}
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return false
	}
	return true
}

func writeGRPCError(w http.ResponseWriter, err error) {
	st, ok := status.FromError(err)
	if !ok {
		slog.Error("non-grpc error", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Warn("grpc call failed",
		"code", st.Code().String(),
		"message", st.Message(),
	)

	switch st.Code() {
	case codes.AlreadyExists:
		writeError(w, http.StatusConflict, st.Message())
	case codes.Unauthenticated:
		writeError(w, http.StatusUnauthorized, st.Message())
	case codes.NotFound:
		writeError(w, http.StatusNotFound, st.Message())
	case codes.PermissionDenied:
		writeError(w, http.StatusForbidden, st.Message())
	case codes.InvalidArgument:
		writeError(w, http.StatusBadRequest, st.Message())
	case codes.FailedPrecondition:
		writeError(w, http.StatusUnprocessableEntity, st.Message())
	case codes.ResourceExhausted:
		writeError(w, http.StatusTooManyRequests, st.Message())
	case codes.Unimplemented:
		// An unimplemented RPC is a server-side gap, not a generic failure —
		// surface it as 501 rather than masking it as a 500.
		writeError(w, http.StatusNotImplemented, st.Message())
	case codes.Unavailable:
		// Service is down (common in dev before `./bin/dev up user` or when DB is
		// not ready). Return 503 so the frontend can show a friendly message instead
		// of treating it as a hard 500 crash.
		writeError(w, http.StatusServiceUnavailable, "service temporarily unavailable")
	default:
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}
