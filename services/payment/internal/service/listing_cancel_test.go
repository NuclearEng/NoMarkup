package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const unpaidCancelPI = "pi_unpaid_listing_1"

type cancelHarness struct {
	svc       *MarketplaceService
	repo      *mockMarketplaceRepo
	stripe    *StripeService
	orderID   string
	listingID string
	buyerID   string
	sellerID  string
}

func newCancelHarness(escrow, piStatus, piID string) *cancelHarness {
	repo := newMockRepo()
	h := &cancelHarness{
		repo:      repo,
		orderID:   "order-unpaid-1",
		listingID: "listing-unpaid-1",
		buyerID:   "user-buyer",
		sellerID:  "user-seller",
	}
	bid := int64(2500)
	repo.addOrder(&MarketplaceListingOrder{
		ID:              h.orderID,
		ListingID:       h.listingID,
		SellerID:        h.sellerID,
		BuyerID:         h.buyerID,
		AmountCents:     bid,
		EscrowStatus:    escrow,
		PaymentIntentID: piID,
		CreatedAt:       time.Now().Add(-time.Hour),
	})
	repo.listings[h.listingID] = &mockListingSale{
		status:               "sold",
		currentBidderID:      h.buyerID,
		currentBidCents:      &bid,
		auctionEndsAt:        time.Now().Add(-2 * time.Hour),
		auctionDurationHours: 24,
	}
	repo.bidStatus[h.listingID] = "awarded"
	h.stripe = &StripeService{devMode: true, testPaymentIntentStatus: piStatus}
	h.svc = NewMarketplaceService(repo, h.stripe)
	return h
}

func (h *cancelHarness) listing() *mockListingSale {
	return h.repo.listings[h.listingID]
}

func TestCancelUnpaidListingOrder_capturableStatusLeavesListingSold(t *testing.T) {
	for _, status := range []string{"succeeded", "requires_capture", "processing"} {
		t.Run(status, func(t *testing.T) {
			h := newCancelHarness("pending_payment", status, unpaidCancelPI)
			_, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.buyerID, "buyer")
			require.ErrorIs(t, err, ErrPaymentIntentCapturable)
			assert.Empty(t, h.stripe.testCanceledPaymentIntentIDs)
			assert.Equal(t, 0, h.repo.abandonCalls)
			got, gerr := h.repo.GetListingOrder(context.Background(), h.orderID)
			require.NoError(t, gerr)
			assert.Equal(t, "pending_payment", got.EscrowStatus)
			assert.Equal(t, "sold", h.listing().status)
			assert.Equal(t, h.buyerID, h.listing().currentBidderID)
			assert.NotNil(t, h.listing().currentBidCents)
			assert.Equal(t, "awarded", h.repo.bidStatus[h.listingID])
			assert.Equal(t, 0, h.repo.paymentAttempts[h.orderID])
		})
	}
}

func TestCancelUnpaidListingOrder_requiresPaymentMethodCancelsAndRelists(t *testing.T) {
	h := newCancelHarness("pending_payment", "requires_payment_method", unpaidCancelPI)
	started := time.Now()
	res, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.buyerID, "buyer")
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.Equal(t, h.orderID, res.OrderID)
	assert.Equal(t, h.listingID, res.ListingID)
	assert.Equal(t, "payment_failed", res.EscrowStatus)
	assert.Equal(t, "active", res.ListingStatus)
	assert.Equal(t, []string{unpaidCancelPI}, h.stripe.testCanceledPaymentIntentIDs)
	assert.Equal(t, 1, h.repo.abandonCalls)

	got, gerr := h.repo.GetListingOrder(context.Background(), h.orderID)
	require.NoError(t, gerr)
	assert.Equal(t, "payment_failed", got.EscrowStatus)
	assert.Equal(t, "buyer canceled unpaid order", h.repo.lastPaymentErr[h.orderID])
	assert.Equal(t, 0, h.repo.paymentAttempts[h.orderID])

	listing := h.listing()
	assert.Equal(t, "active", listing.status)
	assert.Empty(t, listing.currentBidderID)
	assert.Nil(t, listing.currentBidCents)
	assert.True(t, listing.auctionEndsAt.After(started), "auction end %s, start %s", listing.auctionEndsAt, started)
	assert.True(t, listing.auctionEndsAt.After(started.Add(23*time.Hour)))
	assert.Equal(t, "outbid", h.repo.bidStatus[h.listingID])

	end := listing.auctionEndsAt
	res2, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.buyerID, "buyer")
	require.NoError(t, err)
	assert.Equal(t, "payment_failed", res2.EscrowStatus)
	assert.Equal(t, "active", res2.ListingStatus)
	assert.Equal(t, []string{unpaidCancelPI}, h.stripe.testCanceledPaymentIntentIDs)
	assert.Equal(t, 1, h.repo.abandonCalls)
	assert.True(t, h.listing().auctionEndsAt.Equal(end))
}

