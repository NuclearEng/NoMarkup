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
	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
)

// fakeStringRow scans a single string (job customer lookup).
type fakeStringRow struct {
	s   string
	err error
}

func (r fakeStringRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != 1 {
		return errors.New("expected one dest")
	}
	p, ok := dest[0].(*string)
	if !ok {
		return errors.New("dest[0] must be *string")
	}
	*p = r.s
	return nil
}

// openBidBlockDB answers PlaceBid's customer lookup and areUsersBlocked.
type openBidBlockDB struct {
	customerID  string
	blocked     bool
	customerErr error
	blockErr    error
}

func (f *openBidBlockDB) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	if strings.Contains(sql, "user_blocks") {
		return fakeBlockRow{blocked: f.blocked, err: f.blockErr}
	}
	return fakeStringRow{s: f.customerID, err: f.customerErr}
}

func allowUnblockedBid(h *BidHandler) {
	h.blockDB = &openBidBlockDB{customerID: "22222222-2222-2222-2222-222222222222"}
}

func TestPlaceBid_BlockCheck(t *testing.T) {
	t.Parallel()
	jobID := "11111111-1111-1111-1111-111111111111"
	customerID := "22222222-2222-2222-2222-222222222222"

	cases := []struct {
		name      string
		db        *openBidBlockDB
		nilDB     bool
		wantCode  int
		wantPlace int32
	}{
		{
			name:      "nil db fails closed before engine",
			nilDB:     true,
			wantCode:  http.StatusServiceUnavailable,
			wantPlace: 0,
		},
		{
			name:      "blocked",
			db:        &openBidBlockDB{customerID: customerID, blocked: true},
			wantCode:  http.StatusForbidden,
			wantPlace: 0,
		},
		{
			name:      "block query error",
			db:        &openBidBlockDB{customerID: customerID, blockErr: errors.New("db down")},
			wantCode:  http.StatusServiceUnavailable,
			wantPlace: 0,
		},
		{
			name:      "customer lookup error",
			db:        &openBidBlockDB{customerErr: errors.New("db down")},
			wantCode:  http.StatusServiceUnavailable,
			wantPlace: 0,
		},
		{
			name:      "job missing",
			db:        &openBidBlockDB{customerErr: pgx.ErrNoRows},
			wantCode:  http.StatusNotFound,
			wantPlace: 0,
		},
		{
			name:      "not blocked reaches engine",
			db:        &openBidBlockDB{customerID: customerID},
			wantCode:  http.StatusCreated,
			wantPlace: 1,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			mock := &mockBidClient{
				placeFn: func(_ context.Context, req *bidv1.PlaceBidRequest) (*bidv1.PlaceBidResponse, error) {
					return &bidv1.PlaceBidResponse{
						Bid: &bidv1.Bid{Id: "bid-1", JobId: req.GetJobId(), AmountCents: req.GetAmountCents()},
					}, nil
				},
			}
			h := NewBidHandler(mock, nil, nil)
			if !tc.nilDB {
				h.blockDB = tc.db
			}

			r := chi.NewRouter()
			r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, placeBidRequestWithKey(t, jobID, "block-key", 5000))

			if rec.Code != tc.wantCode {
				t.Fatalf("got %d want %d (body=%s)", rec.Code, tc.wantCode, rec.Body.String())
			}
			if mock.placeCalls.Load() != tc.wantPlace {
				t.Fatalf("PlaceBid calls = %d want %d", mock.placeCalls.Load(), tc.wantPlace)
			}
		})
	}
}
