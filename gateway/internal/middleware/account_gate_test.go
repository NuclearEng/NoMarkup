package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	ageUserVerified   = "00000000-0000-7000-8000-00000000b001"
	ageUserUnverified = "00000000-0000-7000-8000-00000000b002"
	ageUserMissing    = "00000000-0000-7000-8000-00000000b003"
	ageUserDBErr      = "00000000-0000-7000-8000-00000000b004"

	termsUserAccepted = "00000000-0000-7000-8000-00000000c001"
	termsUserRejected = "00000000-0000-7000-8000-00000000c002"
	termsUserMissing  = "00000000-0000-7000-8000-00000000c003"
	termsUserEmpty    = "00000000-0000-7000-8000-00000000c004"
	termsUserDBErr    = "00000000-0000-7000-8000-00000000c005"
)

const ageVerifiedQueryExpect = `SELECT dob_verified_at IS NOT NULL FROM users WHERE id = $1 AND deleted_at IS NULL`

type ageRow struct {
	verified bool
	err      error
}

func (r *ageRow) Scan(dest ...interface{}) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) > 0 {
		p, ok := dest[0].(*bool)
		if !ok {
			return errors.New("age scan: verified dest")
		}
		*p = r.verified
	}
	return nil
}

type ageQuerier struct {
	byUser  map[string]*ageRow
	lastSQL string
	calls   int
}

func (q *ageQuerier) QueryRow(_ context.Context, sql string, args ...interface{}) pgx.Row {
	q.calls++
	q.lastSQL = sql
	if len(args) == 0 {
		return &ageRow{err: pgx.ErrNoRows}
	}
	id, ok := args[0].(string)
	if !ok {
		return &ageRow{err: pgx.ErrNoRows}
	}
	row, found := q.byUser[id]
	if !found {
		return &ageRow{err: pgx.ErrNoRows}
	}
	return row
}

func newAgeQuerier() *ageQuerier {
	return &ageQuerier{
		byUser: map[string]*ageRow{
			ageUserVerified:   {verified: true},
			ageUserUnverified: {verified: false},
			ageUserDBErr:      {err: errors.New("connection refused")},
		},
	}
}

type termsRow struct {
	version  string
	accepted bool
	err      error
}

func (r *termsRow) Scan(dest ...interface{}) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) > 0 {
		p, ok := dest[0].(*string)
		if !ok {
			return errors.New("terms scan: version dest")
		}
		*p = r.version
	}
	if len(dest) > 1 {
		p, ok := dest[1].(*bool)
		if !ok {
			return errors.New("terms scan: accepted dest")
		}
		*p = r.accepted
	}
	return nil
}

type termsQuerier struct {
	byUser  map[string]*termsRow
	lastSQL string
	calls   int
}

func (q *termsQuerier) QueryRow(_ context.Context, sql string, args ...interface{}) pgx.Row {
	q.calls++
	q.lastSQL = sql
	if len(args) == 0 {
		return &termsRow{err: pgx.ErrNoRows}
	}
	id, ok := args[0].(string)
	if !ok {
		return &termsRow{err: pgx.ErrNoRows}
	}
	row, found := q.byUser[id]
	if !found {
		return &termsRow{err: pgx.ErrNoRows}
	}
	return row
}

func newTermsQuerier() *termsQuerier {
	return &termsQuerier{
		byUser: map[string]*termsRow{
			termsUserAccepted: {version: "2026.04", accepted: true},
			termsUserRejected: {version: "2026.04", accepted: false},
			// Accepted flag is true so a check that ignores a blank version
			// would let the request through.
			termsUserEmpty: {version: "", accepted: true},
			termsUserDBErr: {err: errors.New("connection refused")},
		},
	}
}

func serveGate(mw func(http.Handler) http.Handler, method, path string, claims *Claims, setClaims bool) (*httptest.ResponseRecorder, bool) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	req := httptest.NewRequest(method, path, nil)
	if setClaims {
		req = req.WithContext(context.WithValue(req.Context(), ClaimsContextKey, claims))
	}
	rec := httptest.NewRecorder()
	mw(next).ServeHTTP(rec, req)
	return rec, called
}