func TestCancelUnpaidListingOrder_emptyPaymentIntentRelistsWithoutCancel(t *testing.T) {
	h := newCancelHarness("pending_payment", "requires_payment_method", "")
	started := time.Now()
	res, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.buyerID, "buyer")
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.Equal(t, "payment_failed", res.EscrowStatus)
	assert.Equal(t, "active", res.ListingStatus)
	assert.Empty(t, h.stripe.testCanceledPaymentIntentIDs)
	assert.Equal(t, 1, h.repo.abandonCalls)
	got, gerr := h.repo.GetListingOrder(context.Background(), h.orderID)
	require.NoError(t, gerr)
	assert.Equal(t, "payment_failed", got.EscrowStatus)
	assert.Equal(t, "active", h.listing().status)
	assert.Empty(t, h.listing().currentBidderID)
	assert.True(t, h.listing().auctionEndsAt.After(started))
	assert.Equal(t, "outbid", h.repo.bidStatus[h.listingID])
}

func TestCancelUnpaidListingOrder_alreadyCanceledRelistsWithoutCancelCall(t *testing.T) {
	h := newCancelHarness("pending_payment", "canceled", unpaidCancelPI)
	started := time.Now()
	res, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.buyerID, "buyer")
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.Equal(t, "active", res.ListingStatus)
	assert.Empty(t, h.stripe.testCanceledPaymentIntentIDs)
	assert.Equal(t, 1, h.repo.abandonCalls)
	got, gerr := h.repo.GetListingOrder(context.Background(), h.orderID)
	require.NoError(t, gerr)
	assert.Equal(t, "payment_failed", got.EscrowStatus)
	assert.Equal(t, "active", h.listing().status)
	assert.Empty(t, h.listing().currentBidderID)
	assert.True(t, h.listing().auctionEndsAt.After(started))
	assert.Equal(t, "outbid", h.repo.bidStatus[h.listingID])
}

func TestCancelUnpaidListingOrder_cancelErrorDoesNotRelist(t *testing.T) {
	h := newCancelHarness("pending_payment", "requires_confirmation", unpaidCancelPI)
	h.stripe.testCancelPaymentIntentErr = errors.New("stripe refused cancel")
	_, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.buyerID, "buyer")
	require.Error(t, err)
	assert.ErrorContains(t, err, "stripe refused cancel")
	assert.Empty(t, h.stripe.testCanceledPaymentIntentIDs)
	assert.Equal(t, 0, h.repo.abandonCalls)
	got, gerr := h.repo.GetListingOrder(context.Background(), h.orderID)
	require.NoError(t, gerr)
	assert.Equal(t, "pending_payment", got.EscrowStatus)
	assert.Equal(t, "sold", h.listing().status)
	assert.Equal(t, h.buyerID, h.listing().currentBidderID)
	assert.Equal(t, "awarded", h.repo.bidStatus[h.listingID])
}

