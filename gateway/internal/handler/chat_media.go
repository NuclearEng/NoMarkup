package handler

import (
	"net"
	"net/url"
	"os"
	"strings"
	"unicode"
)

// maxChatMediaURLLen matches maxMessageContentLen and the web/iOS URL cap.
const maxChatMediaURLLen = 2000

// AllowedChatMediaURL reports whether raw is a chat image/file content URL we
// will persist or render. Clients must only send upload-pipeline URLs — not
// arbitrary https hosts (tracking pixels, phishing, javascript:).
func AllowedChatMediaURL(raw string) bool {
	if raw == "" || len(raw) > maxChatMediaURLLen {
		return false
	}
	// Trim only the outer edges so a padded paste still works; internal
	// whitespace / angle brackets are injection or phishing, not a URL.
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || len(trimmed) > maxChatMediaURLLen {
		return false
	}
	for _, r := range trimmed {
		if unicode.IsSpace(r) || r == '<' || r == '>' {
			return false
		}
	}

	u, err := url.Parse(trimmed)
	if err != nil {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	host := normalizeChatMediaHost(u.Hostname())
	if host == "" || u.User != nil {
		return false
	}

	if !chatMediaHostAllowed(host) {
		return false
	}

	switch scheme {
	case "https":
		if isChatMediaLoopback(host) && !looksLikeObjectStoragePath(u.Path) {
			return false
		}
		return true
	case "http":
		// Production is https-only. Dev MinIO is http on loopback (or the
		// host taken from S3_* env, which may be a LAN IP).
		if isProductionChatMediaEnv() {
			return false
		}
		if isChatMediaLoopback(host) {
			return looksLikeObjectStoragePath(u.Path)
		}
		return isChatMediaS3EnvHost(host)
	default:
		return false
	}
}

func isClientReservedChatMessageType(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "system", "terms_accepted", "terms_rejected":
		return true
	default:
		return false
	}
}

func isProductionChatMediaEnv() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("ENVIRONMENT")), "production")
}

func normalizeChatMediaHost(host string) string {
	return strings.ToLower(strings.TrimSuffix(strings.TrimSpace(host), "."))
}

func isChatMediaLoopback(host string) bool {
	switch host {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// looksLikeObjectStoragePath requires /<bucket>/<key> so loopback http cannot
// be used as a bare phishing landing (http://localhost:9000/).
func looksLikeObjectStoragePath(path string) bool {
	if path == "" || path[0] != '/' {
		return false
	}
	rest := strings.TrimPrefix(path, "/")
	bucket, key, ok := strings.Cut(rest, "/")
	if !ok || bucket == "" || key == "" {
		return false
	}
	for _, r := range bucket {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '.' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func chatMediaHostAllowed(host string) bool {
	if isChatMediaLoopback(host) {
		return true
	}
	switch host {
	case "images.unsplash.com", "picsum.photos":
		return true
	}
	for _, allowed := range chatMediaAllowlistedHosts() {
		if host == allowed {
			return true
		}
	}
	return false
}

func isChatMediaS3EnvHost(host string) bool {
	for _, allowed := range chatMediaS3EnvHosts() {
		if host == allowed {
			return true
		}
	}
	return false
}

func chatMediaAllowlistedHosts() []string {
	seen := make(map[string]struct{})
	var out []string
	add := func(host string) {
		host = normalizeChatMediaHost(host)
		if host == "" {
			return
		}
		if _, ok := seen[host]; ok {
			return
		}
		seen[host] = struct{}{}
		out = append(out, host)
	}

	for _, h := range strings.Split(os.Getenv("CHAT_MEDIA_HOSTS"), ",") {
		add(hostFromMaybeURL(h))
	}
	for _, host := range chatMediaS3EnvHosts() {
		add(host)
	}
	return out
}

func chatMediaS3EnvHosts() []string {
	var out []string
	seen := make(map[string]struct{})
	for _, key := range []string{"S3_PUBLIC_URL", "S3_ENDPOINT", "AWS_S3_PUBLIC_URL"} {
		host := hostFromMaybeURL(os.Getenv(key))
		if host == "" {
			continue
		}
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		out = append(out, host)
	}
	return out
}

func hostFromMaybeURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return normalizeChatMediaHost(u.Hostname())
}
