package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	followSellerID   = "22222222-2222-2222-2222-222222222222"
	followFollowerID = "11111111-1111-1111-1111-111111111111"
)

// fakeFollowDB serves the seller-exists query, areUsersBlocked, and the insert.
type fakeFollowDB struct {
	exists    bool
	existsErr error
	blocked   bool
	blockErr  error
	execs     int
	sqls      []string
}

func (f *fakeFollowDB) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	f.sqls = append(f.sqls, sql)
	if strings.Contains(sql, "user_blocks") {
		return fakeBlockRow{blocked: f.blocked, err: f.blockErr}
	}
	return fakeBlockRow{blocked: f.exists, err: f.existsErr}
}

func (f *fakeFollowDB) Exec(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	f.execs++
	f.sqls = append(f.sqls, sql)
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func TestFollow_BlockCheck(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		seller   string
		user     string
		db       *fakeFollowDB
		nilStore bool
		want     int
		wantExec int
	}{
		{name: "nil db", seller: followSellerID, user: followFollowerID, nilStore: true, want: http.StatusServiceUnavailable},
		{name: "self", seller: followFollowerID, user: followFollowerID, db: &fakeFollowDB{exists: true}, want: http.StatusBadRequest},
		{name: "seller missing", seller: followSellerID, user: followFollowerID, db: &fakeFollowDB{exists: false}, want: http.StatusNotFound},
		{name: "blocked", seller: followSellerID, user: followFollowerID, db: &fakeFollowDB{exists: true, blocked: true}, want: http.StatusForbidden},
		{name: "block error", seller: followSellerID, user: followFollowerID, db: &fakeFollowDB{exists: true, blockErr: errors.New("db down")}, want: http.StatusServiceUnavailable},
		{name: "not blocked inserts", seller: followSellerID, user: followFollowerID, db: &fakeFollowDB{exists: true}, want: http.StatusOK, wantExec: 1},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			h := NewFollowsHandler(nil)
			if !tc.nilStore {
				h.followDB = tc.db
			}
			r := chi.NewRouter()
			r.Post("/api/v1/users/{id}/follow", h.Follow)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/users/"+tc.seller+"/follow", nil)
			req = addClaimsToRequest(req, tc.user, "f@example.com", []string{"customer"})
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("got %d want %d (body=%s)", rec.Code, tc.want, rec.Body.String())
			}
			if tc.db != nil && tc.db.execs != tc.wantExec {
				t.Fatalf("inserts = %d want %d", tc.db.execs, tc.wantExec)
			}
		})
	}
}
