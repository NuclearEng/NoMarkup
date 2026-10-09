package service

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stripe/stripe-go/v82"
)

func TestIsDevOrPlaceholderStripeCustomer(t *testing.T) {
	t.Parallel()
	assert.True(t, isDevOrPlaceholderStripeCustomer("cus_dev_x"))
	assert.True(t, isDevOrPlaceholderStripeCustomer("cus_dev_8f0d28f9-d12b-47dc-9964-4f5ea605a83d"))
	assert.True(t, isDevOrPlaceholderStripeCustomer(""))
	assert.True(t, isDevOrPlaceholderStripeCustomer("cus_..."))
	assert.False(t, isDevOrPlaceholderStripeCustomer("cus_abc123"))
	assert.False(t, isDevOrPlaceholderStripeCustomer("cus_RMpdRwGgkBcApE"))
}

func TestIsDevOrPlaceholderConnectAccount(t *testing.T) {
	t.Parallel()
	assert.True(t, isDevOrPlaceholderConnectAccount("acct_dev_"))
	assert.True(t, isDevOrPlaceholderConnectAccount("acct_dev_provider@example.com"))
	assert.True(t, isDevOrPlaceholderConnectAccount(""))
	assert.False(t, isDevOrPlaceholderConnectAccount("acct_1U1CXFJHlqeMn8hs"))
}

func TestStripeErrIsMissingResource(t *testing.T) {
	t.Parallel()

	t.Run("resource_missing_code", func(t *testing.T) {
		t.Parallel()
		err := fmt.Errorf("list payment methods: %w", &stripe.Error{
			Code: stripe.ErrorCodeResourceMissing,
			Msg:  "No such customer: 'cus_dev_dead'",
		})
		assert.True(t, stripeErrIsMissingResource(err))
	})

	t.Run("account_invalid_code", func(t *testing.T) {
		t.Parallel()
		assert.True(t, stripeErrIsMissingResource(&stripe.Error{
			Code: stripe.ErrorCodeAccountInvalid,
			Msg:  "The provided key does not have access to account 'acct_dev_'",
		}))
	})

	t.Run("http_403_no_access", func(t *testing.T) {
		t.Parallel()
		assert.True(t, stripeErrIsMissingResource(&stripe.Error{
			HTTPStatusCode: 403,
			Msg:            "The provided key does not have access to account 'acct_xyz'",
		}))
	})

	t.Run("card_declined_is_not_missing", func(t *testing.T) {
		t.Parallel()
		assert.False(t, stripeErrIsMissingResource(&stripe.Error{
			Code: stripe.ErrorCodeCardDeclined,
		}))
	})

	t.Run("transport_error_is_not_missing", func(t *testing.T) {
		t.Parallel()
		assert.False(t, stripeErrIsMissingResource(errors.New("context deadline exceeded")))
	})

	t.Run("nil", func(t *testing.T) {
		t.Parallel()
		assert.False(t, stripeErrIsMissingResource(nil))
	})
}

func TestIsSyntheticDevStripeAccountID(t *testing.T) {
	t.Parallel()
	assert.True(t, isSyntheticDevStripeAccountID("acct_dev_foo"))
	assert.False(t, isSyntheticDevStripeAccountID("acct_1U1"))
}
