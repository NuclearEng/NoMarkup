package handler

// STOREKIT-B2 — App Store JWS verify scaffold (Rail B digital IAP).
//
// Route (auth required):
//
//	POST /api/v1/iap/app-store/verify
//
// Fail-closed rules:
//   - Missing claims → 401.
//   - Empty / unsigned / garbage JWS → 400 (never 200 {"valid":true}).
//   - APP_STORE_IAP_VERIFY unset/false → 503 "not configured".
//   - Flag true but Apple root / cert-chain crypto is not implemented → 503.
//   - This pass does NOT walk Apple's x5c chain and therefore MUST NOT
//     return {"valid":true}. Structural JWS parse only rejects garbage.
//
// Env:
//
//	APP_STORE_IAP_VERIFY   must be true/1/yes/on to even consider verify
//	APP_STORE_ROOT_CERT_PEM  reserved; presence alone is not crypto

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

const (
	appStoreIAPVerifyNotConfiguredMsg = "App Store IAP verification is not configured. Set APP_STORE_IAP_VERIFY=true and install the Apple root/JWS cert chain before the server will attest a transaction."
	appStoreIAPCryptoNotReadyMsg      = "App Store IAP verification is not configured (Apple root certificate chain is not implemented). Refusing to attest validity."
	appStoreIAPJWSRequiredMsg         = "jws is required"
	appStoreIAPJWSInvalidMsg          = "jws is not a valid compact JWS (unsigned or garbage)"
)

// IAPHandler owns StoreKit / App Store server-verify routes.
type IAPHandler struct{}

// NewIAPHandler constructs the fail-closed App Store IAP verifier.
func NewIAPHandler() *IAPHandler {
	return &IAPHandler{}
}

type appStoreVerifyRequest struct {
	JWS               string   `json:"jws"`
	JWSRepresentation string   `json:"jws_representation"`
	ProductIDs        []string `json:"product_ids"`
}

// VerifyAppStore handles POST /api/v1/iap/app-store/verify.
// Auth is required at the router; the handler re-checks claims.
func (h *IAPHandler) VerifyAppStore(w http.ResponseWriter, r *http.Request) {
	if _, ok := middleware.GetClaims(r.Context()); !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req appStoreVerifyRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	jws := strings.TrimSpace(req.JWS)
	if jws == "" {
		jws = strings.TrimSpace(req.JWSRepresentation)
	}
	if jws == "" {
		writeError(w, http.StatusBadRequest, appStoreIAPJWSRequiredMsg)
		return
	}
	if err := parseCompactJWS(jws); err != nil {
		writeError(w, http.StatusBadRequest, appStoreIAPJWSInvalidMsg)
		return
	}

	// Flag + real Apple-root crypto are both required. Structural parse
	// above only rejects garbage — it is not a validity attestation.
	if !appStoreIAPVerifyEnabled() {
		writeError(w, http.StatusServiceUnavailable, appStoreIAPVerifyNotConfiguredMsg)
		return
	}
	if !appStoreJWSCryptoReady() {
		writeError(w, http.StatusServiceUnavailable, appStoreIAPCryptoNotReadyMsg)
		return
	}

	// Unreachable until a real Apple-root verifier is implemented.
	// Kept as a hard fail-closed so a future flag flip cannot leak valid:true.
	writeError(w, http.StatusServiceUnavailable, appStoreIAPCryptoNotReadyMsg)
}

func appStoreIAPVerifyEnabled() bool {
	return envFlagTruthy("APP_STORE_IAP_VERIFY")
}

// appStoreJWSCryptoReady is true only when a real Apple-root chain verifier
// is wired. Reserved env APP_STORE_ROOT_CERT_PEM is intentionally ignored:
// loading a PEM is not the same as verifying StoreKit JWS against Apple.
func appStoreJWSCryptoReady() bool {
	return false
}

func envFlagTruthy(key string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// parseCompactJWS requires a 3-part JWS, a decodable header with a real
// alg (not "none"), a decodable payload, and a non-empty signature part.
// It does not verify the signature.
func parseCompactJWS(jws string) error {
	parts := strings.Split(jws, ".")
	if len(parts) != 3 {
		return errors.New("not compact JWS")
	}
	headerJSON, err := decodeJWSSegment(parts[0])
	if err != nil {
		return fmt.Errorf("header: %w", err)
	}
	var header struct {
		Alg string `json:"alg"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return fmt.Errorf("header json: %w", err)
	}
	alg := strings.TrimSpace(header.Alg)
	if alg == "" || strings.EqualFold(alg, "none") {
		return errors.New("unsigned JWS")
	}
	if _, err := decodeJWSSegment(parts[1]); err != nil {
		return fmt.Errorf("payload: %w", err)
	}
	if strings.TrimSpace(parts[2]) == "" {
		return errors.New("empty signature")
	}
	if _, err := decodeJWSSegment(parts[2]); err != nil {
		return fmt.Errorf("signature: %w", err)
	}
	return nil
}

func decodeJWSSegment(seg string) ([]byte, error) {
	seg = strings.TrimSpace(seg)
	if seg == "" {
		return nil, errors.New("empty segment")
	}
	// JWS uses base64url without padding.
	decoded, err := base64.RawURLEncoding.DecodeString(seg)
	if err != nil {
		decoded, err = base64.URLEncoding.DecodeString(seg)
	}
	if err != nil {
		return nil, err
	}
	if len(decoded) == 0 {
		return nil, errors.New("empty decoded segment")
	}
	return decoded, nil
}
