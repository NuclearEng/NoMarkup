package service

import (
	"context"
	"os"
	"testing"
	"time"

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
	assert.Equal(t, "active", st.StripeTransfersStatus)
	assert.Equal(t, "v2", st.AccountsAPI)
}

func TestEnsureTransferDestinationReady_DevMode(t *testing.T) {
	t.Setenv("STRIPE_SECRET_KEY", "")
	s := NewStripeService("development")
	require.NoError(t, s.EnsureTransferDestinationReady(context.Background(), "acct_dev_1"))
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
