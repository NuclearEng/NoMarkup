package middleware

import (
	"context"
	"crypto/rsa"
	"fmt"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const (
	// ClaimsContextKey is the context key for storing JWT claims.
	ClaimsContextKey contextKey = "claims"
)

// Claims represents the JWT claims extracted from an access token.
type Claims struct {
	UserID string
	Email  string
	Roles  []string
}

// AuthMiddleware validates RS256 JWT tokens and injects claims into the request context.
type AuthMiddleware struct {
	publicKey *rsa.PublicKey
}

// NewAuthMiddleware creates a new AuthMiddleware with the given RSA public key.
func NewAuthMiddleware(publicKey *rsa.PublicKey) *AuthMiddleware {
	return &AuthMiddleware{publicKey: publicKey}
}

// Handler returns the HTTP middleware handler.
func (m *AuthMiddleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, `{"error":"missing authorization header"}`, http.StatusUnauthorized)
			return
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, `{"error":"invalid authorization header format"}`, http.StatusUnauthorized)
			return
		}

		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

		claims, err := m.validateToken(tokenStr)
		if err != nil {
			http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), ClaimsContextKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

type tokenClaims struct {
	jwt.RegisteredClaims
	Email string   `json:"email"`
	Roles []string `json:"roles"`
}

func (m *AuthMiddleware) validateToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &tokenClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.publicKey, nil
	})
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}

	tc, ok := token.Claims.(*tokenClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	return &Claims{
		UserID: tc.Subject,
		Email:  tc.Email,
		Roles:  tc.Roles,
	}, nil
}

// GetClaims extracts the Claims from the request context.
func GetClaims(ctx context.Context) (*Claims, bool) {
	claims, ok := ctx.Value(ClaimsContextKey).(*Claims)
	return claims, ok
}
