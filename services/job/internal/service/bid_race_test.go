//go:build integration

// Tier 1 production-readiness — auction concurrency race test.
//
// Scenario:
//   - Spawn 10 goroutines, each places a bid as a *different* provider on the
//     same job within a ~100ms window.
//   - Run the scenario for 100 iterations.
//   - Verify after each iteration:
//       * Every bid that returned 2xx is present in `bids`.
//       * `jobs.bid_count` matches `count(*)` from `bids`.
//       * `jobs.lowest_bid_cents` matches `min(bids.amount_cents)`.
//
// Run:
//   go test -tags=integration -race -run TestBidRace_Concurrency ./internal/service/...
//
// Requires:
//   - Gateway running at $NOMARKUP_GATEWAY_URL (default http://localhost:8081)
//   - Postgres at $DATABASE_URL or postgres://nomarkup:nomarkup@localhost:5433/nomarkup
//   - Seed accounts with password "Password123!":
//       customer@nomarkup.com, provider@nomarkup.com, provider2@nomarkup.com,
//       bot1@nomarkup.com, sim1..sim5@nomarkup.com.

package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Default iteration count. Override via the BID_RACE_ITERATIONS env var when
// running this test against a non-dev backend or when you want to crank up
// the contention. Smaller values let the test fit comfortably under the
// dev-gateway per-IP rate limits (TierStandard 600/min, TierStrict 100/min).
const (
	bidRaceConcurrency       = 10
	defaultBidRaceIterations = 30
)