func TestRequireAgeVerified(t *testing.T) {
	t.Parallel()

	unverified := &Claims{UserID: ageUserUnverified, Roles: []string{"customer"}}
	verified := &Claims{UserID: ageUserVerified, Roles: []string{"customer"}}

	tests := []struct {
		name           string
		method         string
		path           string
		claims         *Claims
		setClaims      bool
		nilDB          bool
		typedNilPool   bool
		wantStatus     int
		wantBodySubstr string
		wantCode       string
		wantNext       bool
		wantDBCalls    int
	}{
		{
			name:        "get_unverified_passes_without_query",
			method:      http.MethodGet,
			path:        "/api/v1/jobs/x",
			claims:      unverified,
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:        "put_dob_passes_without_query",
			method:      http.MethodPut,
			path:        "/api/v1/me/dob",
			claims:      unverified,
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:        "post_tos_acceptance_passes_without_query",
			method:      http.MethodPost,
			path:        "/api/v1/me/tos-acceptance",
			claims:      unverified,
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:        "delete_me_passes_without_query",
			method:      http.MethodDelete,
			path:        "/api/v1/users/me",
			claims:      unverified,
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:        "post_restore_passes_without_query",
			method:      http.MethodPost,
			path:        "/api/v1/users/me/restore",
			claims:      unverified,
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:        "post_block_passes_without_query",
			method:      http.MethodPost,
			path:        "/api/v1/users/abc/block",
			claims:      unverified,
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:        "post_report_passes_without_query",
			method:      http.MethodPost,
			path:        "/api/v1/users/abc/report",
			claims:      unverified,
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:        "post_flag_passes_without_query",
			method:      http.MethodPost,
			path:        "/api/v1/reviews/abc/flag",
			claims:      unverified,
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:           "post_report_noshow_not_exempt",
			method:         http.MethodPost,
			path:           "/api/v1/contracts/abc/report-noshow",
			claims:         unverified,
			setClaims:      true,
			wantStatus:     http.StatusForbidden,
			wantBodySubstr: "at least 18",
			wantCode:       AgeNotVerifiedCode,
			wantNext:       false,
			wantDBCalls:    1,
		},
		{
			name:           "post_report_abandonment_not_exempt",
			method:         http.MethodPost,
			path:           "/api/v1/contracts/abc/report-abandonment",
			claims:         unverified,
			setClaims:      true,
			wantStatus:     http.StatusForbidden,
			wantBodySubstr: "at least 18",
			wantCode:       AgeNotVerifiedCode,
			wantNext:       false,
			wantDBCalls:    1,
		},
		{
			name:        "post_bid_verified_passes",
			method:      http.MethodPost,
			path:        "/api/v1/listings/abc/bids",
			claims:      verified,
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 1,
		},
		{
			name:           "post_bid_unverified_forbidden",
			method:         http.MethodPost,
			path:           "/api/v1/listings/abc/bids",
			claims:         unverified,
			setClaims:      true,
			wantStatus:     http.StatusForbidden,
			wantBodySubstr: "at least 18",
			wantCode:       AgeNotVerifiedCode,
			wantNext:       false,
			wantDBCalls:    1,
		},
		{
			name:        "admin_skips_unverified_row",
			method:      http.MethodPost,
			path:        "/api/v1/listings/abc/bids",
			claims:      &Claims{UserID: ageUserUnverified, Roles: []string{"admin"}},
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:           "missing_claims_401",
			method:         http.MethodPost,
			path:           "/api/v1/listings/abc/bids",
			setClaims:      false,
			wantStatus:     http.StatusUnauthorized,
			wantBodySubstr: "authentication required",
			wantNext:       false,
			wantDBCalls:    0,
		},
		{
			name:           "nil_db_503",
			method:         http.MethodPost,
			path:           "/api/v1/listings/abc/bids",
			claims:         verified,
			setClaims:      true,
			nilDB:          true,
			wantStatus:     http.StatusServiceUnavailable,
			wantBodySubstr: "Unable to confirm age verification",
			wantCode:       "age_verification_unavailable",
			wantNext:       false,
			wantDBCalls:    0,
		},
		{
			name:           "no_rows_403",
			method:         http.MethodPost,
			path:           "/api/v1/listings/abc/bids",
			claims:         &Claims{UserID: ageUserMissing, Roles: []string{"customer"}},
			setClaims:      true,
			wantStatus:     http.StatusForbidden,
			wantBodySubstr: "forbidden",
			wantNext:       false,
			wantDBCalls:    1,
		},
		{
			name:           "database_error_503",
			method:         http.MethodPost,
			path:           "/api/v1/listings/abc/bids",
			claims:         &Claims{UserID: ageUserDBErr, Roles: []string{"customer"}},
			setClaims:      true,
			wantStatus:     http.StatusServiceUnavailable,
			wantBodySubstr: "Unable to confirm age verification",
			wantCode:       "age_verification_unavailable",
			wantNext:       false,
			wantDBCalls:    1,
		},
		{
			name:           "typed_nil_pool_503",
			method:         http.MethodPost,
			path:           "/api/v1/listings/abc/bids",
			claims:         verified,
			setClaims:      true,
			typedNilPool:   true,
			wantStatus:     http.StatusServiceUnavailable,
			wantBodySubstr: "Unable to confirm age verification",
			wantCode:       "age_verification_unavailable",
			wantNext:       false,
			wantDBCalls:    0,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			db := newAgeQuerier()
			var querier OwnershipQuerier = db
			if tt.nilDB {
				querier = nil
			}
			if tt.typedNilPool {
				var pool *pgxpool.Pool
				querier = pool
			}

			rec, called := serveGate(RequireAgeVerified(querier), tt.method, tt.path, tt.claims, tt.setClaims)

			assert.Equal(t, tt.wantStatus, rec.Code)
			assert.Equal(t, tt.wantNext, called)
			assert.Equal(t, tt.wantDBCalls, db.calls)
			if tt.wantNext {
				assert.Equal(t, "ok", rec.Body.String())
			}
			if tt.wantBodySubstr != "" {
				assert.Contains(t, rec.Body.String(), tt.wantBodySubstr)
			}
			if tt.wantCode != "" {
				assert.Contains(t, rec.Body.String(), `"code":"`+tt.wantCode+`"`)
				assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
			}
			if tt.wantDBCalls > 0 {
				require.NotNil(t, tt.claims)
				assert.Equal(t, ageVerifiedQueryExpect, db.lastSQL)
				assert.NotContains(t, db.lastSQL, tt.claims.UserID)
				assert.NotContains(t, db.lastSQL, "dob_encrypted")
				assert.NotContains(t, strings.ToLower(db.lastSQL), "select dob ")
				assert.NotContains(t, strings.ToLower(db.lastSQL), "select dob,")
				assert.Equal(t, 1, strings.Count(db.lastSQL, "$1"))
				assert.NotContains(t, db.lastSQL, "$2")
			}
		})
	}
}

