package service

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	accessTokenExpiry  = 15 * time.Minute
	refreshTokenExpiry = 7 * 24 * time.Hour
)

// JWTManager handles JWT token generation and validation using RS256.
type JWTManager struct {
	privateKey *rsa.PrivateKey
}

// NewJWTManager creates a new JWTManager with the given RSA private key.
func NewJWTManager(privateKey *rsa.PrivateKey) *JWTManager {
	return &JWTManager{privateKey: privateKey}
}

// AccessTokenClaims represents the claims encoded in an access token.
type AccessTokenClaims struct {
	jwt.RegisteredClaims
	Email string   `json:"email"`
	Roles []string `json:"roles"`
}

// GenerateAccessToken creates a signed RS256 JWT access token.
func (m *JWTManager) GenerateAccessToken(userID, email string, roles []string) (string, time.Time, error) {
	now := time.Now()
	expiresAt := now.Add(accessTokenExpiry)

	claims := AccessTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
		Email: email,
		Roles: roles,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := token.SignedString(m.privateKey)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign access token: %w", err)
	}
	return signed, expiresAt, nil
}

// GenerateRefreshToken creates a cryptographically random refresh token
// and returns both the raw token (to send to client) and its SHA-256 hash (to store in DB).
func GenerateRefreshToken() (raw string, hash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", fmt.Errorf("generate refresh token: %w", err)
	}
	raw = hex.EncodeToString(b)
	hash = HashToken(raw)
	return raw, hash, nil
}

// HashToken returns the SHA-256 hex digest of a raw token string.
func HashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

// ValidateAccessToken parses and validates an RS256 JWT access token using the public key
// derived from the private key. Returns the claims if valid.
func (m *JWTManager) ValidateAccessToken(tokenStr string) (*AccessTokenClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &AccessTokenClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return &m.privateKey.PublicKey, nil
	})
	if err != nil {
		return nil, fmt.Errorf("validate access token: %w", err)
	}

	claims, ok := token.Claims.(*AccessTokenClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("validate access token: invalid claims")
	}
	return claims, nil
}

// RefreshTokenExpiry returns the configured refresh token expiry duration.
func RefreshTokenExpiry() time.Duration {
	return refreshTokenExpiry
}
