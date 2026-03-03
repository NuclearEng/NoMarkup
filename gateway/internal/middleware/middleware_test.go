package middleware

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- helpers ---

func generateTestKeyPair(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	return key
}

func signTestJWT(t *testing.T, key *rsa.PrivateKey, subject, email string, roles []string, expiresAt time.Time) string {
	t.Helper()
	claims := tokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   subject,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
		Email: email,
		Roles: roles,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := token.SignedString(key)
	require.NoError(t, err)
	return signed
}

// okHandler is a simple handler that writes 200 OK and the user ID from claims if present.
func okHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if claims, ok := GetClaims(r.Context()); ok {
			w.Header().Set("X-User-ID", claims.UserID)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}
}

// --- AuthMiddleware tests ---

func TestAuthMiddleware(t *testing.T) {
	t.Parallel()

	key := generateTestKeyPair(t)
	authMw := NewAuthMiddleware(&key.PublicKey)

	tests := []struct {
		name           string
		authHeader     string
		wantStatus     int
		wantUserID     string
		wantBodySubstr string
	}{
		{
			name:           "valid_JWT_passes",
			authHeader:     "Bearer " + signTestJWT(t, key, "user-123", "test@example.com", []string{"customer"}, time.Now().Add(15*time.Minute)),
			wantStatus:     http.StatusOK,
			wantUserID:     "user-123",
			wantBodySubstr: "ok",
		},
		{
			name:           "missing_token_returns_401",
			authHeader:     "",
			wantStatus:     http.StatusUnauthorized,
			wantBodySubstr: "missing authorization header",
		},
		{
			name:           "missing_Bearer_prefix_returns_401",
			authHeader:     "Token abc123",
			wantStatus:     http.StatusUnauthorized,
			wantBodySubstr: "invalid authorization header format",
		},
		{
			name:           "expired_token_returns_401",
			authHeader:     "Bearer " + signTestJWT(t, key, "user-123", "test@example.com", []string{"customer"}, time.Now().Add(-1*time.Hour)),
			wantStatus:     http.StatusUnauthorized,
			wantBodySubstr: "invalid or expired token",
		},
		{
			name:           "invalid_token_returns_401",
			authHeader:     "Bearer not-a-real-jwt-token",
			wantStatus:     http.StatusUnauthorized,
			wantBodySubstr: "invalid or expired token",
		},
		{
			name: "wrong_signing_key_returns_401",
			authHeader: func() string {
				otherKey := generateTestKeyPair(t)
				return "Bearer " + signTestJWT(t, otherKey, "user-123", "test@example.com", []string{"customer"}, time.Now().Add(15*time.Minute))
			}(),
			wantStatus:     http.StatusUnauthorized,
			wantBodySubstr: "invalid or expired token",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
			}
			rec := httptest.NewRecorder()

			handler := authMw.Handler(okHandler())
			handler.ServeHTTP(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantBodySubstr != "" {
				assert.Contains(t, rec.Body.String(), tt.wantBodySubstr)
			}
			if tt.wantUserID != "" {
				assert.Equal(t, tt.wantUserID, rec.Header().Get("X-User-ID"))
			}
		})
	}
}

func TestAuthMiddleware_claims_in_context(t *testing.T) {
	t.Parallel()

	key := generateTestKeyPair(t)
	authMw := NewAuthMiddleware(&key.PublicKey)

	token := signTestJWT(t, key, "user-456", "admin@example.com", []string{"admin", "provider"}, time.Now().Add(15*time.Minute))

	var capturedClaims *Claims
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, ok := GetClaims(r.Context())
		require.True(t, ok)
		capturedClaims = c
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	authMw.Handler(inner).ServeHTTP(rec, req)

	require.NotNil(t, capturedClaims)
	assert.Equal(t, "user-456", capturedClaims.UserID)
	assert.Equal(t, "admin@example.com", capturedClaims.Email)
	assert.Equal(t, []string{"admin", "provider"}, capturedClaims.Roles)
}

// --- RequireAdmin tests ---

