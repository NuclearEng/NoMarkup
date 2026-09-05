package middleware

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
)

// --- mock database layer ---

// mockRow implements pgx.Row for testing.
type mockRow struct {
	values []interface{}
	err    error
}

func (r *mockRow) Scan(dest ...interface{}) error {
	if r.err != nil {
		return r.err
	}
	for i, d := range dest {
		if i >= len(r.values) {
			break
		}
		switch ptr := d.(type) {
		case *string:
			*ptr = r.values[i].(string)
		}
	}
	return nil
}

// mockQuerier implements OwnershipQuerier for testing.
type mockQuerier struct {
	// rows maps resourceID -> mockRow.
	rows map[string]*mockRow
}

func (q *mockQuerier) QueryRow(_ context.Context, _ string, args ...interface{}) pgx.Row {
	if len(args) == 0 {
		return &mockRow{err: pgx.ErrNoRows}
	}
	id, ok := args[0].(string)
	if !ok {
		return &mockRow{err: pgx.ErrNoRows}
	}
	row, found := q.rows[id]
	if !found {
		return &mockRow{err: pgx.ErrNoRows}
	}
	return row
}

// newMockQuerier builds a mock with a map of resource IDs to return values.
func newMockQuerier(data map[string]*mockRow) *mockQuerier {
	return &mockQuerier{rows: data}
}

// withChiURLParam creates an http.Request whose chi context contains the given URL param.
func withChiURLParam(r *http.Request, key, value string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, value)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

// --- RequireOwnership tests ---

func TestRequireOwnership(t *testing.T) {
	t.Parallel()

	resource := ResourceOwnership{
		Table:       "jobs",
		OwnerColumn: "customer_id",
		IDColumn:    "id",
		URLParam:    "id",
	}

	// Valid UUIDs — the middleware now rejects non-UUID ids with 400 before
	// touching the DB, so test fixtures must use well-formed UUIDs.
	const (
		jobOwned       = "00000000-0000-7000-8000-000000000001"
		jobOther       = "00000000-0000-7000-8000-000000000002"
		jobNonexistent = "00000000-0000-7000-8000-0000000000ff"
	)

	db := newMockQuerier(map[string]*mockRow{
		jobOwned: {values: []interface{}{"user-owner"}},
		jobOther: {values: []interface{}{"user-other"}},
	})

	tests := []struct {
		name           string
		claims         *Claims
		setClaims      bool
		urlParam       string
		wantStatus     int
		wantBodySubstr string
	}{
		{
			name:       "owner_can_access_resource",
			claims:     &Claims{UserID: "user-owner", Email: "owner@example.com", Roles: []string{"customer"}},
			setClaims:  true,
			urlParam:   jobOwned,
			wantStatus: http.StatusOK,
		},
		{
			name:           "non_owner_gets_403",
			claims:         &Claims{UserID: "user-attacker", Email: "attacker@example.com", Roles: []string{"customer"}},
			setClaims:      true,
			urlParam:       jobOwned,
			wantStatus:     http.StatusForbidden,
			wantBodySubstr: "forbidden",
		},
		{
			name:       "admin_bypasses_ownership_check",
			claims:     &Claims{UserID: "user-admin", Email: "admin@example.com", Roles: []string{"admin"}},
			setClaims:  true,
			urlParam:   jobOwned,
			wantStatus: http.StatusOK,
		},
		{
			name:       "admin_among_multiple_roles_bypasses",
			claims:     &Claims{UserID: "user-multi", Email: "multi@example.com", Roles: []string{"customer", "admin"}},
			setClaims:  true,
			urlParam:   jobOther,
			wantStatus: http.StatusOK,
		},
		{
			name:           "unauthenticated_request_gets_401",
			setClaims:      false,
			urlParam:       jobOwned,
			wantStatus:     http.StatusUnauthorized,
			wantBodySubstr: "unauthorized",
		},
		{
			name:           "empty_user_id_gets_401",
			claims:         &Claims{UserID: "", Email: "empty@example.com", Roles: []string{"customer"}},
			setClaims:      true,
			urlParam:       jobOwned,
			wantStatus:     http.StatusUnauthorized,
			wantBodySubstr: "unauthorized",
		},
		{
			name:           "nonexistent_resource_gets_404",
			claims:         &Claims{UserID: "user-owner", Email: "owner@example.com", Roles: []string{"customer"}},
			setClaims:      true,
			urlParam:       jobNonexistent,
			wantStatus:     http.StatusNotFound,
			wantBodySubstr: "not found",
		},
		{
			name:           "malformed_uuid_gets_400",
			claims:         &Claims{UserID: "user-owner", Email: "owner@example.com", Roles: []string{"customer"}},
			setClaims:      true,
			urlParam:       "not-a-uuid",
			wantStatus:     http.StatusBadRequest,
			wantBodySubstr: "invalid resource ID",
		},
		{
			name:           "missing_url_param_gets_400",
			claims:         &Claims{UserID: "user-owner", Email: "owner@example.com", Roles: []string{"customer"}},
			setClaims:      true,
			urlParam:       "",
			wantStatus:     http.StatusBadRequest,
			wantBodySubstr: "resource ID required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs/"+tt.urlParam, nil)

			// Inject Chi URL param.
			if tt.urlParam != "" {
				req = withChiURLParam(req, "id", tt.urlParam)
			}

			// Inject claims into context.
			if tt.setClaims {
				ctx := context.WithValue(req.Context(), ClaimsContextKey, tt.claims)
				req = req.WithContext(ctx)
			}

			rec := httptest.NewRecorder()

			handler := RequireOwnership(db, resource)(okHandler())
			handler.ServeHTTP(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantBodySubstr != "" {
				assert.Contains(t, rec.Body.String(), tt.wantBodySubstr)
			}
		})
	}
}