func TestCancelUnpaidListingOrder_heldEscrowRejected(t *testing.T) {
	h := newCancelHarness("held", "", unpaidCancelPI)
	_, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.buyerID, "buyer")
	require.ErrorIs(t, err, ErrInvalidEscrowState)
	assert.Empty(t, h.stripe.testCanceledPaymentIntentIDs)
	assert.Equal(t, 0, h.repo.abandonCalls)
	assert.Equal(t, "", h.stripe.testPaymentIntentStatus)
	got, gerr := h.repo.GetListingOrder(context.Background(), h.orderID)
	require.NoError(t, gerr)
	assert.Equal(t, "held", got.EscrowStatus)
	assert.Equal(t, "sold", h.listing().status)
}

func TestCancelUnpaidListingOrder_sellerIsNotBuyer(t *testing.T) {
	h := newCancelHarness("pending_payment", "", unpaidCancelPI)
	_, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.sellerID, "buyer")
	require.ErrorIs(t, err, ErrNotBuyer)
	assert.Empty(t, h.stripe.testCanceledPaymentIntentIDs)
	assert.Equal(t, 0, h.repo.abandonCalls)
	got, gerr := h.repo.GetListingOrder(context.Background(), h.orderID)
	require.NoError(t, gerr)
	assert.Equal(t, "pending_payment", got.EscrowStatus)
	assert.Equal(t, "sold", h.listing().status)
	assert.Equal(t, "awarded", h.repo.bidStatus[h.listingID])
}

func TestCancelUnpaidListingOrder_adminRelists(t *testing.T) {
	h := newCancelHarness("pending_payment", "requires_action", unpaidCancelPI)
	started := time.Now()
	res, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, "user-admin", "admin")
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.Equal(t, "payment_failed", res.EscrowStatus)
	assert.Equal(t, "active", res.ListingStatus)
	assert.Equal(t, []string{unpaidCancelPI}, h.stripe.testCanceledPaymentIntentIDs)
	assert.Equal(t, 1, h.repo.abandonCalls)
	assert.Equal(t, "active", h.listing().status)
	assert.Empty(t, h.listing().currentBidderID)
	assert.True(t, h.listing().auctionEndsAt.After(started))
	assert.Equal(t, "outbid", h.repo.bidStatus[h.listingID])
}

func TestCancelUnpaidListingOrder_unexpectedStatusDoesNotRelist(t *testing.T) {
	h := newCancelHarness("pending_payment", "requires_something_else", unpaidCancelPI)
	_, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.buyerID, "buyer")
	require.Error(t, err)
	assert.NotErrorIs(t, err, ErrPaymentIntentCapturable)
	assert.Empty(t, h.stripe.testCanceledPaymentIntentIDs)
	assert.Equal(t, 0, h.repo.abandonCalls)
	got, gerr := h.repo.GetListingOrder(context.Background(), h.orderID)
	require.NoError(t, gerr)
	assert.Equal(t, "pending_payment", got.EscrowStatus)
	assert.Equal(t, "sold", h.listing().status)
	assert.Equal(t, "awarded", h.repo.bidStatus[h.listingID])
}

func TestCancelUnpaidListingOrder_alreadyRelistedShortCircuit(t *testing.T) {
	h := newCancelHarness("payment_failed", "requires_payment_method", unpaidCancelPI)
	ends := time.Now().Add(48 * time.Hour)
	h.listing().status = "active"
	h.listing().currentBidderID = ""
	h.listing().currentBidCents = nil
	h.listing().auctionEndsAt = ends
	h.repo.bidStatus[h.listingID] = "outbid"

	res, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.buyerID, "buyer")
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.Equal(t, h.orderID, res.OrderID)
	assert.Equal(t, h.listingID, res.ListingID)
	assert.Equal(t, "payment_failed", res.EscrowStatus)
	assert.Equal(t, "active", res.ListingStatus)
	assert.Empty(t, h.stripe.testCanceledPaymentIntentIDs)
	assert.Equal(t, 0, h.repo.abandonCalls)
	assert.GreaterOrEqual(t, h.repo.saleStateCalls, 1)
	assert.True(t, h.listing().auctionEndsAt.Equal(ends))
	assert.Equal(t, "active", h.listing().status)
	assert.Empty(t, h.listing().currentBidderID)
	got, gerr := h.repo.GetListingOrder(context.Background(), h.orderID)
	require.NoError(t, gerr)
	assert.Equal(t, "payment_failed", got.EscrowStatus)
}

