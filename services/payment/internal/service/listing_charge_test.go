package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Mock MarketplaceRepository ---

type mockMarketplaceRepo struct {
	mu sync.Mutex

	orders    map[string]*MarketplaceListingOrder
	disputes  map[string]*MarketplaceDispute
	taxIncs   []taxIncrement
	notifyLog []string
}

type taxIncrement struct {
	sellerID string
	year     int
	cents    int64
}

func newMockRepo() *mockMarketplaceRepo {
	return &mockMarketplaceRepo{
		orders:   map[string]*MarketplaceListingOrder{},
		disputes: map[string]*MarketplaceDispute{},
	}
}

func (m *mockMarketplaceRepo) addOrder(o *MarketplaceListingOrder) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *o
	m.orders[o.ID] = &cp
}

func (m *mockMarketplaceRepo) GetListingOrder(_ context.Context, orderID string) (*MarketplaceListingOrder, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.orders[orderID]
	if !ok {
		return nil, ErrListingOrderNotFound
	}
	cp := *o
	return &cp, nil
}

func (m *mockMarketplaceRepo) GetListingOrderByPaymentIntent(_ context.Context, piID string) (*MarketplaceListingOrder, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, o := range m.orders {
		if o.PaymentIntentID == piID {
			cp := *o
			return &cp, nil
		}
	}
	return nil, ErrListingOrderNotFound
}

func (m *mockMarketplaceRepo) UpdateListingOrderEscrowStatus(_ context.Context, orderID, newStatus string, releasedAt *time.Time, pickupConfirmedAt *time.Time, sellerPayoutCents int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.orders[orderID]
	if !ok {
		return ErrListingOrderNotFound
	}
	o.EscrowStatus = newStatus
	if releasedAt != nil {
		o.ReleasedAt = releasedAt
	}
	if pickupConfirmedAt != nil {
		o.PickupConfirmedAt = pickupConfirmedAt
	}
	if sellerPayoutCents > 0 {
		o.SellerPayoutCents = sellerPayoutCents
	}
	return nil
}

func (m *mockMarketplaceRepo) UpdateListingOrderPaymentIntent(_ context.Context, orderID, paymentIntentID, idempotencyKey string, taxCents int64, autoReleaseAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.orders[orderID]
	if !ok {
		return ErrListingOrderNotFound
	}
	o.PaymentIntentID = paymentIntentID
	o.IdempotencyKey = idempotencyKey
	o.TaxCents = taxCents
	t := autoReleaseAt
	o.AutoReleaseAt = &t
	return nil
}

func (m *mockMarketplaceRepo) UpdateListingOrderDispute(_ context.Context, orderID string, disputeID *string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.orders[orderID]
	if !ok {
		return ErrListingOrderNotFound
	}
	o.DisputeID = disputeID
	return nil
}

