//go:build integration

// Tier 1 production-readiness — double-spend / double-award test.
//
// Scenario:
//   1. Customer creates an active job.
//   2. Two distinct providers each place a bid (bidA, bidB).
//   3. Customer fires two parallel POST /api/v1/jobs/{id}/bids/{bidID}/award
//      calls — one for bidA, one for bidB — within microseconds of each
//      other.
//
// Expected:
//   - Exactly one award succeeds (2xx).
//   - The other returns 4xx (most likely 409 Conflict, 400 BadRequest, or
//     422 Unprocessable Entity — anything in the 4xx range is acceptable
//     so long as it is not 5xx).
//   - At most one contract is created in `contracts` for that job.
//
// Run:
//   cd tests/integration && go test -tags=integration -run TestDoubleSpend

package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func createJobAsCustomer(t *testing.T, customerTok string) string {
	t.Helper()
	body := map[string]any{
		"title":                  fmt.Sprintf("DoubleSpend job %d", time.Now().UnixNano()),
		"description":            "Double-spend race-condition integration test job",
		"category_id":            "db487d00-fca2-4a17-9f4a-a926b8a306da", // plumbing seed
		"property_id":            "00000000-0000-0000-0000-000000000010",
		"schedule_type":          "flexible",
		"auction_type":           "sealed",
		"auction_duration_hours": 72,
		"starting_bid_cents":     50000,
		"publish":                true,
		"location_address":       "94102",
		"location_lat":           37.7749,
		"location_lng":           -122.4194,
	}
	req := authedRequest(t, http.MethodPost, "/api/v1/jobs", customerTok, body)
	status, raw := doRead(t, req)
	if status >= 400 {
		t.Fatalf("create job status=%d body=%s", status, raw)
	}
	var out struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode job: %v body=%s", err, raw)
	}
	if out.ID == "" {
		t.Fatalf("empty job id; body=%s", raw)
	}
	if out.Status != "active" {
		// publish to reach 'active'.
		req2 := authedRequest(t, http.MethodPost, "/api/v1/jobs/"+out.ID+"/publish", customerTok, nil)
		st, b := doRead(t, req2)
		if st >= 400 {
			t.Fatalf("publish status=%d body=%s", st, b)
		}
	}
	return out.ID
}

func placeBidAs(t *testing.T, providerTok, jobID string, amount int64) string {
	t.Helper()
	body := map[string]any{
		"amount_cents":             amount,
		"message":                  "double-spend test bid",
		"estimated_duration_hours": 4,
	}
	req := authedRequest(t, http.MethodPost, "/api/v1/jobs/"+jobID+"/bids", providerTok, body)
	status, raw := doRead(t, req)
	if status >= 400 {
		t.Fatalf("place bid status=%d body=%s", status, raw)
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode bid: %v body=%s", err, raw)
	}
	if out.ID == "" {
		t.Fatalf("empty bid id; body=%s", raw)
	}
	return out.ID
}

func TestDoubleSpend_ParallelAwardsCreateOneContract(t *testing.T) {
	customerTok := loginAccessToken(t, "customer@nomarkup.com")
	providerATok := loginAccessToken(t, "provider@nomarkup.com")
	providerBTok := loginAccessToken(t, "provider2@nomarkup.com")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL())
	if err != nil {
		t.Fatalf("pgxpool: %v", err)
	}
	defer pool.Close()

	// Run a few iterations because the race window is small. Even if 0
	// iterations actually overlap on the lock, we still verify no
	// duplicate contract was created.
	const iterations = 5

	var loserNonConflict int

	for it := 0; it < iterations; it++ {
		jobID := createJobAsCustomer(t, customerTok)
		bidA := placeBidAs(t, providerATok, jobID, 8000)
		bidB := placeBidAs(t, providerBTok, jobID, 9000)

		// Fire two awards in parallel.
		var wg sync.WaitGroup
		results := make([]int, 2)
		bodies := make([][]byte, 2)
		gate := make(chan struct{})

		bids := []string{bidA, bidB}
		for i, bidID := range bids {
			i, bidID := i, bidID
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-gate
				req := authedRequest(t, http.MethodPost,
					fmt.Sprintf("/api/v1/jobs/%s/bids/%s/award", jobID, bidID),
					customerTok, nil)
				status, body := doRead(t, req)
				results[i] = status
				bodies[i] = body
			}()
		}
		close(gate)
		wg.Wait()

		successes, failures := 0, 0
		for i, st := range results {
			if st >= 200 && st < 300 {
				successes++
			} else if st >= 400 && st < 500 {
				failures++
				// Non-409 4xx is still acceptable but flag for the report.
				if st != http.StatusConflict {
					loserNonConflict++
				}
			} else {
				t.Errorf("iter %d award #%d unexpected status %d body=%s",
					it, i, st, bodies[i])
			}
		}

		if successes != 1 {
			t.Errorf("iter %d: expected exactly 1 award success, got successes=%d failures=%d statuses=%v bodies=[%s | %s]",
				it, successes, failures, results,
				strings.TrimSpace(string(bodies[0])),
				strings.TrimSpace(string(bodies[1])))
		}

		// Verify at most one contract row for this job.
		var contractCount int
		if err := pool.QueryRow(ctx,
			`SELECT count(*) FROM contracts WHERE job_id=$1`,
			jobID,
		).Scan(&contractCount); err != nil {
			t.Fatalf("iter %d: count contracts: %v", it, err)
		}
		if contractCount > 1 {
			t.Errorf("iter %d: %d contracts created for job %s — double-spend!",
				it, contractCount, jobID)
		}
	}

	if loserNonConflict > 0 {
		t.Logf("note: %d losing-award responses used a non-409 4xx status; "+
			"consider standardising on 409 Conflict for parallel award-loss",
			loserNonConflict)
	}
}
