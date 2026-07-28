package service

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// APNsConfig holds Apple Push Notification service token-auth settings.
// Loaded from env: APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID,
// APNS_AUTH_KEY_PATH or APNS_AUTH_KEY_P8 (base64 of .p8 PEM), APNS_PRODUCTION.
type APNsConfig struct {
	KeyID      string
	TeamID     string
	BundleID   string
	AuthKeyPEM []byte
	Production bool
}

// LoadAPNsConfigFromEnv reads APNs provider config from the process environment.
// Returns nil when required fields are missing (caller should run APNs in dev/log mode).
func LoadAPNsConfigFromEnv() *APNsConfig {
	keyID := strings.TrimSpace(os.Getenv("APNS_KEY_ID"))
	teamID := strings.TrimSpace(os.Getenv("APNS_TEAM_ID"))
	bundleID := strings.TrimSpace(os.Getenv("APNS_BUNDLE_ID"))
	if keyID == "" || teamID == "" || bundleID == "" {
		return nil
	}

	var pemBytes []byte
	if path := strings.TrimSpace(os.Getenv("APNS_AUTH_KEY_PATH")); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			slog.Warn("apns: failed to read APNS_AUTH_KEY_PATH", "path", path, "error", err)
			return nil
		}
		pemBytes = data
	} else if b64 := strings.TrimSpace(os.Getenv("APNS_AUTH_KEY_P8")); b64 != "" {
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			// Allow raw PEM pasted into the env var (no base64).
			if strings.Contains(b64, "BEGIN") {
				pemBytes = []byte(b64)
			} else {
				slog.Warn("apns: APNS_AUTH_KEY_P8 is not valid base64", "error", err)
				return nil
			}
		} else {
			pemBytes = data
		}
	} else {
		return nil
	}

	prod := false
	switch strings.ToLower(strings.TrimSpace(os.Getenv("APNS_PRODUCTION"))) {
	case "1", "true", "yes", "on":
		prod = true
	}

	return &APNsConfig{
		KeyID:      keyID,
		TeamID:     teamID,
		BundleID:   bundleID,
		AuthKeyPEM: pemBytes,
		Production: prod,
	}
}

// apnsProvider sends alert pushes via APNs HTTP/2 token authentication.
type apnsProvider struct {
	keyID    string
	teamID   string
	bundleID string
	host     string
	key      *ecdsa.PrivateKey
	client   *http.Client

	mu        sync.Mutex
	jwt       string
	jwtExpiry time.Time
}

func newAPNsProvider(cfg *APNsConfig) (*apnsProvider, error) {
	if cfg == nil {
		return nil, fmt.Errorf("apns: nil config")
	}
	key, err := parseAPNsAuthKey(cfg.AuthKeyPEM)
	if err != nil {
		return nil, err
	}
	host := "https://api.sandbox.push.apple.com"
	if cfg.Production {
		host = "https://api.push.apple.com"
	}
	return &apnsProvider{
		keyID:    cfg.KeyID,
		teamID:   cfg.TeamID,
		bundleID: cfg.BundleID,
		host:     host,
		key:      key,
		// net/http enables HTTP/2 for HTTPS by default (required by APNs).
		client: &http.Client{Timeout: 15 * time.Second},
	}, nil
}

// pushMessage is a single device delivery unit with platform routing metadata.
type pushMessage struct {
	DeviceToken string
	Platform    string
	Title       string
	Body        string
	ActionURL   string
	NotifType   string
	Badge       *int
}