func (m *mockMarketplaceRepo) ListListingOrdersForAutoRelease(_ context.Context, before time.Time, limit int) ([]*MarketplaceListingOrder, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*MarketplaceListingOrder
	for _, o := range m.orders {
		if o.EscrowStatus != "held" {
			continue
		}
		if o.DisputeID != nil && *o.DisputeID != "" {
			continue
		}
		if !o.CreatedAt.Before(before) {
			continue
		}
		cp := *o
		out = append(out, &cp)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (m *mockMarketplaceRepo) CreateMarketplaceDispute(_ context.Context, d *MarketplaceDispute) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *d
	m.disputes[d.ID] = &cp
	return nil
}

func (m *mockMarketplaceRepo) GetMarketplaceDispute(_ context.Context, disputeID string) (*MarketplaceDispute, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.disputes[disputeID]
	if !ok {
		return nil, errors.New("dispute not found")
	}
	cp := *d
	return &cp, nil
}

func (m *mockMarketplaceRepo) ResolveMarketplaceDispute(_ context.Context, disputeID, resolution, notes, adminID string, refundCents, transferCents int64) (*MarketplaceDispute, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.disputes[disputeID]
	if !ok {
		return nil, errors.New("dispute not found")
	}
	d.Status = "resolved"
	d.Resolution = resolution
	d.ResolutionNotes = notes
	d.RefundToBuyerCents = refundCents
	d.TransferToSellerCents = transferCents
	d.ResolvedBy = &adminID
	now := time.Now()
	d.ResolvedAt = &now
	cp := *d
	return &cp, nil
}

func (m *mockMarketplaceRepo) IncrementSellerTaxForm(_ context.Context, sellerID string, taxYear int, grossPaymentsCents int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.taxIncs = append(m.taxIncs, taxIncrement{sellerID: sellerID, year: taxYear, cents: grossPaymentsCents})
	return nil
}

// --- Mock notifier ---

type captureNotifier struct {
	mu     sync.Mutex
	events []string
}

func (n *captureNotifier) push(e string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.events = append(n.events, e)
}
func (n *captureNotifier) NotifyPaymentReleased(_ context.Context, sellerID, orderID string, amountCents int64) error {
	n.push("released:" + sellerID + ":" + orderID)
	return nil
}
func (n *captureNotifier) NotifyAutoReleaseToBuyer(_ context.Context, buyerID, orderID string) error {
	n.push("auto_buyer:" + buyerID + ":" + orderID)
	return nil
}
func (n *captureNotifier) NotifyAutoReleaseToSeller(_ context.Context, sellerID, orderID string, _ int64) error {
	n.push("auto_seller:" + sellerID + ":" + orderID)
	return nil
}
func (n *captureNotifier) NotifyDisputeFiled(_ context.Context, sellerID, orderID, disputeID string) error {
	n.push("dispute_filed:" + sellerID + ":" + orderID + ":" + disputeID)
	return nil
}
func (n *captureNotifier) NotifyDisputeResolved(_ context.Context, userID, orderID, disputeID, resolution string) error {
	n.push("dispute_resolved:" + userID + ":" + orderID + ":" + disputeID + ":" + resolution)
	return nil
}

// --- Helpers ---

func newMarketplaceFixture() (*MarketplaceService, *mockMarketplaceRepo, *captureNotifier) {
	repo := newMockRepo()
	notifier := &captureNotifier{}
	stripe := &StripeService{devMode: true}
	svc := NewMarketplaceService(repo, stripe)
	svc.SetNotifier(notifier)
	return svc, repo, notifier
}

func newOrder(id, status string, amount, fee int64) *MarketplaceListingOrder {
	return &MarketplaceListingOrder{
		ID:           id,
		ListingID:    "listing-" + id,
		SellerID:     "seller-" + id,
		BuyerID:      "buyer-" + id,
		AmountCents:  amount,
		FeeCents:     fee,
		EscrowStatus: status,
		CreatedAt:    time.Now().Add(-time.Hour),
		UpdatedAt:    time.Now(),
	}
}

// ====== State machine tests ======

func TestMarketplaceStateMachine_pending_to_held_via_charge_then_webhook(t *testing.T) {
	t.Parallel()
	svc, repo, _ := newMarketplaceFixture()

	o := newOrder("ord-1", "pending_payment", 50000, 2500)
	o.PickupZipCode = "94016" // CA, 7.25%
	repo.addOrder(o)

	// 1. Charge winner — creates PI, persists, leaves in pending_payment.
	res, err := svc.ChargeListingWinner(context.Background(), o.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(3625), res.TaxCents, "CA tax = 50000*0.0725 = 3625")
	assert.Equal(t, int64(50000+2500+3625), res.TotalCents)
	assert.Contains(t, res.PaymentIntentID, "pi_listing_dev_listing-charge:ord-1")

	got, _ := repo.GetListingOrder(context.Background(), o.ID)
	assert.Equal(t, "pending_payment", got.EscrowStatus, "status remains pending_payment until webhook")
	assert.Equal(t, int64(3625), got.TaxCents)
	require.NotNil(t, got.AutoReleaseAt)

	// 2. Webhook fires — flips to held.
	require.NoError(t, svc.HandleListingPaymentIntentSucceeded(context.Background(), got.PaymentIntentID))
	got, _ = repo.GetListingOrder(context.Background(), o.ID)
	assert.Equal(t, "held", got.EscrowStatus)
}

func TestMarketplaceStateMachine_held_to_released_via_pickup_confirm(t *testing.T) {
	t.Parallel()
	svc, repo, notifier := newMarketplaceFixture()

	o := newOrder("ord-2", "held", 50000, 2500)
	o.PaymentIntentID = "pi_existing"
	repo.addOrder(o)

	got, err := svc.ConfirmPickup(context.Background(), o.ID, o.BuyerID, "buyer")
	require.NoError(t, err)
	assert.Equal(t, "released", got.EscrowStatus)
	assert.Equal(t, int64(50000-2500), got.SellerPayoutCents)
	require.NotNil(t, got.ReleasedAt)
	require.NotNil(t, got.PickupConfirmedAt)

	require.Len(t, notifier.events, 1)
	assert.Contains(t, notifier.events[0], "released:seller-ord-2")

	// 1099-K accumulated.
	require.Len(t, repo.taxIncs, 1)
	assert.Equal(t, int64(47500), repo.taxIncs[0].cents)
}

func TestMarketplaceStateMachine_confirm_pickup_rejects_non_buyer(t *testing.T) {
	t.Parallel()
	svc, repo, _ := newMarketplaceFixture()

	o := newOrder("ord-3", "held", 50000, 2500)
	o.PaymentIntentID = "pi_x"
	repo.addOrder(o)

	_, err := svc.ConfirmPickup(context.Background(), o.ID, "someone-else", "buyer")
	assert.ErrorIs(t, err, ErrNotBuyer)

	// Admin can override.
	_, err = svc.ConfirmPickup(context.Background(), o.ID, "admin-1", "admin")
	require.NoError(t, err)
}

func TestMarketplaceStateMachine_confirm_pickup_rejects_when_not_held(t *testing.T) {
	t.Parallel()
	svc, repo, _ := newMarketplaceFixture()

	o := newOrder("ord-4", "released", 50000, 2500)
	repo.addOrder(o)

	_, err := svc.ConfirmPickup(context.Background(), o.ID, o.BuyerID, "buyer")
	assert.ErrorIs(t, err, ErrInvalidEscrowState)
}

func TestMarketplaceStateMachine_held_to_disputed(t *testing.T) {
	t.Parallel()
	svc, repo, notifier := newMarketplaceFixture()

	o := newOrder("ord-5", "held", 50000, 2500)
	o.PaymentIntentID = "pi_disp"
	repo.addOrder(o)

	d, err := svc.FileListingDispute(context.Background(), o.ID, o.BuyerID, "item_damaged", "Item arrived broken")
	require.NoError(t, err)
	assert.Equal(t, "open", d.Status)

	got, _ := repo.GetListingOrder(context.Background(), o.ID)
	assert.Equal(t, "disputed", got.EscrowStatus)
	require.NotNil(t, got.DisputeID)
	assert.Equal(t, d.ID, *got.DisputeID)

	require.Len(t, notifier.events, 1)
	assert.Contains(t, notifier.events[0], "dispute_filed:")
}

func TestMarketplaceStateMachine_dispute_double_open_rejected(t *testing.T) {
	t.Parallel()
	svc, repo, _ := newMarketplaceFixture()

	o := newOrder("ord-6", "held", 50000, 2500)
	o.PaymentIntentID = "pi_d2"
	repo.addOrder(o)

	_, err := svc.FileListingDispute(context.Background(), o.ID, o.BuyerID, "item_damaged", "x")
	require.NoError(t, err)
	_, err = svc.FileListingDispute(context.Background(), o.ID, o.BuyerID, "item_damaged", "y")
	assert.ErrorIs(t, err, ErrDisputeAlreadyOpen)
}

func TestMarketplaceStateMachine_dispute_after_pickup_within_window(t *testing.T) {
	t.Parallel()
	svc, repo, _ := newMarketplaceFixture()

	pickup := time.Now().Add(-1 * time.Hour) // within 24h window
	o := newOrder("ord-7", "pickup_confirmed", 50000, 2500)
	o.PickupConfirmedAt = &pickup
	o.PaymentIntentID = "pi_pickup"
	repo.addOrder(o)

	_, err := svc.FileListingDispute(context.Background(), o.ID, o.BuyerID, "item_not_as_described", "different from listing")
	require.NoError(t, err)
}

func TestMarketplaceStateMachine_dispute_after_pickup_outside_window_rejected(t *testing.T) {
	t.Parallel()
	svc, repo, _ := newMarketplaceFixture()

	pickup := time.Now().Add(-25 * time.Hour) // past 24h window
	o := newOrder("ord-8", "pickup_confirmed", 50000, 2500)
	o.PickupConfirmedAt = &pickup
	repo.addOrder(o)

	_, err := svc.FileListingDispute(context.Background(), o.ID, o.BuyerID, "item_damaged", "too late")
	assert.ErrorIs(t, err, ErrDisputeWindowClosed)
}

// ====== Dispute resolution tests ======

func TestMarketplaceStateMachine_resolve_refund_full(t *testing.T) {
	t.Parallel()
	svc, repo, _ := newMarketplaceFixture()

	o := newOrder("ord-r1", "disputed", 50000, 2500)
	o.TaxCents = 3625
	o.PaymentIntentID = "pi_r1"
	disputeID := "disp-r1"
	o.DisputeID = &disputeID
	repo.addOrder(o)
	repo.disputes[disputeID] = &MarketplaceDispute{
		ID: disputeID, ListingOrderID: o.ID, OpenedBy: o.BuyerID,
		Reason: "item_damaged", Description: "x", Status: "open",
	}

	resolved, err := svc.ResolveListingDispute(context.Background(), disputeID, "admin-1", "refund_full", "admin notes", 0)
	require.NoError(t, err)
	assert.Equal(t, "refund_full", resolved.Resolution)
	assert.Equal(t, int64(50000+2500+3625), resolved.RefundToBuyerCents)
	assert.Equal(t, int64(0), resolved.TransferToSellerCents)

	got, _ := repo.GetListingOrder(context.Background(), o.ID)
	assert.Equal(t, "refunded", got.EscrowStatus)
}

func TestMarketplaceStateMachine_resolve_refund_partial(t *testing.T) {
	t.Parallel()
	svc, repo, _ := newMarketplaceFixture()

	// $500 sale, 5% fee = $25 fee, no tax (zip outside our table).
	o := newOrder("ord-r2", "disputed", 50000, 2500)
	o.TaxCents = 0
	o.PaymentIntentID = "pi_r2"
	disputeID := "disp-r2"
	o.DisputeID = &disputeID
	repo.addOrder(o)
	repo.disputes[disputeID] = &MarketplaceDispute{
		ID: disputeID, ListingOrderID: o.ID, OpenedBy: o.BuyerID,
		Reason: "item_not_as_described", Description: "x", Status: "open",
	}

	// Refund $100 (= 10000 cents) to buyer.
	// Net = refund - tax - fee = 10000 - 0 - 2500 = 7500
	// Seller payout = (50000 - 2500) - 7500 = 40000
	resolved, err := svc.ResolveListingDispute(context.Background(), disputeID, "admin-1", "refund_partial", "split", 10000)
	require.NoError(t, err)
	assert.Equal(t, int64(10000), resolved.RefundToBuyerCents)
	assert.Equal(t, int64(40000), resolved.TransferToSellerCents)

	got, _ := repo.GetListingOrder(context.Background(), o.ID)
	assert.Equal(t, "partially_refunded", got.EscrowStatus)
}

func TestMarketplaceStateMachine_resolve_release_to_seller(t *testing.T) {
	t.Parallel()
	svc, repo, _ := newMarketplaceFixture()

	o := newOrder("ord-r3", "disputed", 50000, 2500)
	o.PaymentIntentID = "pi_r3"
	disputeID := "disp-r3"
	o.DisputeID = &disputeID
	repo.addOrder(o)
	repo.disputes[disputeID] = &MarketplaceDispute{
		ID: disputeID, ListingOrderID: o.ID, OpenedBy: o.BuyerID,
		Reason: "no_show", Description: "buyer no-showed", Status: "open",
	}

	resolved, err := svc.ResolveListingDispute(context.Background(), disputeID, "admin-1", "release_to_seller", "admin sided with seller", 0)
	require.NoError(t, err)
	assert.Equal(t, int64(0), resolved.RefundToBuyerCents)
	assert.Equal(t, int64(47500), resolved.TransferToSellerCents)

	got, _ := repo.GetListingOrder(context.Background(), o.ID)
	assert.Equal(t, "released", got.EscrowStatus)
}

func TestMarketplaceStateMachine_resolve_invalid_refund_amount(t *testing.T) {
	t.Parallel()
	svc, repo, _ := newMarketplaceFixture()

	o := newOrder("ord-r4", "disputed", 50000, 2500)
	o.PaymentIntentID = "pi_r4"
	disputeID := "disp-r4"
	o.DisputeID = &disputeID
	repo.addOrder(o)
	repo.disputes[disputeID] = &MarketplaceDispute{
		ID: disputeID, ListingOrderID: o.ID, OpenedBy: o.BuyerID,
		Reason: "x", Description: "y", Status: "open",
	}

	// Refund > total charged is rejected.
	_, err := svc.ResolveListingDispute(context.Background(), disputeID, "admin-1", "refund_partial", "", 999999999)
	require.Error(t, err)
}

// ====== Auto-release tests ======

func TestAutoRelease_only_releases_orders_past_window(t *testing.T) {
	t.Parallel()
	svc, repo, notifier := newMarketplaceFixture()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	svc.SetClock(func() time.Time { return now })

	// Within window — should NOT release.
	young := newOrder("young", "held", 50000, 2500)
	young.PaymentIntentID = "pi_young"
	young.CreatedAt = now.Add(-13 * 24 * time.Hour)

	// Past window — SHOULD release.
	ripe := newOrder("ripe", "held", 50000, 2500)
	ripe.PaymentIntentID = "pi_ripe"
	ripe.CreatedAt = now.Add(-15 * 24 * time.Hour)

	// Past window but disputed — should NOT release.
	disp := newOrder("disp", "held", 50000, 2500)
	disp.PaymentIntentID = "pi_disp"
	disp.CreatedAt = now.Add(-20 * 24 * time.Hour)
	dID := "open-dispute"
	disp.DisputeID = &dID

	repo.addOrder(young)
	repo.addOrder(ripe)
	repo.addOrder(disp)

	count, err := svc.AutoReleaseListingOrders(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, count, "only ripe should be auto-released")

	got, _ := repo.GetListingOrder(context.Background(), "young")
	assert.Equal(t, "held", got.EscrowStatus)

	got, _ = repo.GetListingOrder(context.Background(), "ripe")
	assert.Equal(t, "released", got.EscrowStatus)
	assert.Equal(t, int64(47500), got.SellerPayoutCents)

	got, _ = repo.GetListingOrder(context.Background(), "disp")
	assert.Equal(t, "held", got.EscrowStatus)

	// Notifications fired only for the ripe order.
	require.Len(t, notifier.events, 2, "auto-release fires both buyer + seller notifications")
	assert.Contains(t, notifier.events[0], "auto_buyer:buyer-ripe:ripe")
	assert.Contains(t, notifier.events[1], "auto_seller:seller-ripe:ripe")
}

func TestAutoRelease_idempotent_second_run(t *testing.T) {
	t.Parallel()
	svc, repo, _ := newMarketplaceFixture()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	svc.SetClock(func() time.Time { return now })

	o := newOrder("o-x", "held", 10000, 500)
	o.PaymentIntentID = "pi_x"
	o.CreatedAt = now.Add(-15 * 24 * time.Hour)
	repo.addOrder(o)

	count, err := svc.AutoReleaseListingOrders(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Second run must be a no-op (status already 'released').
	count, err = svc.AutoReleaseListingOrders(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}

// ====== Charge re-entry idempotency ======

func TestChargeListingWinner_idempotent_reentry(t *testing.T) {
	t.Parallel()
	svc, repo, _ := newMarketplaceFixture()

	o := newOrder("ord-i1", "pending_payment", 10000, 500)
	o.PickupZipCode = "75201" // TX 6.25%
	repo.addOrder(o)

	res1, err := svc.ChargeListingWinner(context.Background(), o.ID)
	require.NoError(t, err)

	// Second call returns same PI (idempotent).
	res2, err := svc.ChargeListingWinner(context.Background(), o.ID)
	require.NoError(t, err)
	assert.Equal(t, res1.PaymentIntentID, res2.PaymentIntentID)
	assert.Equal(t, int64(625), res2.TaxCents) // 10000 * 0.0625
}

// ====== Full lifecycle: charged → confirmed → released ======

func TestFullLifecycle_winner_charged_pickup_confirmed_transfer_to_seller(t *testing.T) {
	t.Parallel()
	svc, repo, notifier := newMarketplaceFixture()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	svc.SetClock(func() time.Time { return now })

	o := newOrder("ord-full", "pending_payment", 50000, 2500)
	o.PickupZipCode = "94016" // CA
	repo.addOrder(o)

	// 1. Charge.
	res, err := svc.ChargeListingWinner(context.Background(), o.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(50000+2500+3625), res.TotalCents)

	// 2. Webhook → held.
	require.NoError(t, svc.HandleListingPaymentIntentSucceeded(context.Background(), res.PaymentIntentID))
	got, _ := repo.GetListingOrder(context.Background(), o.ID)
	assert.Equal(t, "held", got.EscrowStatus)

	// 3. Buyer confirms pickup.
	confirmed, err := svc.ConfirmPickup(context.Background(), o.ID, o.BuyerID, "buyer")
	require.NoError(t, err)
	assert.Equal(t, "released", confirmed.EscrowStatus)
	assert.Equal(t, int64(47500), confirmed.SellerPayoutCents)

	// 4. Notification fired.
	require.GreaterOrEqual(t, len(notifier.events), 1)
	assert.Contains(t, notifier.events[len(notifier.events)-1], "released:seller-ord-full")

	// 5. 1099-K recorded.
	require.Len(t, repo.taxIncs, 1)
	assert.Equal(t, int64(47500), repo.taxIncs[0].cents)
	assert.Equal(t, 2026, repo.taxIncs[0].year)
}
