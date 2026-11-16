package handler

// Shared pre-post UGC filter helpers for App Store compliance (ASR-1.2.a).
// Applied on create/update paths that accept free-text user content.

import (
	"log/slog"
	"net/http"

	"github.com/nomarkup/nomarkup/gateway/internal/contentfilter"
)

// communityGuidelinesRejectMsg is the client-facing message when the pre-post
// filter rejects content. Intentionally does not include matched terms.
const communityGuidelinesRejectMsg = "This content violates our Community Guidelines (prohibited items or content)."

// rejectProhibitedUGC runs contentfilter.CheckUserTexts on the given parts.
// On violation it writes HTTP 400 with communityGuidelinesRejectMsg, logs the
// reason code only (never the matched term to access logs that might leak to
// clients), and returns true so the caller can return immediately.
//
// Allowed / empty content returns false (continue).
func rejectProhibitedUGC(w http.ResponseWriter, r *http.Request, parts ...string) bool {
	res := contentfilter.CheckUserTexts(parts...)
	if res.Allowed {
		return false
	}
	// Log reason only — Matched stays out of the default log fields so it is
	// not echoed into client-visible error aggregators by accident. Operators
	// needing the term can temporarily raise debug in a controlled env.
	slog.WarnContext(r.Context(), "ugc content filter rejected",
		"reason", res.Reason,
		"path", r.URL.Path,
		"method", r.Method,
	)
	writeError(w, http.StatusBadRequest, communityGuidelinesRejectMsg)
	return true
}