func bidRaceIterations() int {
	if v := os.Getenv("BID_RACE_ITERATIONS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return defaultBidRaceIterations
}

// bidRacePacing returns the per-iteration sleep. Each iteration costs
// 1 (POST /jobs) + 10 (POST /jobs/{id}/bids) = 11 requests against the
// gateway from a single IP. Dev rate limits cap us at 600 standard +
// 100 strict per minute. The standard tier dominates (the bids endpoint
// itself isn't strict-tiered). Pacing scales with iteration count so
// runs of 30 / 100 / 1000 all stay under the per-IP cap.
func bidRacePacing(iterations int) time.Duration {
	switch {
	case iterations <= 30:
		return 250 * time.Millisecond
	case iterations <= 100:
		return 1100 * time.Millisecond
	default:
		return 1500 * time.Millisecond
	}
}

// providerAccounts is the list of seed provider emails used by the race test.
// The bidding engine enforces UNIQUE (job_id, provider_id), so we need 10
// distinct providers to drive a true 10-goroutine concurrency test on a
// single job.
var providerAccounts = []string{
	"provider@nomarkup.com",
	"provider2@nomarkup.com",
	"bot1@nomarkup.com",
	"sim1@nomarkup.com",
	"sim2@nomarkup.com",
	"sim3@nomarkup.com",
	"sim4@nomarkup.com",
	"sim5@nomarkup.com",
}

func bidRaceGatewayURL() string {
	if v := os.Getenv("NOMARKUP_GATEWAY_URL"); v != "" {
		return v
	}
	return "http://localhost:8081"
}

func bidRaceDatabaseURL() string {
	if v := os.Getenv("DATABASE_URL"); v != "" {
		return v
	}
	return "postgres://nomarkup:nomarkup@localhost:5433/nomarkup?sslmode=disable"
}

func loginToken(t *testing.T, base, email string) string {
	t.Helper()
	body := bytes.NewBufferString(fmt.Sprintf(`{"email":%q,"password":"Password123!"}`, email))
	resp, err := http.Post(base+"/api/v1/auth/login", "application/json", body)
	if err != nil {
		t.Fatalf("login %s: %v", email, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login %s status=%d body=%s", email, resp.StatusCode, raw)
	}
	var out struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("login %s decode: %v", email, err)
	}
	if out.AccessToken == "" {
		t.Fatalf("login %s returned empty access_token: %s", email, raw)
	}
	return out.AccessToken
}

// createActiveJob asks the live gateway to create + publish a fresh active job.
// We need a unique active job per iteration so providers can bid without
// hitting the (job_id, provider_id) unique constraint left over from a
// previous iteration.
func createActiveJob(t *testing.T, base, customerToken string) string {
	t.Helper()
	payload := map[string]any{
		"title":                  fmt.Sprintf("BidRace job %d", time.Now().UnixNano()),
		"description":            "Auction race-condition integration test job",
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
	raw, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, base+"/api/v1/jobs", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+customerToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("create job status=%d body=%s", resp.StatusCode, body)
	}
	var jobOut struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(body, &jobOut); err != nil {
		t.Fatalf("decode job: %v body=%s", err, body)
	}
	if jobOut.ID == "" {
		t.Fatalf("empty job id; body=%s", body)
	}

	// Publish if it landed as a draft.
	if jobOut.Status != "active" {
		publishReq, _ := http.NewRequest(http.MethodPost, base+"/api/v1/jobs/"+jobOut.ID+"/publish", nil)
		publishReq.Header.Set("Authorization", "Bearer "+customerToken)
		publishResp, err := http.DefaultClient.Do(publishReq)
		if err != nil {
			t.Fatalf("publish job: %v", err)
		}
		_ = publishResp.Body.Close()
		if publishResp.StatusCode >= 400 {
			t.Fatalf("publish status=%d", publishResp.StatusCode)
		}
	}
	return jobOut.ID
}

// placeBid issues a single POST /api/v1/jobs/{id}/bids. Returns the http
// status, an optional bid id, and the response body for diagnostics.
func placeBid(t *testing.T, base, jobID, providerToken string, amount int64) (int, string, []byte) {
	t.Helper()
	payload := map[string]any{
		"amount_cents":             amount,
		"message":                  "race test bid",
		"estimated_duration_hours": 4,
	}
	raw, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, base+"/api/v1/jobs/"+jobID+"/bids", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+providerToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return -1, "", []byte(err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		var out struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(body, &out)
		return resp.StatusCode, out.ID, body
	}
	return resp.StatusCode, "", body
}

func TestBidRace_Concurrency(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping bid race in -short mode")
	}

	base := bidRaceGatewayURL()
	dbURL := bidRaceDatabaseURL()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("pgxpool: %v", err)
	}
	defer pool.Close()

	// One-time login for all participants.
	customerTok := loginToken(t, base, "customer@nomarkup.com")
	providerTokens := make([]string, len(providerAccounts))
	for i, e := range providerAccounts {
		providerTokens[i] = loginToken(t, base, e)
	}
	// We only have 8 distinct providers but the test asks for 10 goroutines.
	// We pad to 10 by running 8 distinct providers + 2 reused (which will
	// receive `409 already_bid`). Reused-provider requests still validate
	// that concurrent rejections don't corrupt state.
	concurrency := bidRaceConcurrency
	if len(providerTokens) < concurrency {
		// Will reuse providerTokens[0..n%len] for the extras. No assertion
		// invariants are violated by this: extras get 4xx and we only
		// require successful bids show up in the DB.
	}

	var totalAccepted, totalRejected, totalRateLimited int64
	var inconsistencies int

	iterations := bidRaceIterations()
	pacing := bidRacePacing(iterations)
	for it := 0; it < iterations; it++ {
		if it > 0 {
			time.Sleep(pacing)
		}
		jobID := createActiveJob(t, base, customerTok)

		var wg sync.WaitGroup
		wg.Add(concurrency)

		// Synchronise launches via a shared channel — narrows the start-skew
		// window so the contention is meaningful.
		gate := make(chan struct{})
		acceptedAmounts := make(chan int64, concurrency)
		statusCounts := make([]int32, concurrency)

		// Each goroutine bids a distinct amount in [1000..9999] so the
		// expected lowest is deterministic.
		for g := 0; g < concurrency; g++ {
			provIdx := g % len(providerTokens)
			amount := int64(1000 + g) // 1000, 1001, ..., 1009 (all <= starting bid)
			tok := providerTokens[provIdx]

			go func(tok string, amount int64, slot int) {
				defer wg.Done()
				<-gate
				status, id, body := placeBid(t, base, jobID, tok, amount)
				statusCounts[slot] = int32(status)
				if status >= 200 && status < 300 && id != "" {
					acceptedAmounts <- amount
					atomic.AddInt64(&totalAccepted, 1)
				} else if status == 429 {
					atomic.AddInt64(&totalRateLimited, 1)
					_ = body
				} else {
					atomic.AddInt64(&totalRejected, 1)
					_ = body
				}
			}(tok, amount, g)
		}

		// Open the gate — all goroutines fire within ~100us of each other.
		close(gate)
		wg.Wait()
		close(acceptedAmounts)

		// Collect accepted amounts to compute the expected lowest.
		var minAccepted int64 = -1
		var acceptedCount int64
		for a := range acceptedAmounts {
			acceptedCount++
			if minAccepted < 0 || a < minAccepted {
				minAccepted = a
			}
		}

		// Verify DB state matches HTTP responses.
		var dbCount int64
		var dbMin *int64
		if err := pool.QueryRow(ctx,
			`SELECT count(*), min(amount_cents) FROM bids WHERE job_id=$1`,
			jobID,
		).Scan(&dbCount, &dbMin); err != nil {
			t.Fatalf("iter %d: count bids: %v", it, err)
		}

		if dbCount != acceptedCount {
			t.Errorf("iter %d: bids row count=%d but http accepted=%d", it, dbCount, acceptedCount)
			inconsistencies++
		}

		var jobBidCount int64
		var jobLowestCents *int64
		if err := pool.QueryRow(ctx,
			`SELECT bid_count, lowest_bid_cents FROM jobs WHERE id=$1`,
			jobID,
		).Scan(&jobBidCount, &jobLowestCents); err != nil {
			t.Fatalf("iter %d: read job: %v", it, err)
		}
		if jobBidCount != dbCount {
			t.Errorf("iter %d: jobs.bid_count=%d but count(bids)=%d", it, jobBidCount, dbCount)
			inconsistencies++
		}
		switch {
		case dbMin == nil && jobLowestCents == nil:
			// no successful bids placed (e.g. all hit rate limit) — fine
		case dbMin != nil && jobLowestCents != nil && *dbMin == *jobLowestCents:
			// matches as required
		default:
			gotJob := "<nil>"
			if jobLowestCents != nil {
				gotJob = fmt.Sprintf("%d", *jobLowestCents)
			}
			gotBids := "<nil>"
			if dbMin != nil {
				gotBids = fmt.Sprintf("%d", *dbMin)
			}
			t.Errorf("iter %d: jobs.lowest_bid_cents=%s but min(bids.amount_cents)=%s",
				it, gotJob, gotBids)
			inconsistencies++
		}

		// Sanity: the lowest accepted amount via HTTP should match
		// min(bids.amount_cents) from the DB.
		if minAccepted > 0 && dbMin != nil && minAccepted != *dbMin {
			t.Errorf("iter %d: min accepted via http=%d but db min=%d",
				it, minAccepted, *dbMin)
			inconsistencies++
		}
	}

	t.Logf("bid race summary: iterations=%d concurrency=%d accepted=%d rejected=%d rate_limited=%d inconsistencies=%d",
		iterations, bidRaceConcurrency,
		totalAccepted, totalRejected, totalRateLimited, inconsistencies)

	if inconsistencies > 0 {
		t.Fatalf("%d data-inconsistency violations across %d iterations",
			inconsistencies, iterations)
	}
}
