package handler

// STOREKIT-B2 / F6 — App Store JWS verify (Rail B digital IAP).
//
// Route (auth required):
//
//	POST /api/v1/iap/app-store/verify
//
// Fail-closed rules:
//   - Missing claims → 401.
//   - Empty / unsigned / garbage JWS → 400 (never 200 {"valid":true}).
//   - APP_STORE_IAP_VERIFY unset/false → 503 "not configured".
//   - Flag true + x5c chain to Apple Root CA - G3 (or IAPHandler.RootPool)
//     + JWS signature + productId/transactionId → 200 {valid:true,...}
//     and persist iap_entitlements.
//
// Env:
//
//	APP_STORE_IAP_VERIFY   must be true/1/yes/on to attest
//	APP_STORE_ROOT_CERT_PEM  ignored; the Apple G3 root is embedded

import (
	"context"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

const (
	appStoreIAPVerifyNotConfiguredMsg = "App Store IAP verification is not configured. Set APP_STORE_IAP_VERIFY=true before the server will attest a transaction."
	appStoreIAPCryptoNotReadyMsg      = "App Store IAP verification is not configured (Apple root certificate chain failed to load). Refusing to attest validity."
	appStoreIAPJWSRequiredMsg         = "jws is required"
	appStoreIAPJWSInvalidMsg          = "jws is not a valid compact JWS (unsigned or garbage)"
	appStoreIAPX5CRequiredMsg         = "jws header is missing a valid x5c certificate chain"
	appStoreIAPChainInvalidMsg        = "jws certificate chain is not trusted"
	appStoreIAPSignatureInvalidMsg    = "jws signature is invalid"
	appStoreIAPPayloadInvalidMsg      = "jws payload is missing productId or transactionId"
	appStoreIAPPersistConflictMsg     = "transaction already entitled to another account"
)

// IAPHandler owns StoreKit / App Store server-verify routes.
type IAPHandler struct {
	DB *pgxpool.Pool
	// RootPool, when set, replaces the embedded Apple Root CA - G3.
	// Tests inject a synthetic root here.
	RootPool *x509.CertPool
	persist  func(ctx context.Context, userID, productID, transactionID, environment string) error
}

// NewIAPHandler constructs the App Store IAP verifier. A nil db skips
// entitlement persist (unit tests); production passes the write pool.
func NewIAPHandler(db *pgxpool.Pool) *IAPHandler {
	return &IAPHandler{DB: db}
}

type appStoreVerifyRequest struct {
	JWS               string   `json:"jws"`
	JWSRepresentation string   `json:"jws_representation"`
	ProductIDs        []string `json:"product_ids"`
}

type appStoreVerifyResponse struct {
	Valid         bool   `json:"valid"`
	ProductID     string `json:"product_id"`
	TransactionID string `json:"transaction_id"`
	Environment   string `json:"environment"`
}

type appStoreJWSHeader struct {
	Alg string   `json:"alg"`
	X5C []string `json:"x5c"`
}

// VerifyAppStore handles POST /api/v1/iap/app-store/verify.
// Auth is required at the router; the handler re-checks claims.
func (h *IAPHandler) VerifyAppStore(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
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

	if !appStoreIAPVerifyEnabled() {
		writeError(w, http.StatusServiceUnavailable, appStoreIAPVerifyNotConfiguredMsg)
		return
	}
	if _, err := h.rootPool(); err != nil {
		writeError(w, http.StatusServiceUnavailable, appStoreIAPCryptoNotReadyMsg)
		return
	}

	productID, transactionID, environment, err := h.verifyAppStoreJWS(jws)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.persistEntitlement(r.Context(), claims.UserID, productID, transactionID, environment); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeError(w, http.StatusConflict, appStoreIAPPersistConflictMsg)
			return
		}
		slog.ErrorContext(r.Context(), "iap persist entitlement failed",
			"error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to persist entitlement")
		return
	}

	writeJSON(w, http.StatusOK, appStoreVerifyResponse{
		Valid:         true,
		ProductID:     productID,
		TransactionID: transactionID,
		Environment:   environment,
	})
}

