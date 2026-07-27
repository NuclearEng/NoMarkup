package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// awardTestRepo stubs CreateContract / GetContract / UpdateJobStatus for the
// CreateContractFromAward + pending-local-terms path.
type awardTestRepo struct {
	domain.ContractRepository

	created        *domain.Contract
	createCalls    int
	getCalls       int
	statusUpdates  []string
	createErr      error
	getAfterUpdate *domain.Contract // returned on GetContract after apply re-fetch
}

func (r *awardTestRepo) CreateContract(_ context.Context, c *domain.Contract, _ []domain.MilestoneInput) (*domain.Contract, error) {
	r.createCalls++
	if r.createErr != nil {
		return nil, r.createErr
	}
	out := *c
	if out.ID == "" {
		out.ID = "contract-new"
	}
	if out.ContractNumber == "" {
		out.ContractNumber = "NM-2026-00001"
	}
	r.created = &out
	cp := out
	return &cp, nil
}

func (r *awardTestRepo) GetContract(_ context.Context, id string) (*domain.Contract, error) {
	r.getCalls++
	if r.getAfterUpdate != nil && r.getAfterUpdate.ID == id {
		cp := *r.getAfterUpdate
		return &cp, nil
	}
	if r.created != nil && r.created.ID == id {
		cp := *r.created
		return &cp, nil
	}
	return nil, domain.ErrContractNotFound
}

func (r *awardTestRepo) UpdateJobStatus(_ context.Context, _ string, status string) error {
	r.statusUpdates = append(r.statusUpdates, status)
	return nil
}

// mockPendingLocalTerms captures ApplyPendingLocalTerms for award tests.
type mockPendingLocalTerms struct {
	boundContractID string
	err             error
	calls           int
	lastJobID       string
	lastCustomerID  string
	lastProviderID  string
}

func (m *mockPendingLocalTerms) ApplyPendingLocalTerms(
	_ context.Context,
	jobID, customerID, providerID string,
) (string, error) {
	m.calls++
	m.lastJobID = jobID
	m.lastCustomerID = customerID
	m.lastProviderID = providerID
	if m.err != nil {
		return "", m.err
	}
	return m.boundContractID, nil
}

func TestCreateContractFromAward_AppliesPendingLocalTerms(t *testing.T) {
	t.Parallel()

	repo := &awardTestRepo{
		getAfterUpdate: &domain.Contract{
			ID:            "contract-new",
			JobID:         "job-1",
			CustomerID:    "cust-1",
			ProviderID:    "prov-1",
			BidID:         "bid-1",
			AmountCents:   50_000,
			PaymentTiming: "milestone",
			TermsJSON:     []byte(`{"local_terms":{"payment_timing":"milestone","source":"chat_proposed_terms","bound_at":"award"}}`),
			Status:        "pending_acceptance",
		},
	}
	applier := &mockPendingLocalTerms{boundContractID: "contract-new"}
	svc := NewContractService(repo, nil)
	svc.SetPendingLocalTermsApplier(applier)

	got, err := svc.CreateContractFromAward(
		context.Background(),
		"job-1", "bid-1", "cust-1", "prov-1",
		50_000, "completion", nil,
	)
	require.NoError(t, err)
	require.NotNil(t, got)

	assert.Equal(t, 1, repo.createCalls)
	assert.Equal(t, 1, applier.calls)
	assert.Equal(t, "job-1", applier.lastJobID)
	assert.Equal(t, "cust-1", applier.lastCustomerID)
	assert.Equal(t, "prov-1", applier.lastProviderID)
	// Re-fetched contract reflects bound payment_timing from chat accept.
	assert.Equal(t, "milestone", got.PaymentTiming)
	assert.Contains(t, string(got.TermsJSON), "local_terms")
	assert.Contains(t, string(got.TermsJSON), `"bound_at":"award"`)
	assert.Equal(t, []string{"contract_pending"}, repo.statusUpdates)
}

func TestCreateContractFromAward_PendingTermsNoOpStillSucceeds(t *testing.T) {
	t.Parallel()

	repo := &awardTestRepo{}
	applier := &mockPendingLocalTerms{boundContractID: ""} // nothing to apply
	svc := NewContractService(repo, nil)
	svc.SetPendingLocalTermsApplier(applier)

	got, err := svc.CreateContractFromAward(
		context.Background(),
		"job-1", "bid-1", "cust-1", "prov-1",
		10_000, "completion", nil,
	)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, 1, applier.calls)
	assert.Equal(t, "completion", got.PaymentTiming)
	assert.Equal(t, "contract-new", got.ID)
}

