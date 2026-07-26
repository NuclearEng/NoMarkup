package service

// Authorization tests for the escrow release / refund actor model.
//
// Context: POST /api/v1/payments/{id}/{release,refund} sit behind
// RequirePartyAccess, which admits EITHER party to the payment. That
// middleware cannot tell the payer from the payee, so before these checks
// existed a provider could release their own escrow (paying themselves for
// work the customer never confirmed) and a customer could then refund the
// already-released payment, which pulls from the PLATFORM balance while the
// provider keeps their transfer. Chained, the two drained roughly the
// provider payout per contract, repeatably.
//
// These tests pin the actor rules so that chain cannot be reopened.

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

func actorTestPayment(id string) *domain.Payment {
	return &domain.Payment{
		ID:                    id,
		CustomerID:            "cust-1",
		ProviderID:            "prov-1",
		AmountCents:           38500,
		ProviderPayoutCents:   35795,
		StripePaymentIntentID: "pi_actor_test",
	}
}

// The headline case: the payee must not be able to pay themselves.
func TestReleaseEscrow_providerCannotReleaseOwnEscrow(t *testing.T) {
	t.Parallel()

	payment := actorTestPayment("pay-actor-1")
	f := newEscrowFixture(t, "escrow", payment)

	_, err := f.svc.ReleaseEscrow(context.Background(), payment.ID, "done",
		ReleaseActor{UserID: payment.ProviderID})

	require.ErrorIs(t, err, domain.ErrNotAuthorizedActor)
	assert.Zero(t, f.updateCalls["released"], "must not transition to released")
	assert.Zero(t, f.transferCalls, "must not move money")
}

func TestReleaseEscrow_customerMayRelease(t *testing.T) {
	t.Parallel()

	payment := actorTestPayment("pay-actor-2")
	f := newEscrowFixture(t, "escrow", payment)

	got, err := f.svc.ReleaseEscrow(context.Background(), payment.ID, "completion approved",
		ReleaseActor{UserID: payment.CustomerID})

	require.NoError(t, err)
	assert.Equal(t, "released", got.Status)
}

func TestReleaseEscrow_adminMayRelease(t *testing.T) {
	t.Parallel()

	payment := actorTestPayment("pay-actor-3")
	f := newEscrowFixture(t, "escrow", payment)

	got, err := f.svc.ReleaseEscrow(context.Background(), payment.ID, "dispute resolved",
		ReleaseActor{UserID: "admin-1", IsAdmin: true})

	require.NoError(t, err)
	assert.Equal(t, "released", got.Status)
}

// Fail closed: an unattributed caller-initiated release is refused rather than
// assumed trusted. Only an explicit System actor bypasses the actor check.
func TestReleaseEscrow_emptyActorIsRefused(t *testing.T) {
	t.Parallel()

	payment := actorTestPayment("pay-actor-4")
	f := newEscrowFixture(t, "escrow", payment)

	_, err := f.svc.ReleaseEscrow(context.Background(), payment.ID, "auto", ReleaseActor{})

	require.ErrorIs(t, err, domain.ErrNotAuthorizedActor)
	assert.Zero(t, f.transferCalls, "must not move money")
}

func TestReleaseEscrow_systemActorMayRelease(t *testing.T) {
	t.Parallel()

	payment := actorTestPayment("pay-actor-5")
	f := newEscrowFixture(t, "escrow", payment)

	got, err := f.svc.ReleaseEscrow(context.Background(), payment.ID, "auto_release",
		ReleaseActor{System: true})

	require.NoError(t, err)
	assert.Equal(t, "released", got.Status)
}

// A third party who is neither payer nor payee is refused. RequirePartyAccess
// should already have blocked them; this is defence in depth at the layer that
// actually owns the money.
func TestReleaseEscrow_strangerIsRefused(t *testing.T) {
	t.Parallel()

	payment := actorTestPayment("pay-actor-6")
	f := newEscrowFixture(t, "escrow", payment)

	_, err := f.svc.ReleaseEscrow(context.Background(), payment.ID, "nice try",
		ReleaseActor{UserID: "someone-else"})

	require.ErrorIs(t, err, domain.ErrNotAuthorizedActor)
}

// The other half of the drain: once the provider holds their transfer, a
// refund comes out of the platform's balance.
func TestCreateRefund_customerCannotRefundAfterRelease(t *testing.T) {
	t.Parallel()

	for _, status := range []string{"released", "completed", "partially_refunded"} {
		t.Run(status, func(t *testing.T) {
			t.Parallel()

			payment := actorTestPayment("pay-actor-refund-" + status)
			f := newEscrowFixture(t, status, payment)

			_, err := f.svc.CreateRefund(context.Background(), payment.ID, 0, "changed my mind",
				ReleaseActor{UserID: payment.CustomerID})

			require.ErrorIs(t, err, domain.ErrNotAuthorizedActor)
			assert.Zero(t, f.refundCalls, "must not issue a Stripe refund")
		})
	}
}

func TestCreateRefund_providerCannotRefundAfterRelease(t *testing.T) {
	t.Parallel()

	payment := actorTestPayment("pay-actor-refund-prov")
	f := newEscrowFixture(t, "released", payment)

	_, err := f.svc.CreateRefund(context.Background(), payment.ID, 0, "nope",
		ReleaseActor{UserID: payment.ProviderID})

	require.ErrorIs(t, err, domain.ErrNotAuthorizedActor)
	assert.Zero(t, f.refundCalls, "must not issue a Stripe refund")
}

// Still in escrow, no transfer has happened — returning held funds is a
// legitimate party action.
func TestCreateRefund_customerMayRefundWhileInEscrow(t *testing.T) {
	t.Parallel()

	payment := actorTestPayment("pay-actor-refund-escrow")
	f := newEscrowFixture(t, "escrow", payment)

	got, err := f.svc.CreateRefund(context.Background(), payment.ID, 0, "cancelled before work started",
		ReleaseActor{UserID: payment.CustomerID})

	require.NoError(t, err)
	assert.Equal(t, "refunded", got.Status)
}

// Post-payout refunds remain possible — as a dispute-resolution decision.
func TestCreateRefund_adminMayRefundAfterRelease(t *testing.T) {
	t.Parallel()

	payment := actorTestPayment("pay-actor-refund-admin")
	f := newEscrowFixture(t, "released", payment)

	got, err := f.svc.CreateRefund(context.Background(), payment.ID, 0, "dispute resolved for customer",
		ReleaseActor{UserID: "admin-1", IsAdmin: true})

	require.NoError(t, err)
	assert.Equal(t, "refunded", got.Status)
}

// The full attack chain, end to end: self-release then refund. The first leg
// must fail, so the second never becomes reachable.
func TestEscrowDrainChain_isClosed(t *testing.T) {
	t.Parallel()

	payment := actorTestPayment("pay-drain")
	f := newEscrowFixture(t, "escrow", payment)

	_, releaseErr := f.svc.ReleaseEscrow(context.Background(), payment.ID, "done",
		ReleaseActor{UserID: payment.ProviderID})
	require.ErrorIs(t, releaseErr, domain.ErrNotAuthorizedActor,
		"leg 1: provider self-release must be refused")

	_, refundErr := f.svc.CreateRefund(context.Background(), payment.ID, 0, "refund me",
		ReleaseActor{UserID: payment.CustomerID})
	require.NoError(t, refundErr,
		"payment is still in escrow, so a customer refund of held funds is legitimate")

	assert.Zero(t, f.transferCalls, "no money may reach the provider in this chain")
}
