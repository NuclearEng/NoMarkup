package middleware

import (
	"context"
	"crypto/rsa"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const (
	// ClaimsContextKey is the context key for storing JWT claims.
	ClaimsContextKey contextKey = "claims"

	// defaultJWTIssuer is the expected `iss` claim when JWT_ISSUER is unset.
	defaultJWTIssuer = "https://auth.nomarkup.com"
	// defaultJWTAudience is the expected `aud` claim when JWT_AUDIENCE is unset.
	defaultJWTAudience = "nomarkup-api"
)

// expectedJWTIssuer returns the JWT_ISSUER env value or the default.
func expectedJWTIssuer() string {
	if v := strings.TrimSpace(os.Getenv("JWT_ISSUER")); v != "" {
		return v
	}
	return defaultJWTIssuer
}

// expectedJWTAudience returns the JWT_AUDIENCE env value or the default.
func expectedJWTAudience() string {
	if v := strings.TrimSpace(os.Getenv("JWT_AUDIENCE")); v != "" {
		return v
	}
	return defaultJWTAudience
}

// Claims represents the JWT claims extracted from an access token.
type Claims struct {
	UserID string
	Email  string
	Roles  []string
	// ExpiresAt is the token's `exp` claim as a wall-clock time. Zero when the
	// token carried no expiry. WebSocket proxies use this to bound a long-lived
	// socket's lifetime to the token (close at exp), so a revoked/expired
	// session cannot keep streaming privileged real-time data past expiry.
	ExpiresAt time.Time
}

// AuthMiddleware validates RS256 JWT tokens and injects claims into the request context.
type AuthMiddleware struct {
	publicKey *rsa.PublicKey
}

// NewAuthMiddleware creates a new AuthMiddleware with the given RSA public key.
func NewAuthMiddleware(publicKey *rsa.PublicKey) *AuthMiddleware {
	return &AuthMiddleware{publicKey: publicKey}
}

// errInvalidClaims is returned when the token's iss or aud does not match
// the gateway's expected values. We surface a distinct error code so clients
// can distinguish claim-mismatch from expired/invalid-signature.
var errInvalidClaims = errors.New("invalid claims")

// Handler returns the HTTP middleware handler.
func (m *AuthMiddleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			slog.WarnContext(r.Context(), "auth rejected: missing authorization header",
				"path", r.URL.Path,
				"remote_addr", r.RemoteAddr,
			)
			http.Error(w, `{"error":"missing authorization header"}`, http.StatusUnauthorized)
			return
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			slog.WarnContext(r.Context(), "auth rejected: invalid header format",
				"path", r.URL.Path,
				"remote_addr", r.RemoteAddr,
			)
			http.Error(w, `{"error":"invalid authorization header format"}`, http.StatusUnauthorized)
			return
		}

		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

		claims, err := m.validateToken(tokenStr)
		if err != nil {
			if errors.Is(err, errInvalidClaims) {
				slog.WarnContext(r.Context(), "auth rejected: invalid iss/aud claim",
					"path", r.URL.Path,
					"remote_addr", r.RemoteAddr,
					"error", err,
				)
				http.Error(w, `{"error":"invalid token","code":"auth_invalid_claims"}`, http.StatusUnauthorized)
				return
			}
			slog.WarnContext(r.Context(), "auth rejected: invalid or expired token",
				"path", r.URL.Path,
				"remote_addr", r.RemoteAddr,
				"error", err,
			)
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

// ValidateToken parses and validates a JWT token string, returning the extracted claims.
func (m *AuthMiddleware) ValidateToken(tokenStr string) (*Claims, error) {
	return m.validateToken(tokenStr)
}

func (m *AuthMiddleware) validateToken(tokenStr string) (*Claims, error) {
	wantIss := expectedJWTIssuer()
	wantAud := expectedJWTAudience()

	token, err := jwt.ParseWithClaims(
		tokenStr,
		&tokenClaims{},
		func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return m.publicKey, nil
		},
		jwt.WithIssuer(wantIss),
		jwt.WithAudience(wantAud),
	)
	if err != nil {
		// jwt/v5 returns typed sentinel errors for iss/aud mismatch. Wrap them
		// so the handler can return a distinct auth_invalid_claims response.
		if errors.Is(err, jwt.ErrTokenInvalidIssuer) || errors.Is(err, jwt.ErrTokenInvalidAudience) {
			return nil, fmt.Errorf("%w: %w", errInvalidClaims, err)
		}
		return nil, fmt.Errorf("parse token: %w", err)
	}

	tc, ok := token.Claims.(*tokenClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	var expiresAt time.Time
	if tc.ExpiresAt != nil {
		expiresAt = tc.ExpiresAt.Time
	}

	return &Claims{
		UserID:    tc.Subject,
		Email:     tc.Email,
		Roles:     tc.Roles,
		ExpiresAt: expiresAt,
	}, nil
}

// GetClaims extracts the Claims from the request context.
func GetClaims(ctx context.Context) (*Claims, bool) {
	claims, ok := ctx.Value(ClaimsContextKey).(*Claims)
	return claims, ok
}