func appStoreIAPVerifyEnabled() bool {
	return envFlagTruthy("APP_STORE_IAP_VERIFY")
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

func (h *IAPHandler) rootPool() (*x509.CertPool, error) {
	if h != nil && h.RootPool != nil {
		return h.RootPool, nil
	}
	return appleRootCertPool()
}

func (h *IAPHandler) verifyAppStoreJWS(jws string) (productID, transactionID, environment string, err error) {
	parts := strings.Split(jws, ".")
	if len(parts) != 3 {
		return "", "", "", errors.New(appStoreIAPJWSInvalidMsg)
	}

	headerJSON, err := decodeJWSSegment(parts[0])
	if err != nil {
		return "", "", "", errors.New(appStoreIAPJWSInvalidMsg)
	}
	var header appStoreJWSHeader
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return "", "", "", errors.New(appStoreIAPJWSInvalidMsg)
	}
	alg := strings.TrimSpace(header.Alg)
	if alg == "" || strings.EqualFold(alg, "none") {
		return "", "", "", errors.New(appStoreIAPJWSInvalidMsg)
	}
	if len(header.X5C) == 0 {
		return "", "", "", errors.New(appStoreIAPX5CRequiredMsg)
	}

	certs, err := parseX5C(header.X5C)
	if err != nil {
		return "", "", "", errors.New(appStoreIAPX5CRequiredMsg)
	}
	leaf := certs[0]
	if err := h.verifyCertChain(leaf, certs[1:]); err != nil {
		return "", "", "", errors.New(appStoreIAPChainInvalidMsg)
	}
	if err := verifyJWSSignature(alg, parts[0]+"."+parts[1], parts[2], leaf); err != nil {
		return "", "", "", errors.New(appStoreIAPSignatureInvalidMsg)
	}

	payload, err := decodeJWSSegment(parts[1])
	if err != nil {
		return "", "", "", errors.New(appStoreIAPJWSInvalidMsg)
	}
	productID, transactionID, environment, err = extractIAPClaims(payload)
	if err != nil {
		return "", "", "", errors.New(appStoreIAPPayloadInvalidMsg)
	}
	return productID, transactionID, environment, nil
}

func (h *IAPHandler) verifyCertChain(leaf *x509.Certificate, intermediates []*x509.Certificate) error {
	roots, err := h.rootPool()
	if err != nil || roots == nil {
		if err == nil {
			err = errors.New(appStoreIAPCryptoNotReadyMsg)
		}
		return err
	}
	interPool := x509.NewCertPool()
	for _, cert := range intermediates {
		interPool.AddCert(cert)
	}
	_, err = leaf.Verify(x509.VerifyOptions{
		Roots:         roots,
		Intermediates: interPool,
		KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	})
	return err
}

func verifyJWSSignature(alg, signingInput, sigSeg string, leaf *x509.Certificate) error {
	alg = strings.ToUpper(strings.TrimSpace(alg))
	switch alg {
	case "ES256", "ES384", "ES512":
	default:
		return fmt.Errorf("unsupported alg %s", alg)
	}
	method := jwt.GetSigningMethod(alg)
	if method == nil {
		return fmt.Errorf("unknown alg %s", alg)
	}
	sig, err := decodeJWSSegment(sigSeg)
	if err != nil {
		return err
	}
	if leaf.PublicKey == nil {
		return errors.New("leaf has no public key")
	}
	return method.Verify(signingInput, sig, leaf.PublicKey)
}

func parseX5C(x5c []string) ([]*x509.Certificate, error) {
	out := make([]*x509.Certificate, 0, len(x5c))
	for _, raw := range x5c {
		der, err := decodeX5C(raw)
		if err != nil {
			return nil, err
		}
		cert, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, err
		}
		out = append(out, cert)
	}
	if len(out) == 0 {
		return nil, errors.New("empty x5c")
	}
	return out, nil
}

func decodeX5C(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, errors.New("empty x5c entry")
	}
	if der, err := base64.StdEncoding.DecodeString(s); err == nil && len(der) > 0 {
		return der, nil
	}
	if der, err := base64.RawStdEncoding.DecodeString(s); err == nil && len(der) > 0 {
		return der, nil
	}
	if der, err := base64.RawURLEncoding.DecodeString(s); err == nil && len(der) > 0 {
		return der, nil
	}
	return base64.URLEncoding.DecodeString(s)
}

func extractIAPClaims(payload []byte) (productID, transactionID, environment string, err error) {
	var raw map[string]any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return "", "", "", err
	}
	productID = firstJSONString(raw, "productId", "product_id")
	transactionID = firstJSONString(raw, "transactionId", "transaction_id")
	environment = firstJSONString(raw, "environment")
	if productID == "" || transactionID == "" {
		return "", "", "", errors.New("missing productId or transactionId")
	}
	return productID, transactionID, environment, nil
}

func firstJSONString(raw map[string]any, keys ...string) string {
	for _, k := range keys {
		v, ok := raw[k]
		if !ok || v == nil {
			continue
		}
		switch t := v.(type) {
		case string:
			if s := strings.TrimSpace(t); s != "" {
				return s
			}
		}
	}
	return ""
}

func (h *IAPHandler) persistEntitlement(ctx context.Context, userID, productID, transactionID, environment string) error {
	if h != nil && h.persist != nil {
		return h.persist(ctx, userID, productID, transactionID, environment)
	}
	if h == nil || h.DB == nil {
		return nil
	}
	_, err := h.DB.Exec(ctx, `
		INSERT INTO iap_entitlements (user_id, product_id, transaction_id, environment)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, product_id) DO UPDATE
		SET transaction_id = EXCLUDED.transaction_id,
		    environment = EXCLUDED.environment`,
		userID, productID, transactionID, environment,
	)
	return err
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
