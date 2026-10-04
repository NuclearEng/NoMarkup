package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	phoneUserVerified   = "00000000-0000-7000-8000-00000000a001"
	phoneUserUnverified = "00000000-0000-7000-8000-00000000a002"
	phoneUserMissing    = "00000000-0000-7000-8000-00000000a003"
	phoneUserDBErr      = "00000000-0000-7000-8000-00000000a004"
	phoneUserAdmin      = "00000000-0000-7000-8000-00000000a005"
)

type phoneRow struct {
	verified bool
	err      error
}

func (r *phoneRow) Scan(dest ...interface{}) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) > 0 {
		if p, ok := dest[0].(*bool); ok {
			*p = r.verified
		}
	}
	return nil
}

type phoneQuerier struct {
	byUser  map[string]*phoneRow
	lastSQL string
	calls   int
}

func (q *phoneQuerier) QueryRow(_ context.Context, sql string, args ...interface{}) pgx.Row {
	q.calls++
	q.lastSQL = sql
	if len(args) == 0 {
		return &phoneRow{err: pgx.ErrNoRows}
	}
	id, ok := args[0].(string)
	if !ok {
		return &phoneRow{err: pgx.ErrNoRows}
	}
	row, found := q.byUser[id]
	if !found {
		return &phoneRow{err: pgx.ErrNoRows}
	}
	return row
}

func newPhoneQuerier() *phoneQuerier {
	return &phoneQuerier{
		byUser: map[string]*phoneRow{
			phoneUserVerified:   {verified: true},
			phoneUserUnverified: {verified: false},
			phoneUserAdmin:      {verified: false},
			phoneUserDBErr:      {err: errors.New("connection refused")},
		},
	}
}

func TestRequirePhoneVerified(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		claims         *Claims
		setClaims      bool
		nilDB          bool
		wantStatus     int
		wantBodySubstr string
		wantCode       string
		wantNext       bool
		wantDBCalls    int
	}{
		{
			name:        "verified_user_passthrough",
			claims:      &Claims{UserID: phoneUserVerified, Roles: []string{"customer"}},
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 1,
		},
		{
			name:           "unverified_user_403",
			claims:         &Claims{UserID: phoneUserUnverified, Roles: []string{"customer"}},
			setClaims:      true,
			wantStatus:     http.StatusForbidden,
			wantBodySubstr: "Verify your phone in Account",
			wantCode:       PhoneNotVerifiedCode,
			wantNext:       false,
			wantDBCalls:    1,
		},
		{
			name:        "admin_skips_even_if_unverified",
			claims:      &Claims{UserID: phoneUserAdmin, Roles: []string{"admin"}},
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:        "admin_among_roles_skips",
			claims:      &Claims{UserID: phoneUserUnverified, Roles: []string{"customer", "admin"}},
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:           "missing_claims_401",
			setClaims:      false,
			wantStatus:     http.StatusUnauthorized,
			wantBodySubstr: "authentication required",
			wantNext:       false,
			wantDBCalls:    0,
		},
		{
			name:           "empty_user_id_401",
			claims:         &Claims{UserID: "", Roles: []string{"customer"}},
			setClaims:      true,
			wantStatus:     http.StatusUnauthorized,
			wantBodySubstr: "authentication required",
			wantNext:       false,
			wantDBCalls:    0,
		},
		{
			name:           "missing_user_403",
			claims:         &Claims{UserID: phoneUserMissing, Roles: []string{"provider"}},
			setClaims:      true,
			wantStatus:     http.StatusForbidden,
			wantBodySubstr: "forbidden",
			wantNext:       false,
			wantDBCalls:    1,
		},
		{
			name:           "database_error_503_fail_closed",
			claims:         &Claims{UserID: phoneUserDBErr, Roles: []string{"customer"}},
			setClaims:      true,
			wantStatus:     http.StatusServiceUnavailable,
			wantBodySubstr: "Unable to confirm phone verification",
			wantNext:       false,
			wantDBCalls:    1,
		},
		{
			name:           "nil_db_503_fail_closed",
			claims:         &Claims{UserID: phoneUserVerified, Roles: []string{"customer"}},
			setClaims:      true,
			nilDB:          true,
			wantStatus:     http.StatusServiceUnavailable,
			wantBodySubstr: "Unable to confirm phone verification",
			wantNext:       false,
			wantDBCalls:    0,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			db := newPhoneQuerier()
			var querier OwnershipQuerier = db
			if tt.nilDB {
				querier = nil
			}

			called := false
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte("ok"))
			})

			req := httptest.NewRequest(http.MethodPost, "/api/v1/listings/x/bids", nil)
			if tt.setClaims {
				req = req.WithContext(context.WithValue(req.Context(), ClaimsContextKey, tt.claims))
			}
			rec := httptest.NewRecorder()

			RequirePhoneVerified(querier)(next).ServeHTTP(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			assert.Equal(t, tt.wantNext, called)
			if !tt.nilDB {
				assert.Equal(t, tt.wantDBCalls, db.calls)
			}
			if tt.wantBodySubstr != "" {
				assert.Contains(t, rec.Body.String(), tt.wantBodySubstr)
			}
			if tt.wantCode != "" {
				assert.Contains(t, rec.Body.String(), `"code":"`+tt.wantCode+`"`)
				assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
			}
			if tt.wantDBCalls > 0 {
				assert.Contains(t, db.lastSQL, "$1")
				assert.NotContains(t, db.lastSQL, tt.claims.UserID)
			}
		})
	}
}

func TestRequirePhoneVerified_admin_skips_db_error(t *testing.T) {
	t.Parallel()

	db := newPhoneQuerier()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
	req = req.WithContext(context.WithValue(req.Context(), ClaimsContextKey, &Claims{
		UserID: phoneUserDBErr, Roles: []string{"admin"},
	}))
	rec := httptest.NewRecorder()

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	RequirePhoneVerified(db)(next).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, called)
	assert.Equal(t, 0, db.calls, "admin must not query phone_verified")
}

func TestRequirePhoneVerified_unmounted_GET_still_works(t *testing.T) {
	t.Parallel()

	db := newPhoneQuerier()
	r := chi.NewRouter()
	r.Get("/api/v1/jobs", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("browse"))
	})
	r.Group(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				ctx := context.WithValue(req.Context(), ClaimsContextKey, &Claims{
					UserID: phoneUserUnverified, Roles: []string{"customer"},
				})
				next.ServeHTTP(w, req.WithContext(ctx))
			})
		})
		r.With(RequirePhoneVerified(db)).Post("/api/v1/jobs/{id}/bids", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})
	})

	getRec := httptest.NewRecorder()
	r.ServeHTTP(getRec, httptest.NewRequest(http.MethodGet, "/api/v1/jobs", nil))
	require.Equal(t, http.StatusOK, getRec.Code, "unmounted GET browse must not require phone verification")
	assert.Equal(t, "browse", getRec.Body.String())

	postRec := httptest.NewRecorder()
	r.ServeHTTP(postRec, httptest.NewRequest(http.MethodPost, "/api/v1/jobs/00000000-0000-7000-8000-000000000100/bids", nil))
	require.Equal(t, http.StatusForbidden, postRec.Code)
	assert.Contains(t, postRec.Body.String(), PhoneNotVerifiedCode)
}

func TestRequirePhoneVerified_implements_ownership_querier(t *testing.T) {
	t.Parallel()
	var _ OwnershipQuerier = (*phoneQuerier)(nil)
}
