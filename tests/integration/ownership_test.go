//go:build integration

// Tier 1 production-readiness — ownership / IDOR / row-level access test.
//
// Customer A creates a job, places no contract (we directly inspect the DB
// for an existing contract owned by customer A, or fall back to an existing
// seed contract). Customer B (different user) attempts to read each
// resource and is expected to get 403/404.
//
// We test the routes that are gated by RequirePartyAccess in the gateway
// router (see gateway/internal/router/router.go).
//
// Run:
//   cd tests/integration && go test -tags=integration -run TestOwnership

package integration

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// registerCustomerB creates (or re-uses) a second customer account so we have
// two distinct customers for cross-account tests.
func registerCustomerB(t *testing.T) (token, userID string) {
	t.Helper()
	email := fmt.Sprintf("ownership-b-%d@example.com", time.Now().UnixNano())
	body := fmt.Sprintf(`{"email":%q,"password":"OwnershipB-Pass123!","display_name":"Ownership B","roles":["customer"]}`, email)
	req, _ := http.NewRequest(http.MethodPost, gatewayURL()+"/api/v1/auth/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("register customer b: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		t.Fatalf("register customer b status=%d", resp.StatusCode)
	}
	// Now log in to get a clean token.
	body2 := fmt.Sprintf(`{"email":%q,"password":"OwnershipB-Pass123!"}`, email)
	r2, err := http.Post(gatewayURL()+"/api/v1/auth/login", "application/json", strings.NewReader(body2))
	if err != nil {
		t.Fatalf("login customer b: %v", err)
	}
	defer r2.Body.Close()
	var out struct {
		AccessToken string `json:"access_token"`
		UserID      string `json:"user_id"`
	}
	if err := decodeJSON(r2, &out); err != nil {
		t.Fatalf("decode login b: %v", err)
	}
	return out.AccessToken, out.UserID
}

// findContractForCustomer returns a contract id from the DB for the given
// customer, or empty string if none exists. Used to find a real contract id
// for cross-account read attempts. We avoid creating one in this test
// because that requires the full bid-acceptance flow.
func findContractForCustomer(ctx context.Context, pool *pgxpool.Pool, customerID string) (string, error) {
	var id string
	err := pool.QueryRow(ctx,
		`SELECT id FROM contracts WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1`,
		customerID,
	).Scan(&id)
	return id, err
}

// findJobForCustomer returns the most recent active/awarded job for the
// given customer, used for cross-account reads of jobs/{id}/bids etc.
func findJobForCustomer(ctx context.Context, pool *pgxpool.Pool, customerID string) (string, error) {
	var id string
	err := pool.QueryRow(ctx,
		`SELECT id FROM jobs WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1`,
		customerID,
	).Scan(&id)
	return id, err
}

func TestOwnership_CrossAccountReadIsRejected(t *testing.T) {
	customerATok, customerAID := loginUserID(t, "customer@nomarkup.com")
	_ = customerATok
	customerBTok, customerBID := registerCustomerB(t)
	if customerAID == customerBID {
		t.Fatalf("expected distinct customer A/B IDs")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL())
	if err != nil {
		t.Fatalf("pgxpool: %v", err)
	}
	defer pool.Close()

	// 1. Cross-account read of /api/v1/contracts/{id} (RequirePartyAccess).
	//
	// Find a contract owned by customer A; if none exists, skip this branch
	// rather than synthesise one (creating a contract requires the full
	// award flow which is out of scope for this test).
	contractID, _ := findContractForCustomer(ctx, pool, customerAID)
	if contractID != "" {
		t.Run("contracts/{id}", func(t *testing.T) {
			req := authedRequest(t, http.MethodGet,
				"/api/v1/contracts/"+contractID, customerBTok, nil)
			status, body := doRead(t, req)
			if !forbiddenLike(status) {
				t.Fatalf("customer B reading contract %s expected 403/404, got %d body=%s",
					contractID, status, body)
			}
		})
	} else {
		t.Logf("no contract exists for customer A, skipping contract IDOR sub-case")
	}

	// 2. Cross-account read of /api/v1/jobs/{id}/bids (auth-required).
	//
	// jobs/{id}/bids is only visible to the job owner or admin. Customer B
	// reading customer A's job's bids should be rejected.
	jobID, _ := findJobForCustomer(ctx, pool, customerAID)
	if jobID != "" {
		t.Run("jobs/{id}/bids", func(t *testing.T) {
			req := authedRequest(t, http.MethodGet,
				"/api/v1/jobs/"+jobID+"/bids", customerBTok, nil)
			status, body := doRead(t, req)
			// /jobs/{id}/bids is gated by handler-level ownership check
			// (the handler returns 403 if you're not the job owner). 404
			// is also acceptable if the gateway hides existence.
			if !forbiddenLike(status) {
				t.Fatalf("customer B reading job %s bids expected 403/404, got %d body=%s",
					jobID, status, body)
			}
		})
	} else {
		t.Logf("no job exists for customer A, skipping job-bids IDOR sub-case")
	}

	// 3. Cross-account mutation: customer B tries to publish a job they
	//    don't own. Should be rejected with 403 or 404.
	if jobID != "" {
		t.Run("jobs/{id}/publish", func(t *testing.T) {
			req := authedRequest(t, http.MethodPost,
				"/api/v1/jobs/"+jobID+"/publish", customerBTok, nil)
			status, body := doRead(t, req)
			if !forbiddenLike(status) {
				t.Fatalf("customer B publishing job %s expected 403/404, got %d body=%s",
					jobID, status, body)
			}
		})
	}

	// 4. Cross-account mutation: customer B tries to cancel customer A's job.
	if jobID != "" {
		t.Run("jobs/{id}/cancel", func(t *testing.T) {
			req := authedRequest(t, http.MethodPost,
				"/api/v1/jobs/"+jobID+"/cancel", customerBTok,
				map[string]any{"reason": "ownership-test"})
			status, body := doRead(t, req)
			if !forbiddenLike(status) {
				t.Fatalf("customer B cancelling job %s expected 403/404, got %d body=%s",
					jobID, status, body)
			}
		})
	}
}

// forbiddenLike treats 403 and 404 as acceptable for cross-account access:
// services may either explicitly forbid (403) or hide existence (404).
// 401 is acceptable too — it means auth was rejected before route hit.
// Anything else is a genuine ownership-bypass bug.
func forbiddenLike(status int) bool {
	switch status {
	case http.StatusUnauthorized,
		http.StatusForbidden,
		http.StatusNotFound:
		return true
	}
	return false
}