func (a *apnsProvider) send(ctx context.Context, msg pushMessage) error {
	token := strings.TrimSpace(msg.DeviceToken)
	if token == "" {
		return fmt.Errorf("apns: empty device token")
	}
	// Device tokens are hex; strip optional angle brackets / spaces from older formats.
	token = strings.ReplaceAll(token, " ", "")
	token = strings.Trim(token, "<>")

	payload, err := buildAPNsPayload(msg)
	if err != nil {
		return fmt.Errorf("apns: marshal payload: %w", err)
	}

	bearer, err := a.bearerJWT()
	if err != nil {
		return fmt.Errorf("apns: jwt: %w", err)
	}

	url := fmt.Sprintf("%s/3/device/%s", a.host, token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("apns: create request: %w", err)
	}
	req.Header.Set("authorization", "bearer "+bearer)
	req.Header.Set("apns-topic", a.bundleID)
	req.Header.Set("apns-push-type", "alert")
	req.Header.Set("apns-priority", "10")
	req.Header.Set("content-type", "application/json")
	if cat := apnsCategory(msg.NotifType); cat != "" {
		// Collapse-id is optional; category lives in the payload aps.category.
		_ = cat
	}

	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("apns: send: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode == http.StatusOK {
		slog.Info("apns push sent",
			"device_token", truncateToken(token),
			"title", msg.Title,
			"type", msg.NotifType,
		)
		return nil
	}

	// 410 Gone / Unregistered → token should be pruned by caller if needed.
	return fmt.Errorf("apns: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
}

func buildAPNsPayload(msg pushMessage) ([]byte, error) {
	aps := map[string]any{
		"alert": map[string]string{
			"title": msg.Title,
			"body":  msg.Body,
		},
		"sound": "default",
	}
	if msg.Badge != nil {
		aps["badge"] = *msg.Badge
	}
	if cat := apnsCategory(msg.NotifType); cat != "" {
		aps["category"] = cat
	}
	// Promotional / soft alerts can be muted client-side via willPresent; keep sound default on wire.

	payload := map[string]any{
		"aps": aps,
	}
	if msg.ActionURL != "" {
		payload["action_url"] = msg.ActionURL
	}
	if msg.NotifType != "" {
		payload["type"] = msg.NotifType
	}
	return json.Marshal(payload)
}

// apnsCategory maps notification types to UNNotificationCategory identifiers registered on iOS.
func apnsCategory(notifType string) string {
	switch strings.ToLower(strings.TrimSpace(notifType)) {
	case "bid_outbid":
		return "bid_outbid"
	case "bid_awarded":
		return "bid_awarded"
	case "auction_closing_soon", "auction_closed":
		return "auction_closing_soon"
	case "contract_created", "contract_accepted":
		return "contract_created"
	default:
		return ""
	}
}

func (a *apnsProvider) bearerJWT() (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	// APNs accepts tokens for up to 60m; refresh at 50m.
	if a.jwt != "" && time.Now().Before(a.jwtExpiry) {
		return a.jwt, nil
	}

	now := time.Now().Unix()
	headerJSON, err := json.Marshal(map[string]string{
		"alg": "ES256",
		"kid": a.keyID,
	})
	if err != nil {
		return "", err
	}
	claimsJSON, err := json.Marshal(map[string]any{
		"iss": a.teamID,
		"iat": now,
	})
	if err != nil {
		return "", err
	}

	header := base64.RawURLEncoding.EncodeToString(headerJSON)
	claims := base64.RawURLEncoding.EncodeToString(claimsJSON)
	signingInput := header + "." + claims

	hash := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, a.key, hash[:])
	if err != nil {
		return "", fmt.Errorf("sign: %w", err)
	}

	// JOSE ES256 signature is r||s, each 32 bytes for P-256.
	sig := make([]byte, 64)
	rb := r.Bytes()
	sb := s.Bytes()
	copy(sig[32-len(rb):32], rb)
	copy(sig[64-len(sb):64], sb)

	token := signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
	a.jwt = token
	a.jwtExpiry = time.Now().Add(50 * time.Minute)
	return token, nil
}

func parseAPNsAuthKey(pemBytes []byte) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, fmt.Errorf("apns: no PEM block in auth key")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		// Some tooling emits SEC1 EC PRIVATE KEY.
		if ecKey, err2 := x509.ParseECPrivateKey(block.Bytes); err2 == nil {
			return ecKey, nil
		}
		return nil, fmt.Errorf("apns: parse private key: %w", err)
	}
	ecKey, ok := key.(*ecdsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("apns: auth key is not ECDSA")
	}
	if params := ecKey.Curve.Params(); params != nil && params.BitSize != 256 {
		return nil, fmt.Errorf("apns: expected P-256 key, got bit size %d", params.BitSize)
	}
	// Ensure D is set (defensive).
	if ecKey.D == nil || ecKey.D.Cmp(big.NewInt(0)) == 0 {
		return nil, fmt.Errorf("apns: invalid EC private key scalar")
	}
	return ecKey, nil
}

func truncateToken(token string) string {
	if len(token) <= 12 {
		return token
	}
	return token[:6] + "…" + token[len(token)-4:]
}
