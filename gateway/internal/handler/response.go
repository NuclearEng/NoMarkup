package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

func decodeJSON(w http.ResponseWriter, r *http.Request, dst interface{}) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
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
	default:
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}