// --- RequirePartyAccess tests ---

func TestRequirePartyAccess(t *testing.T) {
	t.Parallel()

	cfg := PartyAccessConfig{
		Table:    "contracts",
		Column1:  "customer_id",
		Column2:  "provider_id",
		IDColumn: "id",
		URLParam: "id",
	}

	const (
		contractOne         = "00000000-0000-7000-8000-00000000c001"
		contractNonexistent = "00000000-0000-7000-8000-00000000c0ff"
	)

	db := newMockQuerier(map[string]*mockRow{
		contractOne: {values: []interface{}{"user-customer", "user-provider"}},
	})

	tests := []struct {
		name           string
		claims         *Claims
		setClaims      bool
		urlParam       string
		wantStatus     int
		wantBodySubstr string
	}{
		{
			name:       "customer_party_can_access",
			claims:     &Claims{UserID: "user-customer", Email: "customer@example.com", Roles: []string{"customer"}},
			setClaims:  true,
			urlParam:   contractOne,
			wantStatus: http.StatusOK,
		},
		{
			name:       "provider_party_can_access",
			claims:     &Claims{UserID: "user-provider", Email: "provider@example.com", Roles: []string{"provider"}},
			setClaims:  true,
			urlParam:   contractOne,
			wantStatus: http.StatusOK,
		},
		{
			name:           "unrelated_user_gets_403",
			claims:         &Claims{UserID: "user-stranger", Email: "stranger@example.com", Roles: []string{"customer"}},
			setClaims:      true,
			urlParam:       contractOne,
			wantStatus:     http.StatusForbidden,
			wantBodySubstr: "forbidden",
		},
		{
			name:       "admin_bypasses_party_check",
			claims:     &Claims{UserID: "user-admin", Email: "admin@example.com", Roles: []string{"admin"}},
			setClaims:  true,
			urlParam:   contractOne,
			wantStatus: http.StatusOK,
		},
		{
			name:           "unauthenticated_request_gets_401",
			setClaims:      false,
			urlParam:       contractOne,
			wantStatus:     http.StatusUnauthorized,
			wantBodySubstr: "unauthorized",
		},
		{
			name:           "nonexistent_resource_gets_404",
			claims:         &Claims{UserID: "user-customer", Email: "customer@example.com", Roles: []string{"customer"}},
			setClaims:      true,
			urlParam:       contractNonexistent,
			wantStatus:     http.StatusNotFound,
			wantBodySubstr: "not found",
		},
		{
			name:           "malformed_uuid_gets_400",
			claims:         &Claims{UserID: "user-customer", Email: "customer@example.com", Roles: []string{"customer"}},
			setClaims:      true,
			urlParam:       "not-a-uuid",
			wantStatus:     http.StatusBadRequest,
			wantBodySubstr: "invalid resource ID",
		},
		{
			name:           "missing_url_param_gets_400",
			claims:         &Claims{UserID: "user-customer", Email: "customer@example.com", Roles: []string{"customer"}},
			setClaims:      true,
			urlParam:       "",
			wantStatus:     http.StatusBadRequest,
			wantBodySubstr: "resource ID required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/api/v1/contracts/"+tt.urlParam, nil)

			if tt.urlParam != "" {
				req = withChiURLParam(req, "id", tt.urlParam)
			}

			if tt.setClaims {
				ctx := context.WithValue(req.Context(), ClaimsContextKey, tt.claims)
				req = req.WithContext(ctx)
			}

			rec := httptest.NewRecorder()

			handler := RequirePartyAccess(db, cfg)(okHandler())
			handler.ServeHTTP(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantBodySubstr != "" {
				assert.Contains(t, rec.Body.String(), tt.wantBodySubstr)
			}
		})
	}
}

