package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAccountsV2Enabled_DefaultOn(t *testing.T) {
	t.Setenv("STRIPE_ACCOUNTS_V2", "")
	assert.True(t, accountsV2Enabled())
}

func TestAccountsV2Enabled_CanDisable(t *testing.T) {
	for _, v := range []string{"false", "0", "off", "no", "FALSE"} {
		t.Run(v, func(t *testing.T) {
			t.Setenv("STRIPE_ACCOUNTS_V2", v)
			assert.False(t, accountsV2Enabled())
		})
	}
	t.Setenv("STRIPE_ACCOUNTS_V2", "true")
	assert.True(t, accountsV2Enabled())
}

func TestCreateStripeAccount_DevMode(t *testing.T) {
	// Force placeholder key path → dev mode.
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_...")
	s := NewStripeService("development")
	require.True(t, s.IsDevMode())

	id, err := s.CreateStripeAccount(context.Background(), "provider@example.com", "Acme")
	require.NoError(t, err)
	assert.Contains(t, id, "acct_dev_")
}

func TestCreateAccountSession_DevMode(t *testing.T) {
	t.Setenv("STRIPE_SECRET_KEY", "")
	s := NewStripeService("development")
	secret, exp, err := s.CreateAccountSession(context.Background(), "acct_dev_x")
	require.NoError(t, err)
	assert.Contains(t, secret, "acs_dev_secret_")
	assert.True(t, exp.After(time.Now()))
}

func TestGetAccountStatus_DevModeTransfersReady(t *testing.T) {
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_...")
	s := NewStripeService("development")
	st, err := s.GetAccountStatus(context.Background(), "acct_dev_1")
	require.NoError(t, err)
	assert.True(t, st.TransfersReady)
	assert.True(t, st.AccountExists, "dev-mode stub counts the stored id as the account on file")
	assert.Equal(t, "active", st.StripeTransfersStatus)
	assert.Equal(t, "v2", st.AccountsAPI)
}

func TestEnsureTransferDestinationReady_DevMode(t *testing.T) {
	t.Setenv("STRIPE_SECRET_KEY", "")
	s := NewStripeService("development")
	require.NoError(t, s.EnsureTransferDestinationReady(context.Background(), "acct_dev_1"))
}

func TestV2RecipientCreateRequest_RequestsPayoutsAndTransfers(t *testing.T) {
	t.Parallel()

	body := newV2RecipientCreateRequest("provider@example.com", "Acme")
	require.NotNil(t, body.Configuration.Recipient)
	require.NotNil(t, body.Configuration.Recipient.Capabilities)
	require.NotNil(t, body.Configuration.Recipient.Capabilities.StripeBalance)
	bal := body.Configuration.Recipient.Capabilities.StripeBalance
	require.NotNil(t, bal.StripeTransfers)
	assert.True(t, bal.StripeTransfers.Requested)
	require.NotNil(t, bal.Payouts)
	assert.True(t, bal.Payouts.Requested)
	assert.Equal(t, "express", body.Dashboard)
	assert.Equal(t, "application", body.Defaults.Responsibilities.FeesCollector)
	assert.Equal(t, "application", body.Defaults.Responsibilities.LossesCollector)

	raw, err := json.Marshal(body)
	require.NoError(t, err)
	s := string(raw)
	assert.Contains(t, s, `"stripe_transfers"`)
	assert.Contains(t, s, `"payouts"`)
	assert.NotContains(t, s, `"merchant"`)
	assert.NotContains(t, s, `"card_payments"`)
}

func TestCreateConnectInstantPayout_NotReadyFailsClosed(t *testing.T) {
	t.Setenv("STRIPE_ACCOUNTS_V2", "false")
	t.Setenv("STRIPE_SECRET_KEY", "")

	var payoutCalls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/payouts") {
			payoutCalls++
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":{"message":"payout must not be called"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"acct_not_ready",
			"object":"account",
			"charges_enabled":false,
			"payouts_enabled":false,
			"details_submitted":false,
			"capabilities":{"transfers":"inactive"}
		}`))
	}))
	t.Cleanup(srv.Close)
	useStripeTestBackend(t, srv.URL, 0, 5*time.Second)

	s := &StripeService{devMode: false}
	id, err := s.CreateConnectInstantPayout(context.Background(), 1000, "usd", "acct_not_ready", "idem-po")
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrTransfersNotReady), "got %v", err)
	assert.Empty(t, id)
	assert.NotContains(t, id, "payout_dev_")
	assert.NotContains(t, id, "po_")
	assert.Zero(t, payoutCalls, "must not call Stripe Payouts when the account is not transfer-ready")
}

func TestCreateStripeAccount_EmptyEmailDev(t *testing.T) {
	// Idempotency still works with empty email in dev.
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_...")
	s := NewStripeService("development")
	id, err := s.CreateStripeAccount(context.Background(), "", "")
	require.NoError(t, err)
	assert.NotEmpty(t, id)
}

// Ensure STRIPE_ACCOUNTS_V2 does not leak across tests in the same process if
// a prior test left it set — go test isolates t.Setenv, but document intent.
func TestAccountsV2EnvIsolation(t *testing.T) {
	prev, had := os.LookupEnv("STRIPE_ACCOUNTS_V2")
	t.Cleanup(func() {
		if had {
			_ = os.Setenv("STRIPE_ACCOUNTS_V2", prev)
		} else {
			_ = os.Unsetenv("STRIPE_ACCOUNTS_V2")
		}
	})
	t.Setenv("STRIPE_ACCOUNTS_V2", "false")
	assert.False(t, accountsV2Enabled())
}
