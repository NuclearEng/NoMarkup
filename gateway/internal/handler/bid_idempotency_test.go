package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// mockBidClient implements bidv1.BidServiceClient for PlaceBid unit tests.
type mockBidClient struct {
	bidv1.BidServiceClient
	placeCalls atomic.Int32
	placeFn    func(ctx context.Context, req *bidv1.PlaceBidRequest) (*bidv1.PlaceBidResponse, error)
}

func (m *mockBidClient) PlaceBid(ctx context.Context, req *bidv1.PlaceBidRequest, _ ...grpc.CallOption) (*bidv1.PlaceBidResponse, error) {
	m.placeCalls.Add(1)
	if m.placeFn != nil {
		return m.placeFn(ctx, req)
	}
	return nil, status.Error(codes.Internal, "placeFn not set")
}

func placeBidRequestWithKey(t *testing.T, jobID, key string, amountCents int64) *http.Request {
	t.Helper()
	body := bytes.NewReader([]byte(fmt.Sprintf(`{"amount_cents":%d}`, amountCents)))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jobs/"+jobID+"/bids", body)
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "p@example.com", []string{"provider"})
	return req
}

// TestPlaceBid_SuccessDoesNotDoubleCall pins that a single PlaceBid reaches
// the engine once. Sticky Idempotency-Key is stamped only when db is wired
// (migration 110); nil-db path still places exactly once.
func TestPlaceBid_SuccessDoesNotDoubleCall(t *testing.T) {
	t.Parallel()
	jobID := "11111111-1111-1111-1111-111111111111"
	mock := &mockBidClient{
		placeFn: func(_ context.Context, req *bidv1.PlaceBidRequest) (*bidv1.PlaceBidResponse, error) {
			return &bidv1.PlaceBidResponse{
				Bid: &bidv1.Bid{
					Id:          "bid-1",
					JobId:       req.GetJobId(),
					ProviderId:  req.GetProviderId(),
					AmountCents: req.GetAmountCents(),
					Status:      bidv1.BidStatus_BID_STATUS_ACTIVE,
				},
			}, nil
		},
	}
	h := NewBidHandler(mock, nil, nil)

	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)

	req := placeBidRequestWithKey(t, jobID, "sticky-key-abc", 5000)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("got %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if mock.placeCalls.Load() != 1 {
		t.Fatalf("PlaceBid calls = %d, want 1", mock.placeCalls.Load())
	}
	var body map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["id"] != "bid-1" {
		t.Fatalf("bid id = %v, want bid-1", body["id"])
	}
}

// TestPlaceBid_AlreadyExistsWithoutDBSurfacesConflict documents that amount
// soft-replay needs a db pool; without it AlreadyExists falls through to 409
// (engine UNIQUE still prevented a second row).
func TestPlaceBid_AlreadyExistsWithoutDBSurfacesConflict(t *testing.T) {
	t.Parallel()
	jobID := "11111111-1111-1111-1111-111111111111"
	mock := &mockBidClient{
		placeFn: func(context.Context, *bidv1.PlaceBidRequest) (*bidv1.PlaceBidResponse, error) {
			return nil, status.Error(codes.AlreadyExists, "provider already bid")
		},
	}
	h := NewBidHandler(mock, nil, nil)

	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)

	req := placeBidRequestWithKey(t, jobID, "sticky-key-xyz", 5000)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("got %d, want 409 without db soft-replay (body=%s)", rec.Code, rec.Body.String())
	}
	if mock.placeCalls.Load() != 1 {
		t.Fatalf("PlaceBid calls = %d, want 1", mock.placeCalls.Load())
	}
}

// TestLoadBidByIdempotencyKey_NilSafe pins empty-key / nil-db short-circuits
// (no panic, no false positive replay).
func TestLoadBidByIdempotencyKey_NilSafe(t *testing.T) {
	t.Parallel()
	h := NewBidHandler(nil, nil, nil)
	if _, ok := h.loadBidByIdempotencyKey(context.Background(), "job", "prov", "key"); ok {
		t.Fatal("nil db must miss")
	}
	// Non-nil would need a pool; empty key must miss even if a pool were present.
	if _, ok := h.loadBidByIdempotencyKey(context.Background(), "job", "prov", ""); ok {
		t.Fatal("empty key must miss")
	}
}

// TestStampBidIdempotencyKey_NilSafe proves stamp is fail-soft with no pool.
func TestStampBidIdempotencyKey_NilSafe(t *testing.T) {
	t.Parallel()
	h := NewBidHandler(nil, nil, nil)
	// Must not panic.
	h.stampBidIdempotencyKey(context.Background(), "bid-1", "prov", "key-1")
	h.stampBidIdempotencyKey(context.Background(), "", "prov", "key-1")
	h.stampBidIdempotencyKey(context.Background(), "bid-1", "prov", "")
}

// TestBidBondConfirmOutcome documents the durable confirm soft-replay matrix
// (authorized → replay; pending → continue; terminal → not found).
func TestBidBondConfirmOutcome(t *testing.T) {
	t.Parallel()
	cases := []struct {
		status string
		want   string
	}{
		{"authorized", "replay"},
		{"pending", "confirm"},
		{"captured", "not_found"},
		{"released", "not_found"},
		{"cancelled", "not_found"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.status, func(t *testing.T) {
			t.Parallel()
			got := bidBondConfirmSoftReplayOutcome(tc.status)
			if got != tc.want {
				t.Fatalf("status %q → %q, want %q", tc.status, got, tc.want)
			}
		})
	}
}