func TestCreateContractFromAward_PendingTermsFailureIsFailSoft(t *testing.T) {
	t.Parallel()

	repo := &awardTestRepo{}
	applier := &mockPendingLocalTerms{err: errors.New("chat tables unavailable")}
	svc := NewContractService(repo, nil)
	svc.SetPendingLocalTermsApplier(applier)

	got, err := svc.CreateContractFromAward(
		context.Background(),
		"job-1", "bid-1", "cust-1", "prov-1",
		10_000, "upfront", nil,
	)
	// Award must never fail because terms re-apply failed.
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, 1, applier.calls)
	assert.Equal(t, "contract-new", got.ID)
	assert.Equal(t, "upfront", got.PaymentTiming)
}

func TestCreateContractFromAward_NilApplierSkips(t *testing.T) {
	t.Parallel()

	repo := &awardTestRepo{}
	svc := NewContractService(repo, nil)
	// No SetPendingLocalTermsApplier — residual path disabled.

	got, err := svc.CreateContractFromAward(
		context.Background(),
		"job-1", "bid-1", "cust-1", "prov-1",
		10_000, "completion", nil,
	)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "contract-new", got.ID)
	assert.Equal(t, 0, repo.getCalls) // no re-fetch when applier nil
}

func TestOverrideAlreadyApplied(t *testing.T) {
	t.Parallel()
	assert.False(t, overrideAlreadyApplied(nil))
	assert.False(t, overrideAlreadyApplied([]byte(`{}`)))
	assert.False(t, overrideAlreadyApplied([]byte(`{"contract_override_applied":false}`)))
	assert.False(t, overrideAlreadyApplied([]byte(`{"contract_override_reason":"no_live_contract"}`)))
	assert.True(t, overrideAlreadyApplied([]byte(`{"contract_override_applied":true}`)))
	assert.True(t, overrideAlreadyApplied([]byte(`{"contract_override_applied":"true"}`)))
}

func TestNormalizePaymentTimingJob(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   string
		want string
		ok   bool
	}{
		{"milestone", "milestone", "milestone", true},
		{"Milestones", "Milestones", "milestone", true},
		{"up-front", "up-front", "upfront", true},
		{"payment plan", "payment plan", "payment_plan", true},
		{"completion", "completion", "completion", true},
		{"recurring", "recurring", "recurring", true},
		{"free text", "50% now", "", false},
		{"empty", "", "", false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, ok := normalizePaymentTiming(tc.in)
			assert.Equal(t, tc.ok, ok)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestBuildLocalTermsPatchAwardSource(t *testing.T) {
	t.Parallel()
	pt := "milestone"
	patch, err := buildLocalTermsPatch(
		map[string]interface{}{
			"payment_type": "milestone",
			"amount":       "50000",
			"description":  "half / half",
		},
		"cust-1", "ch-1", "prop-1", &pt,
	)
	require.NoError(t, err)
	var m map[string]interface{}
	require.NoError(t, json.Unmarshal(patch, &m))
	local, ok := m["local_terms"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "award", local["bound_at"])
	assert.Equal(t, "chat_proposed_terms", local["source"])
	assert.Equal(t, "milestone", local["payment_timing"])
	assert.Equal(t, "cust-1", local["accepted_by"])
	assert.Equal(t, "ch-1", local["channel_id"])
	assert.Equal(t, "prop-1", local["proposed_message_id"])
}

func TestExtractPaymentTimingJob(t *testing.T) {
	t.Parallel()
	pt := extractPaymentTiming(map[string]interface{}{"payment_type": "upfront"})
	require.NotNil(t, pt)
	assert.Equal(t, "upfront", *pt)

	pt = extractPaymentTiming(map[string]interface{}{
		"payment_timing": "milestone",
		"payment_type":   "ignore me",
	})
	require.NotNil(t, pt)
	assert.Equal(t, "milestone", *pt)

	assert.Nil(t, extractPaymentTiming(map[string]interface{}{
		"payment_type": "custom split",
	}))
}