func TestCancelUnpaidListingOrder_rejectsEmptyIdempotencyKey(t *testing.T) {
	s := &StripeService{devMode: true, testPaymentIntentStatus: "requires_payment_method"}
	err := s.CancelUncapturablePaymentIntent(context.Background(), unpaidCancelPI, "")
	require.Error(t, err)
	assert.Empty(t, s.testCanceledPaymentIntentIDs)
}

func TestCancelUnpaidListingOrder_emptyIntentIDIsNoop(t *testing.T) {
	s := &StripeService{devMode: false, testPaymentIntentStatus: "succeeded"}
	err := s.CancelUncapturablePaymentIntent(context.Background(), "", "listing-order-cancel:order-unpaid-1")
	require.NoError(t, err)
	assert.Empty(t, s.testCanceledPaymentIntentIDs)
}

func TestCancelUnpaidListingOrder_devStoreSucceededDoesNotRelist(t *testing.T) {
	h := newCancelHarness("pending_payment", "", unpaidCancelPI)
	h.stripe.testPaymentIntentStatus = ""
	h.stripe.DevStore().RecordPaymentIntent(unpaidCancelPI, "cus_dev_buyer", 2500, "dev-confirm")
	status, err := h.stripe.DevStore().ConfirmPaymentIntent(unpaidCancelPI, "card_ok", "confirm-unpaid-1")
	require.NoError(t, err)
	require.Equal(t, "succeeded", status)

	_, err = h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.buyerID, "buyer")
	require.ErrorIs(t, err, ErrPaymentIntentCapturable)
	assert.Equal(t, 0, h.repo.abandonCalls)
	assert.Equal(t, "sold", h.listing().status)
	assert.Equal(t, h.buyerID, h.listing().currentBidderID)
	assert.Equal(t, "awarded", h.repo.bidStatus[h.listingID])
	got, gerr := h.repo.GetListingOrder(context.Background(), h.orderID)
	require.NoError(t, gerr)
	assert.Equal(t, "pending_payment", got.EscrowStatus)
	assert.Equal(t, "succeeded", h.stripe.DevStore().PaymentIntentStatus(unpaidCancelPI))
}

func TestCancelUnpaidListingOrder_devStoreCancelableIsMarkedCanceled(t *testing.T) {
	h := newCancelHarness("pending_payment", "", unpaidCancelPI)
	h.stripe.testPaymentIntentStatus = ""
	h.stripe.DevStore().RecordPaymentIntent(unpaidCancelPI, "cus_dev_buyer", 2500, "dev-confirm")

	res, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.buyerID, "buyer")
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.Equal(t, "active", res.ListingStatus)
	assert.Equal(t, "payment_failed", res.EscrowStatus)
	assert.Equal(t, "canceled", h.stripe.DevStore().PaymentIntentStatus(unpaidCancelPI))
	assert.Empty(t, h.listing().currentBidderID)
	assert.Equal(t, "outbid", h.repo.bidStatus[h.listingID])
}

func TestCancelUnpaidListingOrder_fundRaceDoesNotRelist(t *testing.T) {
	h := newCancelHarness("pending_payment", "requires_payment_method", unpaidCancelPI)
	h.repo.abandonEscrowOverride = "held"
	_, err := h.svc.CancelUnpaidListingOrder(context.Background(), h.orderID, h.buyerID, "buyer")
	require.ErrorIs(t, err, ErrInvalidEscrowState)
	assert.Equal(t, []string{unpaidCancelPI}, h.stripe.testCanceledPaymentIntentIDs)
	assert.Equal(t, 1, h.repo.abandonCalls)
	assert.Equal(t, "sold", h.listing().status)
	assert.Equal(t, h.buyerID, h.listing().currentBidderID)
	assert.Equal(t, "awarded", h.repo.bidStatus[h.listingID])
	assert.NotNil(t, h.listing().currentBidCents)
}