// --- hasAdminRole tests ---

func TestHasAdminRole(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		roles []string
		want  bool
	}{
		{name: "admin_role_present", roles: []string{"admin"}, want: true},
		{name: "admin_among_others", roles: []string{"customer", "admin", "provider"}, want: true},
		{name: "no_admin_role", roles: []string{"customer", "provider"}, want: false},
		{name: "empty_roles", roles: []string{}, want: false},
		{name: "nil_roles", roles: nil, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := hasAdminRole(&Claims{Roles: tt.roles})
			assert.Equal(t, tt.want, got)
		})
	}
}

// --- mockQuerier satisfies OwnershipQuerier ---

func TestMockQuerier_implements_interface(t *testing.T) {
	var _ OwnershipQuerier = (*mockQuerier)(nil)
}

// --- RequireOwnership with database error ---

func TestRequireOwnership_database_error(t *testing.T) {
	t.Parallel()

	resource := ResourceOwnership{
		Table:       "jobs",
		OwnerColumn: "customer_id",
		IDColumn:    "id",
		URLParam:    "id",
	}

	const jobErr = "00000000-0000-7000-8000-0000000000e1"
	db := newMockQuerier(map[string]*mockRow{
		jobErr: {err: fmt.Errorf("connection refused")},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs/"+jobErr, nil)
	req = withChiURLParam(req, "id", jobErr)
	ctx := context.WithValue(req.Context(), ClaimsContextKey, &Claims{
		UserID: "user-1", Email: "a@b.com", Roles: []string{"customer"},
	})
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler := RequireOwnership(db, resource)(okHandler())
	handler.ServeHTTP(rec, req)

	// A genuine DB error maps to 500 (not 503) — the resource may well exist; the
	// database is just unreachable, which is an internal server error.
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Contains(t, rec.Body.String(), "internal server error")
}

func TestRequireOwnership_no_rows_returns_404(t *testing.T) {
	t.Parallel()

	resource := ResourceOwnership{
		Table:       "jobs",
		OwnerColumn: "customer_id",
		IDColumn:    "id",
		URLParam:    "id",
	}

	const jobNoRows = "00000000-0000-7000-8000-0000000000e2"
	db := newMockQuerier(map[string]*mockRow{
		jobNoRows: {err: pgx.ErrNoRows},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs/"+jobNoRows, nil)
	req = withChiURLParam(req, "id", jobNoRows)
	ctx := context.WithValue(req.Context(), ClaimsContextKey, &Claims{
		UserID: "user-1", Email: "a@b.com", Roles: []string{"customer"},
	})
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler := RequireOwnership(db, resource)(okHandler())
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Contains(t, rec.Body.String(), "not found")
}

// --- RequirePartyAccess with database error ---

func TestRequirePartyAccess_database_error(t *testing.T) {
	t.Parallel()

	cfg := PartyAccessConfig{
		Table:    "contracts",
		Column1:  "customer_id",
		Column2:  "provider_id",
		IDColumn: "id",
		URLParam: "id",
	}

	const contractErr = "00000000-0000-7000-8000-00000000c0e1"
	db := newMockQuerier(map[string]*mockRow{
		contractErr: {err: fmt.Errorf("connection refused")},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/contracts/"+contractErr, nil)
	req = withChiURLParam(req, "id", contractErr)
	ctx := context.WithValue(req.Context(), ClaimsContextKey, &Claims{
		UserID: "user-1", Email: "a@b.com", Roles: []string{"customer"},
	})
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler := RequirePartyAccess(db, cfg)(okHandler())
	handler.ServeHTTP(rec, req)

	// A genuine DB error maps to 500 (not 503).
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Contains(t, rec.Body.String(), "internal server error")
}

func TestRequirePartyAccess_no_rows_returns_404(t *testing.T) {
	t.Parallel()

	cfg := PartyAccessConfig{
		Table:    "contracts",
		Column1:  "customer_id",
		Column2:  "provider_id",
		IDColumn: "id",
		URLParam: "id",
	}

	const contractNoRows = "00000000-0000-7000-8000-00000000c0e2"
	db := newMockQuerier(map[string]*mockRow{
		contractNoRows: {err: pgx.ErrNoRows},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/contracts/"+contractNoRows, nil)
	req = withChiURLParam(req, "id", contractNoRows)
	ctx := context.WithValue(req.Context(), ClaimsContextKey, &Claims{
		UserID: "user-1", Email: "a@b.com", Roles: []string{"customer"},
	})
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler := RequirePartyAccess(db, cfg)(okHandler())
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Contains(t, rec.Body.String(), "not found")
}
