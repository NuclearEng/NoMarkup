package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/nomarkup/nomarkup/services/chat/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPGLocalTermsBinder_emptyPartiesIsNoContractResidual pins the fail-soft
// residual when job or party ids are missing: ApplyLocalTerms returns ("", nil)
// without touching Postgres. A wrong-party or pre-award bind must never invent
// a contract_id.
func TestPGLocalTermsBinder_emptyPartiesIsNoContractResidual(t *testing.T) {
	t.Parallel()
	// nil pool would error only after the empty-party guard — prove the guard
	// short-circuits first so residual is "no eligible contract", not a 500.
	b := NewPGLocalTermsBinder(nil)

	cases := []struct {
		name                      string
		jobID, customer, provider string
	}{
		{"empty job", "", "cust-1", "prov-1"},
		{"empty customer", "job-1", "", "prov-1"},
		{"empty provider", "job-1", "cust-1", ""},
		{"all empty", "", "", ""},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			id, err := b.ApplyLocalTerms(context.Background(), tc.jobID, tc.customer, tc.provider, nil, []byte(`{"local_terms":{}}`))
			require.NoError(t, err, "missing party must residual as no-op, not error")
			assert.Empty(t, id, "must not invent a contract_id without matching parties")
		})
	}
}

// TestPGLocalTermsBinder_nilPoolErrors is the wired-but-misconfigured residual:
// empty parties already return; a full party set with no pool is a hard error so
// ops notice the miswire rather than silently consent-only forever.
func TestPGLocalTermsBinder_nilPoolErrors(t *testing.T) {
	t.Parallel()
	b := NewPGLocalTermsBinder(nil)
	_, err := b.ApplyLocalTerms(context.Background(), "job-1", "cust-1", "prov-1", nil, []byte(`{}`))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no database pool")

	_, _, err = b.LatestProposedTerms(context.Background(), "ch-1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no database pool")
}

// TestBuildLocalTermsPatch_partyAndConsent stamps the accepting customer and
// proposal provenance into terms_json.local_terms so audit can prove who accepted.
func TestBuildLocalTermsPatch_partyAndConsent(t *testing.T) {
	t.Parallel()
	pt := "milestone"
	raw, err := buildLocalTermsPatch(
		map[string]interface{}{
			"payment_type": "milestone",
			"amount":       "12000",
			"description":  "half mid / half end",
		},
		"cust-42",
		"ch-7",
		"prop-msg-9",
		&pt,
	)
	require.NoError(t, err)

	var patch map[string]interface{}
	require.NoError(t, json.Unmarshal(raw, &patch))
	local, ok := patch["local_terms"].(map[string]interface{})
	require.True(t, ok, "patch must nest under local_terms")
	assert.Equal(t, "cust-42", local["accepted_by"])
	assert.Equal(t, "ch-7", local["channel_id"])
	assert.Equal(t, "prop-msg-9", local["proposed_message_id"])
	assert.Equal(t, "chat_proposed_terms", local["source"])
	assert.Equal(t, "milestone", local["payment_timing"])
	assert.Equal(t, "12000", local["amount"])
	assert.NotEmpty(t, local["accepted_at"])
}

// TestRespondToTerms_applyUsesChannelParties is the security property: bind
// matches job + channel customer_id + channel provider_id. The caller identity
// is already constrained to the customer; parties for the SQL WHERE clause must
// still come from the channel so a compromised path cannot retarget another
// contract's parties.
func TestRespondToTerms_applyUsesChannelParties(t *testing.T) {
	t.Parallel()
	r := newMockRepo()
	r.channels["ch-1"] = &domain.Channel{
		ID: "ch-1", JobID: "job-party", CustomerID: "cust-party", ProviderID: "prov-party", Status: "active",
	}
	s := New(r, nil)
	binder := &mockLocalTermsBinder{
		proposed:      map[string]interface{}{"payment_type": "completion"},
		proposedMsgID: "prop-1",
		contractID:    "ctr-live",
	}
	s.SetLocalTermsBinder(binder)

	msg, err := s.RespondToTerms(context.Background(), "ch-1", "cust-party", true)
	require.NoError(t, err)
	require.NotNil(t, msg)
	assert.Equal(t, 1, binder.applyCalls)
	assert.Equal(t, "job-party", binder.lastJobID)
	assert.Equal(t, "cust-party", binder.lastCustomerID)
	assert.Equal(t, "prov-party", binder.lastProviderID)
	assert.Contains(t, string(msg.MetadataJSON), `"contract_override_applied":true`)
}

// TestRespondToTerms_applyFailedIsConsentResidual ensures binder DB errors do
// not fail Accept — consent is primary; override failure is stamped residual.
func TestRespondToTerms_applyFailedIsConsentResidual(t *testing.T) {
	t.Parallel()
	r := newMockRepo()
	r.channels["ch-1"] = &domain.Channel{
		ID: "ch-1", JobID: "job-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "active",
	}
	s := New(r, nil)
	binder := &mockLocalTermsBinder{
		proposed:      map[string]interface{}{"payment_type": "upfront"},
		proposedMsgID: "prop-1",
		applyErr:      assert.AnError,
	}
	s.SetLocalTermsBinder(binder)

	msg, err := s.RespondToTerms(context.Background(), "ch-1", "cust-1", true)
	require.NoError(t, err, "accept must succeed even when bind fails")
	assert.Equal(t, domain.MessageTypeTermsAccepted, msg.MessageType)
	assert.Contains(t, string(msg.MetadataJSON), `"contract_override_applied":false`)
	assert.Contains(t, string(msg.MetadataJSON), "apply_failed")
}

// TestRespondToTerms_noJobIDResidual covers channels without a job link.
func TestRespondToTerms_noJobIDResidual(t *testing.T) {
	t.Parallel()
	r := newMockRepo()
	r.channels["ch-1"] = &domain.Channel{
		ID: "ch-1", JobID: "", CustomerID: "cust-1", ProviderID: "prov-1", Status: "active",
	}
	s := New(r, nil)
	binder := &mockLocalTermsBinder{
		proposed:      map[string]interface{}{"payment_type": "upfront"},
		proposedMsgID: "prop-1",
		contractID:    "should-not-apply",
	}
	s.SetLocalTermsBinder(binder)

	msg, err := s.RespondToTerms(context.Background(), "ch-1", "cust-1", true)
	require.NoError(t, err)
	assert.Equal(t, 0, binder.applyCalls)
	assert.Contains(t, string(msg.MetadataJSON), "no_job_id")
	assert.Contains(t, string(msg.MetadataJSON), `"contract_override_applied":false`)
}
