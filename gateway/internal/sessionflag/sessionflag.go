// Package sessionflag implements the HMAC-signed `has_session` soft-gate cookie
// (SEC-07). The cookie is a non-HttpOnly UX sentinel used by Next.js edge
// middleware and the client AuthRestorer to decide whether a soft redirect /
// refresh attempt is worth making. It is NOT authorization — the access JWT
// and refresh token remain the real credentials.
//
// Wire format:
//
//	v1.<user_id>.<exp_unix>.<b64url_mac>
//
// MAC = base64url(HMAC-SHA256(secret, user_id + "|" + exp_unix)).
// Empty user_id is allowed (still HMAC-bound to exp); forgers without the
// shared SESSION_SECRET cannot mint a valid value.
package sessionflag

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	// CookieName is the browser cookie name set by the gateway.
	CookieName = "has_session"

	// Version is the wire-format version prefix.
	Version = "v1"

	// parts: version, user_id, exp, mac
	partCount = 4
)

// Sign builds a v1 has_session cookie value for userID that expires at expUnix
// (Unix seconds). secret must be non-empty; returns an error otherwise so
// callers never silently issue a forgeable "1".
func Sign(secret []byte, userID string, expUnix int64) (string, error) {
	if len(secret) == 0 {
		return "", fmt.Errorf("sessionflag: empty secret")
	}
	if expUnix <= 0 {
		return "", fmt.Errorf("sessionflag: invalid exp")
	}
	// user_id must not contain '.' so the wire format stays unambiguous.
	if strings.Contains(userID, ".") {
		return "", fmt.Errorf("sessionflag: user_id must not contain '.'")
	}

	expStr := strconv.FormatInt(expUnix, 10)
	mac := computeMAC(secret, userID, expStr)
	return strings.Join([]string{Version, userID, expStr, mac}, "."), nil
}

// SignWithMaxAge signs a value that expires maxAge seconds from now.
func SignWithMaxAge(secret []byte, userID string, maxAgeSeconds int) (string, error) {
	if maxAgeSeconds <= 0 {
		return "", fmt.Errorf("sessionflag: invalid maxAge")
	}
	exp := time.Now().Add(time.Duration(maxAgeSeconds) * time.Second).Unix()
	return Sign(secret, userID, exp)
}

// Verify checks the HMAC and expiration of a has_session cookie value.
// Returns the embedded userID and true when valid; false for any malformation,
// bad signature, or expiry (nowUnix > exp).
func Verify(secret []byte, value string, nowUnix int64) (userID string, ok bool) {
	if len(secret) == 0 || value == "" {
		return "", false
	}
	parts := strings.Split(value, ".")
	if len(parts) != partCount {
		return "", false
	}
	if parts[0] != Version {
		return "", false
	}
	uid := parts[1]
	expStr := parts[2]
	providedMAC := parts[3]
	if providedMAC == "" {
		return "", false
	}

	expected := computeMAC(secret, uid, expStr)
	if !hmac.Equal([]byte(providedMAC), []byte(expected)) {
		return "", false
	}

	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || exp <= 0 {
		return "", false
	}
	if nowUnix > exp {
		return "", false
	}
	return uid, true
}

func computeMAC(secret []byte, userID, expStr string) string {
	// Payload: user_id|exp — domain-separated from the wire version prefix.
	payload := userID + "|" + expStr
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