func TestRequireAdmin(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		claims         *Claims
		setClaims      bool
		wantStatus     int
		wantBodySubstr string
	}{
		{
			name:       "admin_role_passes",
			claims:     &Claims{UserID: "u1", Email: "a@b.com", Roles: []string{"admin"}},
			setClaims:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "admin_among_multiple_roles_passes",
			claims:     &Claims{UserID: "u2", Email: "a@b.com", Roles: []string{"customer", "admin", "provider"}},
			setClaims:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:           "non_admin_returns_403",
			claims:         &Claims{UserID: "u3", Email: "a@b.com", Roles: []string{"customer", "provider"}},
			setClaims:      true,
			wantStatus:     http.StatusForbidden,
			wantBodySubstr: "admin access required",
		},
		{
			name:           "empty_roles_returns_403",
			claims:         &Claims{UserID: "u4", Email: "a@b.com", Roles: []string{}},
			setClaims:      true,
			wantStatus:     http.StatusForbidden,
			wantBodySubstr: "admin access required",
		},
		{
			name:           "no_claims_in_context_returns_401",
			setClaims:      false,
			wantStatus:     http.StatusUnauthorized,
			wantBodySubstr: "authentication required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/admin/test", nil)
			if tt.setClaims {
				ctx := context.WithValue(req.Context(), ClaimsContextKey, tt.claims)
				req = req.WithContext(ctx)
			}
			rec := httptest.NewRecorder()

			handler := RequireAdmin(okHandler())
			handler.ServeHTTP(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantBodySubstr != "" {
				assert.Contains(t, rec.Body.String(), tt.wantBodySubstr)
			}
		})
	}
}

// --- Recovery tests ---

func TestRecovery(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		handler        http.Handler
		wantStatus     int
		wantBodySubstr string
	}{
		{
			name: "panicking_handler_returns_500",
			handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				panic("something went terribly wrong")
			}),
			wantStatus:     http.StatusInternalServerError,
			wantBodySubstr: "internal server error",
		},
		{
			name: "panicking_handler_with_error_type_returns_500",
			handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				panic(42)
			}),
			wantStatus:     http.StatusInternalServerError,
			wantBodySubstr: "internal server error",
		},
		{
			name:       "non_panicking_handler_passes_through",
			handler:    okHandler(),
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			rec := httptest.NewRecorder()

			handler := Recovery(tt.handler)
			// This must not panic.
			assert.NotPanics(t, func() {
				handler.ServeHTTP(rec, req)
			})

			assert.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantBodySubstr != "" {
				assert.Contains(t, rec.Body.String(), tt.wantBodySubstr)
			}
		})
	}
}

// --- Logging tests ---

func TestLogging(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name            string
		requestID       string
		wantGeneratedID bool
	}{
		{
			name:            "generates_request_id_if_missing",
			requestID:       "",
			wantGeneratedID: true,
		},
		{
			name:            "uses_provided_request_id",
			requestID:       "req-abc-123",
			wantGeneratedID: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			if tt.requestID != "" {
				req.Header.Set("X-Request-ID", tt.requestID)
			}
			rec := httptest.NewRecorder()

			handler := Logging(okHandler())
			handler.ServeHTTP(rec, req)

			assert.Equal(t, http.StatusOK, rec.Code)

			responseID := rec.Header().Get("X-Request-ID")
			assert.NotEmpty(t, responseID)

			if !tt.wantGeneratedID {
				assert.Equal(t, tt.requestID, responseID)
			}
		})
	}
}

func TestLogging_wrappedWriter_captures_status(t *testing.T) {
	t.Parallel()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	req := httptest.NewRequest(http.MethodGet, "/missing", nil)
	rec := httptest.NewRecorder()

	Logging(inner).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

// --- GetClaims tests ---

func TestGetClaims(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		ctx      context.Context
		wantOK   bool
		wantUser string
	}{
		{
			name: "claims_present",
			ctx: context.WithValue(context.Background(), ClaimsContextKey, &Claims{
				UserID: "user-1",
				Email:  "a@b.com",
				Roles:  []string{"customer"},
			}),
			wantOK:   true,
			wantUser: "user-1",
		},
		{
			name:   "no_claims",
			ctx:    context.Background(),
			wantOK: false,
		},
		{
			name:   "wrong_type_in_context",
			ctx:    context.WithValue(context.Background(), ClaimsContextKey, "not-a-claims-struct"),
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			claims, ok := GetClaims(tt.ctx)
			assert.Equal(t, tt.wantOK, ok)
			if tt.wantOK {
				require.NotNil(t, claims)
				assert.Equal(t, tt.wantUser, claims.UserID)
			}
		})
	}
}

// --- RateLimit pass-through test ---

func TestRateLimit_passthrough(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()

	handler := RateLimit(okHandler())
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "ok", rec.Body.String())
}
