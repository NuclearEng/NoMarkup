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

// writeCachedJSON writes a JSON response that is SAFE to cache at the CDN edge.
// Use ONLY for PUBLIC reads with no auth and no user-specific data — the body
// must be identical for every caller, so the edge can serve one copy to all.
// NEVER use it for authenticated or per-user responses.
//
//   - s-maxage:                CDN may serve the cached copy for this many seconds.
//   - stale-while-revalidate:  serve stale instantly while refreshing in the bg.
//   - stale-if-error (1d):     serve stale if the origin is down — resilience.
//   - max-age=0:               browsers always revalidate, so a user never sees
//     stale on refresh; the CDN absorbs the origin load.
//
// A strong ETag (content hash) enables conditional requests: a matching
// If-None-Match returns 304 with no body, saving bandwidth.
func writeCachedJSON(w http.ResponseWriter, r *http.Request, code int, v interface{}, sMaxAge, swr int) {
	body, err := json.Marshal(v)
	if err != nil {
		slog.Error("failed to marshal cached response", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", fmt.Sprintf(
		"public, max-age=0, s-maxage=%d, stale-while-revalidate=%d, stale-if-error=86400",
		sMaxAge, swr,
	))
	w.Header().Set("ETag", etag)
	w.Header().Add("Vary", "Accept-Encoding")

	if etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.WriteHeader(code)
	if _, err := w.Write(body); err != nil {
		slog.Error("failed to write cached response", "error", err)
	}
}

// etagMatches reports whether an If-None-Match header value matches etag.
// Handles the "*" wildcard and comma-separated lists.
func etagMatches(ifNoneMatch, etag string) bool {
	ifNoneMatch = strings.TrimSpace(ifNoneMatch)
	if ifNoneMatch == "" {
		return false
	}
	if ifNoneMatch == "*" {
		return true
	}
	for _, tag := range strings.Split(ifNoneMatch, ",") {
		if strings.TrimSpace(tag) == etag {
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