func TestRequireCurrentTerms(t *testing.T) {
	t.Parallel()

	accepted := &Claims{UserID: termsUserAccepted, Roles: []string{"customer"}}
	rejected := &Claims{UserID: termsUserRejected, Roles: []string{"customer"}}

	tests := []struct {
		name           string
		method         string
		path           string
		claims         *Claims
		setClaims      bool
		nilDB          bool
		typedNilPool   bool
		wantStatus     int
		wantBodySubstr string
		wantCode       string
		wantNext       bool
		wantDBCalls    int
	}{
		{
			name:        "accepted_current_version_passes",
			method:      http.MethodPost,
			path:        "/api/v1/listings/abc/bids",
			claims:      accepted,
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 1,
		},
		{
			name:           "not_accepted_forbidden",
			method:         http.MethodPost,
			path:           "/api/v1/listings/abc/bids",
			claims:         rejected,
			setClaims:      true,
			wantStatus:     http.StatusForbidden,
			wantBodySubstr: "Terms of Service",
			wantCode:       TermsNotAcceptedCode,
			wantNext:       false,
			wantDBCalls:    1,
		},
		{
			name:           "no_rows_503",
			method:         http.MethodPost,
			path:           "/api/v1/listings/abc/bids",
			claims:         &Claims{UserID: termsUserMissing, Roles: []string{"customer"}},
			setClaims:      true,
			wantStatus:     http.StatusServiceUnavailable,
			wantBodySubstr: "Unable to confirm the current terms",
			wantCode:       "tos_acceptance_unavailable",
			wantNext:       false,
			wantDBCalls:    1,
		},
		{
			name:           "empty_version_503",
			method:         http.MethodPost,
			path:           "/api/v1/listings/abc/bids",
			claims:         &Claims{UserID: termsUserEmpty, Roles: []string{"customer"}},
			setClaims:      true,
			wantStatus:     http.StatusServiceUnavailable,
			wantBodySubstr: "Unable to confirm the current terms",
			wantCode:       "tos_acceptance_unavailable",
			wantNext:       false,
			wantDBCalls:    1,
		},
		{
			name:        "admin_skips",
			method:      http.MethodPost,
			path:        "/api/v1/listings/abc/bids",
			claims:      &Claims{UserID: termsUserRejected, Roles: []string{"admin"}},
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:        "post_tos_acceptance_skips",
			method:      http.MethodPost,
			path:        "/api/v1/me/tos-acceptance",
			claims:      rejected,
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:        "get_skips",
			method:      http.MethodGet,
			path:        "/api/v1/listings/abc/bids",
			claims:      rejected,
			setClaims:   true,
			wantStatus:  http.StatusOK,
			wantNext:    true,
			wantDBCalls: 0,
		},
		{
			name:           "database_error_503",
			method:         http.MethodPost,
			path:           "/api/v1/listings/abc/bids",
			claims:         &Claims{UserID: termsUserDBErr, Roles: []string{"customer"}},
			setClaims:      true,
			wantStatus:     http.StatusServiceUnavailable,
			wantBodySubstr: "Unable to confirm the current terms",
			wantCode:       "tos_acceptance_unavailable",
			wantNext:       false,
			wantDBCalls:    1,
		},
		{
			name:           "nil_db_503",
			method:         http.MethodPost,
			path:           "/api/v1/listings/abc/bids",
			claims:         accepted,
			setClaims:      true,
			nilDB:          true,
			wantStatus:     http.StatusServiceUnavailable,
			wantBodySubstr: "Unable to confirm the current terms",
			wantCode:       "tos_acceptance_unavailable",
			wantNext:       false,
			wantDBCalls:    0,
		},
		{
			name:           "typed_nil_pool_503",
			method:         http.MethodPost,
			path:           "/api/v1/listings/abc/bids",
			claims:         accepted,
			setClaims:      true,
			typedNilPool:   true,
			wantStatus:     http.StatusServiceUnavailable,
			wantBodySubstr: "Unable to confirm the current terms",
			wantCode:       "tos_acceptance_unavailable",
			wantNext:       false,
			wantDBCalls:    0,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			db := newTermsQuerier()
			var querier OwnershipQuerier = db
			if tt.nilDB {
				querier = nil
			}
			if tt.typedNilPool {
				var pool *pgxpool.Pool
				querier = pool
			}

			rec, called := serveGate(RequireCurrentTerms(querier), tt.method, tt.path, tt.claims, tt.setClaims)

			assert.Equal(t, tt.wantStatus, rec.Code)
			assert.Equal(t, tt.wantNext, called)
			assert.Equal(t, tt.wantDBCalls, db.calls)
			if tt.wantNext {
				assert.Equal(t, "ok", rec.Body.String())
			}
			if tt.wantBodySubstr != "" {
				assert.Contains(t, rec.Body.String(), tt.wantBodySubstr)
			}
			if tt.wantCode != "" {
				assert.Contains(t, rec.Body.String(), `"code":"`+tt.wantCode+`"`)
				assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
			}
			if tt.wantDBCalls > 0 {
				require.NotNil(t, tt.claims)
				assert.Contains(t, db.lastSQL, "tos_versions")
				assert.Contains(t, db.lastSQL, "tos_acceptances")
				assert.Contains(t, db.lastSQL, "effective_at <= now()")
				assert.Contains(t, db.lastSQL, "effective_at DESC")
				assert.NotContains(t, db.lastSQL, tt.claims.UserID)
				assert.NotContains(t, db.lastSQL, "1.0")
				assert.Equal(t, 1, strings.Count(db.lastSQL, "$1"))
				assert.NotContains(t, db.lastSQL, "$2")
			}
		})
	}
}

func TestAccountGateQueriersImplementOwnershipQuerier(t *testing.T) {
	t.Parallel()
	var _ OwnershipQuerier = (*ageQuerier)(nil)
	var _ OwnershipQuerier = (*termsQuerier)(nil)
}
