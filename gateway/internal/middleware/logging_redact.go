package middleware

// Query-string redaction for the access log.
//
// The access log records the raw query string on every request, including
// 2xx. Several routes still carry a credential there:
//
//	/ws/chat?token=<access JWT>            // non-prod deprecated compat; rejected in production
//	/ws/auction/{jobId}?token=<access JWT> // non-prod deprecated compat; rejected in production
//	/api/v1/me/calendar.ics?feed=<opaque 90-day iCal secret>
//	/api/v1/auth/callback/*?code=<OAuth authorization code>
//
// New web clients send the WS JWT via Sec-WebSocket-Protocol, not the URL.
// Query-token auth remains accepted in non-production so mid-deploy clients
// keep working; production rejects it. We still redact ?token= because
// non-prod and leftover clients may still send it. Logging those verbatim
// deposits a replayable session token into the log store, so anyone with
// log-read access — Grafana/Loki, Sentry, a support bundle, a debug-level
// staging pod — can hijack sessions without touching TLS or the database.
// Redact at the sink.
//
// The parameter NAMES are kept so the log still shows the shape of the
// request; only the values are replaced.

import (
	"net/url"
	"strings"
)

// redactedQueryKeys are query parameters whose values must never be logged.
// Matched case-insensitively. Prefer over-redacting: a false positive costs a
// debugging detail, a false negative costs a session.
var redactedQueryKeys = map[string]struct{}{
	"token":         {},
	"feed":          {},
	"access_token":  {},
	"refresh_token": {},
	"id_token":      {},
	"code":          {},
	"secret":        {},
	"client_secret": {},
	"api_key":       {},
	"apikey":        {},
	"key":           {},
	"password":      {},
	"signature":     {},
	"sig":           {},
	"state":         {},
}

const redactedPlaceholder = "[REDACTED]"

// redactQuery returns the query string with sensitive values replaced.
//
// A query that cannot be parsed is dropped entirely rather than logged raw —
// an unparseable query is exactly the case where a naive scan would miss an
// embedded credential.
func redactQuery(raw string) string {
	if raw == "" {
		return ""
	}

	values, err := url.ParseQuery(raw)
	if err != nil {
		return redactedPlaceholder
	}

	redacted := false
	for key, vals := range values {
		if _, sensitive := redactedQueryKeys[strings.ToLower(key)]; !sensitive {
			continue
		}
		for i := range vals {
			if vals[i] != "" {
				vals[i] = redactedPlaceholder
				redacted = true
			}
		}
		values[key] = vals
	}

	if !redacted {
		// Nothing sensitive: return the original bytes so the log matches the
		// request exactly (Encode() would reorder and re-escape).
		return raw
	}
	return values.Encode()
}
