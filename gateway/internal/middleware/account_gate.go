package middleware

import (
	"net/http"
	"strings"
)

// accountGateExempt reports whether this request skips the age and
// current-terms checks. GET, HEAD, and OPTIONS stay open so those screens
// can load. DOB, age-status, terms acceptance, account restore, DELETE
// /api/v1/users/me, and block/report/flag writes are also exempt.
// report-noshow and report-abandonment do not match the /report suffix.
func accountGateExempt(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}

	switch r.URL.Path {
	case "/api/v1/me/dob",
		"/api/v1/me/age-status",
		"/api/v1/me/tos-acceptance",
		"/api/v1/users/me/restore":
		return true
	}

	if r.Method == http.MethodDelete && r.URL.Path == "/api/v1/users/me" {
		return true
	}

	path := r.URL.Path
	return strings.HasSuffix(path, "/block") ||
		strings.HasSuffix(path, "/report") ||
		strings.HasSuffix(path, "/flag")
}
