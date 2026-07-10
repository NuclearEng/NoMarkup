package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Marketplace escrow lifecycle for goods.
//
// State machine:
//
//   pending_payment ──ChargeListingWinner──▶ pending_payment (PI created)
//                                                │ webhook payment_intent.succeeded
//                                                ▼
//                                              held
//             ┌──────────────────────────────────┼──────────────────────────────┐
//             │ ConfirmPickup (buyer)            │ FileListingDispute (buyer)   │ AutoReleaseListingOrders
//             ▼                                  ▼                              ▼
//      pickup_confirmed                       disputed             (after 14d, no dispute)
//             │ (transfer to seller)             │  ResolveListingDispute        │ (transfer to seller)
//             ▼                                  ▼                              ▼
//          released                refund_full / refund_partial /            released
//                                  release_to_seller / no_action
//                                       │ (refunds + transfers)
//                                       ▼
//                                refunded / partially_refunded / released
//
// Cents-precise rules:
//   Buyer charged total = bid_amount + tax + platform_fee
//   Seller payout       = bid_amount - platform_fee   (tax is platform-collected
//                                                     and remitted to states; not
//                                                     paid to seller)
//   Refund (full)       = full charged total back to buyer; seller gets nothing
//   Refund (partial)    = X cents to buyer, (charged - X) - platform_fee to seller
//
// Idempotency: every Stripe-mutating call uses a deterministic idempotency key
// derived from the listing_order_id + stage so retries are safe.
//
// Auto-release: a 14-day window from order creation (held -> released) gives
// the buyer time to confirm pickup or file a dispute. If neither happens,
// we assume pickup happened and release to seller. This mirrors the existing
// 7-day services flow but doubled because pickup logistics take longer.

// --- Sentinel errors ---

var (
	ErrListingOrderNotFound = errors.New("listing order not found")
	ErrInvalidEscrowState   = errors.New("invalid escrow state transition")
	ErrNotBuyer             = errors.New("user is not the buyer for this order")
	ErrDisputeWindowClosed  = errors.New("dispute window closed")
	ErrDisputeAlreadyOpen   = errors.New("dispute already open for this order")
)

// MarketplaceListingOrder is the in-memory representation of a row in
// listing_orders. It mirrors the schema from migrations 034 + 035.
type MarketplaceListingOrder struct {
	ID                string
	ListingID         string
	SellerID          string
	BuyerID           string
	AmountCents       int64 // bid amount (subtotal)
	FeeCents          int64 // platform fee
	TaxCents          int64 // sales tax (state-level)
	SellerPayoutCents int64 // amount transferred to seller on release
	EscrowStatus      string
	PaymentIntentID   string
	IdempotencyKey    string
	StripeTransferID  string // Stripe Connect transfer id once the seller is paid (empty = not yet paid out)
	PickupZipCode     string
	PickupConfirmedAt *time.Time
	ReleasedAt        *time.Time
	AutoReleaseAt     *time.Time
	DisputeID         *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// MarketplaceDispute is a row in marketplace_disputes.
type MarketplaceDispute struct {
	ID                     string
	ListingOrderID         string
	OpenedBy               string
	Reason                 string
	Description            string
	Status                 string // open, under_review, resolved, closed
	Resolution             string // refund_full, refund_partial, release_to_seller, no_action
	RefundToBuyerCents     int64
	TransferToSellerCents  int64
	ResolutionNotes        string
	ResolvedBy             *string
	ResolvedAt             *time.Time
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

// MarketplaceRepository abstracts persistence for the goods escrow flow.
// Kept separate from PaymentRepository so the existing services-side contract
// is not disturbed and so tests can mock at this surface alone.
type MarketplaceRepository interface {
	GetListingOrder(ctx context.Context, orderID string) (*MarketplaceListingOrder, error)
	GetListingOrderByPaymentIntent(ctx context.Context, piID string) (*MarketplaceListingOrder, error)
	UpdateListingOrderEscrowStatus(ctx context.Context, orderID, newStatus string, releasedAt *time.Time, pickupConfirmedAt *time.Time, sellerPayoutCents int64) error
	// UpdateListingOrderPaymentIntent stamps the PI id, idempotency key, tax,
	// fee, and auto-release deadline on the order.
	UpdateListingOrderPaymentIntent(ctx context.Context, orderID, paymentIntentID, idempotencyKey string, taxCents, feeCents int64, autoReleaseAt time.Time) error
	UpdateListingOrderDispute(ctx context.Context, orderID string, disputeID *string) error
	ListListingOrdersForAutoRelease(ctx context.Context, before time.Time, limit int) ([]*MarketplaceListingOrder, error)
	// ClaimListingOrderForRelease locks the order row (FOR UPDATE) and returns
	// it only when still eligible for payout (held/released, no dispute, no
	// transfer). Returns ErrInvalidEscrowState when another worker claimed it
	// or a dispute is open (MON-18).
	ClaimListingOrderForRelease(ctx context.Context, orderID string) (*MarketplaceListingOrder, error)
	// MarkListingOrderTransferred stamps the Stripe Connect transfer id on a
	// paid-out order. This is the durable "already paid" marker that lets the
	// auto-release worker reconcile handshake-released orders exactly once.
	MarkListingOrderTransferred(ctx context.Context, orderID, transferID string) error

	CreateMarketplaceDispute(ctx context.Context, d *MarketplaceDispute) error
	GetMarketplaceDispute(ctx context.Context, disputeID string) (*MarketplaceDispute, error)
	ResolveMarketplaceDispute(ctx context.Context, disputeID, resolution, notes, adminID string, refundCents, transferCents int64) (*MarketplaceDispute, error)

	IncrementSellerTaxForm(ctx context.Context, sellerID string, taxYear int, grossPaymentsCents int64) error
}

// ConnectAccountResolver resolves a platform user id to their Stripe Connect
// account id (acct_...). Injected into MarketplaceService so goods transfers
// never send a bare user UUID as Destination (MON-08).
type ConnectAccountResolver interface {
	GetStripeAccountID(ctx context.Context, userID string) (string, error)
}

// MarketplaceNotifier sends notifications to the buyer/seller. The concrete
// implementation talks to the notification service; tests substitute a fake.
type MarketplaceNotifier interface {
	NotifyPaymentReleased(ctx context.Context, sellerID, orderID string, amountCents int64) error
	NotifyAutoReleaseToBuyer(ctx context.Context, buyerID, orderID string) error
	NotifyAutoReleaseToSeller(ctx context.Context, sellerID, orderID string, amountCents int64) error
	NotifyDisputeFiled(ctx context.Context, sellerID, orderID, disputeID string) error
	NotifyDisputeResolved(ctx context.Context, userID, orderID, disputeID, resolution string) error
}

// noopMarketplaceNotifier is the default if no notifier is wired.
type noopMarketplaceNotifier struct{}

func (noopMarketplaceNotifier) NotifyPaymentReleased(_ context.Context, _, _ string, _ int64) error {
	return nil
}
func (noopMarketplaceNotifier) NotifyAutoReleaseToBuyer(_ context.Context, _, _ string) error {
	return nil
}
func (noopMarketplaceNotifier) NotifyAutoReleaseToSeller(_ context.Context, _, _ string, _ int64) error {
	return nil
}
func (noopMarketplaceNotifier) NotifyDisputeFiled(_ context.Context, _, _, _ string) error {
	return nil
}
func (noopMarketplaceNotifier) NotifyDisputeResolved(_ context.Context, _, _, _, _ string) error {
	return nil
}

// MarketplaceConfig tunes the goods escrow behavior.
type MarketplaceConfig struct {
	AutoReleaseAfter      time.Duration // default 14d
	DisputeWindowAfter    time.Duration // dispute allowed up to: pickup_confirmed_at + this duration (default 24h)
	// MarketplaceFeePercent is the combined seller-side take (platform + guarantee).
	// MON-20: aligned with services 8% + 2% = 10% (0.10). Single fee_cents column.
	MarketplaceFeePercent float64
}

// DefaultMarketplaceConfig returns the v1 defaults.
func DefaultMarketplaceConfig() MarketplaceConfig {
	return MarketplaceConfig{
		AutoReleaseAfter:      14 * 24 * time.Hour,
		DisputeWindowAfter:    24 * time.Hour,
		MarketplaceFeePercent: 0.10, // 8% platform + 2% guarantee (MON-20)
	}
}

// MarketplaceService implements the goods escrow + pickup + release flow.
// It does NOT live on PaymentService; instead it composes the existing Stripe
// service (for charges, transfers, refunds) and a dedicated marketplace
// repository. The webhook handler in PaymentService delegates to this service
// when a payment_intent.succeeded event arrives that's tied to a listing
// order via metadata.
type MarketplaceService struct {
	repo     MarketplaceRepository
	stripe   *StripeService
	accounts ConnectAccountResolver
	notifier MarketplaceNotifier
	cfg      MarketplaceConfig
	now      func() time.Time // injectable for tests
}

// NewMarketplaceService constructs a service with sane defaults.
func NewMarketplaceService(repo MarketplaceRepository, stripe *StripeService) *MarketplaceService {
	return &MarketplaceService{
		repo:     repo,
		stripe:   stripe,
		notifier: noopMarketplaceNotifier{},
		cfg:      DefaultMarketplaceConfig(),
		now:      time.Now,
	}
}

// SetAccountResolver injects the Connect account lookup used before seller
// transfers. Production wires PaymentService/repo.GetStripeAccountID.
func (s *MarketplaceService) SetAccountResolver(r ConnectAccountResolver) {
	s.accounts = r
}

// SetNotifier injects a MarketplaceNotifier (production wires the real
// notification client; tests inject a fake to assert sends).
func (s *MarketplaceService) SetNotifier(n MarketplaceNotifier) {
	if n != nil {
		s.notifier = n
	}
}

// SetConfig overrides the defaults (used by tests + admin tooling).
func (s *MarketplaceService) SetConfig(cfg MarketplaceConfig) {
	if cfg.AutoReleaseAfter > 0 {
		s.cfg.AutoReleaseAfter = cfg.AutoReleaseAfter
	}
	if cfg.DisputeWindowAfter > 0 {
		s.cfg.DisputeWindowAfter = cfg.DisputeWindowAfter
	}
	if cfg.MarketplaceFeePercent > 0 {
		s.cfg.MarketplaceFeePercent = cfg.MarketplaceFeePercent
	}
}

// SetClock injects a deterministic clock for tests.
func (s *MarketplaceService) SetClock(now func() time.Time) {
	if now != nil {
		s.now = now
	}
}

// --- Charge flow ---

// ChargeListingResult carries the data returned to callers after charging.
type ChargeListingResult struct {
	OrderID         string
	PaymentIntentID string
	ClientSecret    string
	AmountCents     int64
	FeeCents        int64
	TaxCents        int64
	TotalCents      int64
}

// ChargeListingWinner is invoked when an auction closes. It computes the
// platform fee and sales tax, creates a Stripe PaymentIntent (manual capture
// — funds are held in escrow), and persists the PI on the order. The order
// is created upstream by the marketplace service when the auction closes;
// this function expects a pre-existing row in `pending_payment` status.
//
// Idempotency: the idempotency key is `listing-charge:<orderID>`. Re-calls
// with the same order in pending_payment state return the existing PI rather
// than creating a duplicate.
func (s *MarketplaceService) ChargeListingWinner(ctx context.Context, orderID string) (*ChargeListingResult, error) {
	order, err := s.repo.GetListingOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}

	// Idempotent re-entry: if the order already has a PI, return it.
	if order.PaymentIntentID != "" && (order.EscrowStatus == "pending_payment" || order.EscrowStatus == "held") {
		slog.Info("charge listing winner: existing payment intent",
			"order_id", orderID,
			"pi_id", order.PaymentIntentID,
			"status", order.EscrowStatus,
		)
		return &ChargeListingResult{
			OrderID:         order.ID,
			PaymentIntentID: order.PaymentIntentID,
			AmountCents:     order.AmountCents,
			FeeCents:        order.FeeCents,
			TaxCents:        order.TaxCents,
			TotalCents:      order.AmountCents + order.FeeCents + order.TaxCents,
		}, nil
	}

	if order.EscrowStatus != "pending_payment" {
		return nil, fmt.Errorf("charge listing winner: order in status %q: %w", order.EscrowStatus, ErrInvalidEscrowState)
	}

	// Compute fee + tax. The fee may already be on the order (if marketplace
	// service computed it), but recompute here as the source of truth.
	feeCents := int64(float64(order.AmountCents) * s.cfg.MarketplaceFeePercent)
	if feeCents < 0 {
		feeCents = 0
	}
	taxState, taxCents := ComputeTaxCentsForZip(order.AmountCents, order.PickupZipCode)
	totalCents := order.AmountCents + feeCents + taxCents

	// Idempotency key: deterministic per order + stage so retries dedupe.
	idemKey := fmt.Sprintf("listing-charge:%s", order.ID)

	// Funds are held in the platform Stripe account (no destination charge).
	// The seller is paid via a separate transfer when escrow releases.
	piID, clientSecret, err := s.stripe.CreateMarketplacePaymentIntent(
		ctx,
		totalCents,
		"usd",
		idemKey,
		map[string]string{
			"listing_order_id":   order.ID,
			"listing_id":         order.ListingID,
			"seller_id":          order.SellerID,
			"buyer_id":           order.BuyerID,
			"marketplace_flow":   "goods-v1",
			"tax_state":          taxState,
			"tax_cents":          fmt.Sprintf("%d", taxCents),
			"platform_fee_cents": fmt.Sprintf("%d", feeCents),
		},
	)
	if err != nil {
		return nil, fmt.Errorf("charge listing winner: create payment intent: %w", err)
	}

	autoReleaseAt := s.now().Add(s.cfg.AutoReleaseAfter)
	// Persist fee_cents alongside tax so release/refund math uses the same
	// fee that was charged (MON-05/20).
	if err := s.repo.UpdateListingOrderPaymentIntent(ctx, order.ID, piID, idemKey, taxCents, feeCents, autoReleaseAt); err != nil {
		return nil, fmt.Errorf("charge listing winner: update order: %w", err)
	}

	slog.Info("charged listing winner",
		"order_id", order.ID,
		"pi_id", piID,
		"amount_cents", order.AmountCents,
		"fee_cents", feeCents,
		"tax_cents", taxCents,
		"total_cents", totalCents,
		"auto_release_at", autoReleaseAt.Format(time.RFC3339),
	)

	return &ChargeListingResult{
		OrderID:         order.ID,
		PaymentIntentID: piID,
		ClientSecret:    clientSecret,
		AmountCents:     order.AmountCents,
		FeeCents:        feeCents,
		TaxCents:        taxCents,
		TotalCents:      totalCents,
	}, nil
}

// HandleListingPaymentIntentSucceeded transitions the order from
// pending_payment -> held when Stripe confirms the charge captured. Called
// from the central payment_intent.succeeded webhook handler when the PI
// metadata identifies a marketplace flow.
func (s *MarketplaceService) HandleListingPaymentIntentSucceeded(ctx context.Context, paymentIntentID string) error {
	order, err := s.repo.GetListingOrderByPaymentIntent(ctx, paymentIntentID)
	if err != nil {
		// Not a marketplace order — caller decides whether that's an error.
		return err
	}

	if order.EscrowStatus == "held" {
		// Idempotent: already moved to held.
		return nil
	}
	if order.EscrowStatus != "pending_payment" {
		return fmt.Errorf("listing pi succeeded: order %s in unexpected status %q: %w",
			order.ID, order.EscrowStatus, ErrInvalidEscrowState)
	}

	if err := s.repo.UpdateListingOrderEscrowStatus(ctx, order.ID, "held", nil, nil, 0); err != nil {
		return fmt.Errorf("listing pi succeeded: update status: %w", err)
	}
	slog.Info("listing order moved to held",
		"order_id", order.ID,
		"pi_id", paymentIntentID,
	)
	return nil
}

// --- Pickup confirmation flow ---

// ConfirmPickup is called by the buyer (or admin) to confirm pickup occurred.
// It transitions held -> pickup_confirmed -> released atomically and triggers
// the seller transfer.
//
// `actorRole` is "buyer" or "admin". A non-buyer non-admin caller is rejected.
func (s *MarketplaceService) ConfirmPickup(ctx context.Context, orderID, actorUserID, actorRole string) (*MarketplaceListingOrder, error) {
	order, err := s.repo.GetListingOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}

	// Authorization: buyer or admin only.
	if actorRole != "admin" && order.BuyerID != actorUserID {
		return nil, ErrNotBuyer
	}

	if order.EscrowStatus != "held" {
		return nil, fmt.Errorf("confirm pickup: order in status %q: %w", order.EscrowStatus, ErrInvalidEscrowState)
	}
	if order.DisputeID != nil && *order.DisputeID != "" {
		return nil, fmt.Errorf("confirm pickup: order has open dispute: %w", ErrInvalidEscrowState)
	}

	now := s.now()
	if err := s.releaseToSeller(ctx, order, &now); err != nil {
		return nil, fmt.Errorf("confirm pickup: %w", err)
	}

	if err := s.notifier.NotifyPaymentReleased(ctx, order.SellerID, order.ID, order.AmountCents-order.FeeCents); err != nil {
		slog.Warn("failed to notify seller of payment release",
			"order_id", order.ID,
			"seller_id", order.SellerID,
			"error", err,
		)
	}

	updated, err := s.repo.GetListingOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}
	return updated, nil
}

// resolveSellerConnectAccount returns the Stripe Connect acct_* for the seller.
// Never returns a bare user UUID in production (MON-08).
func (s *MarketplaceService) resolveSellerConnectAccount(ctx context.Context, sellerID string) (string, error) {
	if s.accounts != nil {
		acct, err := s.accounts.GetStripeAccountID(ctx, sellerID)
		if err != nil {
			return "", fmt.Errorf("resolve seller connect account: %w", err)
		}
		if acct == "" || (!s.stripe.IsDevMode() && !strings.HasPrefix(acct, "acct_")) {
			return "", fmt.Errorf("resolve seller connect account: invalid account id for seller %s", sellerID)
		}
		return acct, nil
	}
	// Dev / tests without a resolver: allow seller id only in dev mode.
	if s.stripe.IsDevMode() {
		return sellerID, nil
	}
	return "", fmt.Errorf("resolve seller connect account: no account resolver configured")
}

// releaseToSeller is the shared "transfer + flip status" code used by
// ConfirmPickup AND AutoReleaseListingOrders. Computes seller payout =
// amount - fee (tax stays with platform), creates the Stripe transfer, and
// updates the order to released. Also stamps the seller_tax_forms 1099-K
// running total.
func (s *MarketplaceService) releaseToSeller(ctx context.Context, order *MarketplaceListingOrder, pickupConfirmedAt *time.Time) error {
	// Double-pay guard: if this order already carries a transfer id, the seller
	// was already paid (e.g. a prior handshake-release or auto-release). Never
	// fire a second transfer. The deterministic Stripe idempotency key below is
	// the second line of defense; this is the first.
	if order.StripeTransferID != "" {
		slog.Info("release to seller: order already paid out, skipping",
			"order_id", order.ID,
			"transfer_id", order.StripeTransferID,
		)
		return nil
	}
	// Skip if disputed (defense in depth; AutoRelease also claims with lock).
	if order.DisputeID != nil && *order.DisputeID != "" {
		return fmt.Errorf("release to seller: order disputed: %w", ErrInvalidEscrowState)
	}

	sellerPayout := order.AmountCents - order.FeeCents
	if sellerPayout < 0 {
		sellerPayout = 0
	}

	// MON-08: resolve seller UUID → Stripe Connect acct_* before transfer.
	dest, err := s.resolveSellerConnectAccount(ctx, order.SellerID)
	if err != nil {
		return fmt.Errorf("release to seller: %w", err)
	}

	transferIdemKey := fmt.Sprintf("listing-release:%s", order.ID)
	transferID, err := s.stripe.CreateMarketplaceTransfer(
		ctx,
		sellerPayout,
		"usd",
		dest,
		order.PaymentIntentID,
		transferIdemKey,
	)
	if err != nil {
		return fmt.Errorf("release to seller transfer: %w", err)
	}

	now := s.now()
	// Move the order to 'released' and stamp the payout amount + timestamps.
	// For a handshake-released order (already 'released' before the worker ran)
	// this is a harmless re-stamp of the same status; the important side effect
	// is recording the transfer id below so the order is never paid twice.
	if err := s.repo.UpdateListingOrderEscrowStatus(ctx, order.ID, "released", &now, pickupConfirmedAt, sellerPayout); err != nil {
		return fmt.Errorf("release to seller update status: %w", err)
	}

	// Record the Stripe transfer id — the durable "already paid" marker the
	// worker query filters on (stripe_transfer_id IS NULL). MUST happen so a
	// retry/second release never double-pays.
	if err := s.repo.MarkListingOrderTransferred(ctx, order.ID, transferID); err != nil {
		return fmt.Errorf("release to seller record transfer: %w", err)
	}

	// 1099-K accumulation. Errors here MUST NOT fail the release.
	if err := s.repo.IncrementSellerTaxForm(ctx, order.SellerID, now.UTC().Year(), sellerPayout); err != nil {
		slog.Warn("failed to increment seller tax form running total",
			"seller_id", order.SellerID,
			"order_id", order.ID,
			"error", err,
		)
	}

	slog.Info("listing order released to seller",
		"order_id", order.ID,
		"seller_id", order.SellerID,
		"amount_cents", order.AmountCents,
		"fee_cents", order.FeeCents,
		"seller_payout_cents", sellerPayout,
	)
	return nil
}

// --- Dispute flow ---

// FileListingDispute lets a buyer dispute a listing order. Allowed in:
//   - status=held (any time before auto-release)
//   - status=pickup_confirmed AND within DisputeWindowAfter from pickup
func (s *MarketplaceService) FileListingDispute(ctx context.Context, orderID, buyerID, reason, description string) (*MarketplaceDispute, error) {
	order, err := s.repo.GetListingOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}

	if order.BuyerID != buyerID {
		return nil, ErrNotBuyer
	}
	if order.DisputeID != nil && *order.DisputeID != "" {
		return nil, ErrDisputeAlreadyOpen
	}

	now := s.now()
	switch order.EscrowStatus {
	case "held":
		// allowed
	case "pickup_confirmed":
		if order.PickupConfirmedAt == nil || now.Sub(*order.PickupConfirmedAt) > s.cfg.DisputeWindowAfter {
			return nil, ErrDisputeWindowClosed
		}
	default:
		return nil, fmt.Errorf("file dispute: order in status %q: %w", order.EscrowStatus, ErrInvalidEscrowState)
	}

	dispute := &MarketplaceDispute{
		ID:             uuid.New().String(),
		ListingOrderID: order.ID,
		OpenedBy:       buyerID,
		Reason:         reason,
		Description:    description,
		Status:         "open",
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.repo.CreateMarketplaceDispute(ctx, dispute); err != nil {
		return nil, fmt.Errorf("file dispute: create: %w", err)
	}

	// Freeze escrow.
	disputeID := dispute.ID
	if err := s.repo.UpdateListingOrderEscrowStatus(ctx, order.ID, "disputed", nil, nil, 0); err != nil {
		return nil, fmt.Errorf("file dispute: freeze escrow: %w", err)
	}
	if err := s.repo.UpdateListingOrderDispute(ctx, order.ID, &disputeID); err != nil {
		return nil, fmt.Errorf("file dispute: link dispute id: %w", err)
	}

	if err := s.notifier.NotifyDisputeFiled(ctx, order.SellerID, order.ID, dispute.ID); err != nil {
		slog.Warn("failed to notify seller of dispute",
			"order_id", order.ID, "dispute_id", dispute.ID, "error", err)
	}
	slog.Info("listing dispute filed",
		"order_id", order.ID, "dispute_id", dispute.ID, "reason", reason,
	)
	return dispute, nil
}

// ResolveListingDispute is the admin path. Resolution is one of:
//   - "refund_full": full charged total goes back to buyer; seller gets nothing
//   - "refund_partial": refundCents to buyer, the remaining (amount - fee) - (refundCents - tax) to seller (cents-precise)
//   - "release_to_seller": no refund; seller gets full payout
//   - "no_action": close dispute, leave order in disputed (admin will revisit)
//
// For refund_partial the caller passes refundToBuyerCents explicitly. The
// seller portion is computed as: max(0, amount_cents - fee_cents - refundToBuyerCents_minus_tax_portion).
// To keep it predictable, we treat refundToBuyerCents as cents off the bid
// amount only (tax is always platform-side). Seller transfer = max(0, amount - fee - refundToBuyerCents).
func (s *MarketplaceService) ResolveListingDispute(
	ctx context.Context,
	disputeID, adminID, resolution, notes string,
	refundToBuyerCents int64,
) (*MarketplaceDispute, error) {
	dispute, err := s.repo.GetMarketplaceDispute(ctx, disputeID)
	if err != nil {
		return nil, err
	}
	if dispute.Status == "resolved" || dispute.Status == "closed" {
		return nil, fmt.Errorf("resolve dispute: already resolved")
	}

	order, err := s.repo.GetListingOrder(ctx, dispute.ListingOrderID)
	if err != nil {
		return nil, err
	}

	var (
		transferToSellerCents int64
		newOrderStatus        string
	)

	switch resolution {
	case "refund_full":
		refundToBuyerCents = order.AmountCents + order.TaxCents + order.FeeCents
		transferToSellerCents = 0
		newOrderStatus = "refunded"
	case "refund_partial":
		if refundToBuyerCents < 0 || refundToBuyerCents > order.AmountCents+order.TaxCents+order.FeeCents {
			return nil, fmt.Errorf("resolve dispute: refund_to_buyer out of range")
		}
		// Seller still gets the unrefunded portion of the bid amount minus fee.
		// Tax is platform-collected and not paid out; we treat refund as
		// coming first from tax + fee + amount in that order.
		// For simplicity v1: seller payout = max(0, (amount - fee) - max(0, refund - tax - fee))
		net := refundToBuyerCents - order.TaxCents - order.FeeCents
		if net < 0 {
			net = 0
		}
		transferToSellerCents = (order.AmountCents - order.FeeCents) - net
		if transferToSellerCents < 0 {
			transferToSellerCents = 0
		}
		newOrderStatus = "partially_refunded"
	case "release_to_seller":
		refundToBuyerCents = 0
		transferToSellerCents = order.AmountCents - order.FeeCents
		if transferToSellerCents < 0 {
			transferToSellerCents = 0
		}
		newOrderStatus = "released"
	case "no_action":
		// Close dispute, leave order in disputed.
		refundToBuyerCents = 0
		transferToSellerCents = 0
		newOrderStatus = "" // unchanged
	default:
		return nil, fmt.Errorf("resolve dispute: unknown resolution %q", resolution)
	}

	// Side effects: refund + transfer.
	if refundToBuyerCents > 0 {
		refundIdem := fmt.Sprintf("listing-refund:%s:%s", order.ID, disputeID)
		if _, err := s.stripe.CreateMarketplaceRefund(ctx, order.PaymentIntentID, refundToBuyerCents, refundIdem); err != nil {
			return nil, fmt.Errorf("resolve dispute: refund: %w", err)
		}
	}
	var transferID string
	if transferToSellerCents > 0 {
		// Skip if already paid (double-pay guard, same path as release).
		if order.StripeTransferID != "" {
			transferID = order.StripeTransferID
		} else {
			dest, err := s.resolveSellerConnectAccount(ctx, order.SellerID)
			if err != nil {
				return nil, fmt.Errorf("resolve dispute: %w", err)
			}
			// Same key family as release so a race with auto-release dedupes.
			transferIdem := fmt.Sprintf("listing-release:%s", order.ID)
			transferID, err = s.stripe.CreateMarketplaceTransfer(ctx, transferToSellerCents, "usd", dest, order.PaymentIntentID, transferIdem)
			if err != nil {
				return nil, fmt.Errorf("resolve dispute: transfer: %w", err)
			}
		}
	}

	resolved, err := s.repo.ResolveMarketplaceDispute(ctx, disputeID, resolution, notes, adminID, refundToBuyerCents, transferToSellerCents)
	if err != nil {
		return nil, fmt.Errorf("resolve dispute: persist: %w", err)
	}

	if newOrderStatus != "" {
		now := s.now()
		if err := s.repo.UpdateListingOrderEscrowStatus(ctx, order.ID, newOrderStatus, &now, nil, transferToSellerCents); err != nil {
			return nil, fmt.Errorf("resolve dispute: update order status: %w", err)
		}
	}

	// MON-17: stamp stripe_transfer_id via the same path as release.
	if transferID != "" {
		if err := s.repo.MarkListingOrderTransferred(ctx, order.ID, transferID); err != nil {
			return nil, fmt.Errorf("resolve dispute: stamp transfer: %w", err)
		}
	}

	// Accumulate 1099-K only if the seller was actually paid.
	if transferToSellerCents > 0 {
		if err := s.repo.IncrementSellerTaxForm(ctx, order.SellerID, s.now().UTC().Year(), transferToSellerCents); err != nil {
			slog.Warn("failed to increment seller tax form on dispute resolution",
				"seller_id", order.SellerID, "order_id", order.ID, "error", err)
		}
	}

	if err := s.notifier.NotifyDisputeResolved(ctx, order.BuyerID, order.ID, disputeID, resolution); err != nil {
		slog.Warn("failed to notify buyer of dispute resolution",
			"order_id", order.ID, "dispute_id", disputeID, "error", err)
	}
	if err := s.notifier.NotifyDisputeResolved(ctx, order.SellerID, order.ID, disputeID, resolution); err != nil {
		slog.Warn("failed to notify seller of dispute resolution",
			"order_id", order.ID, "dispute_id", disputeID, "error", err)
	}

	slog.Info("listing dispute resolved",
		"dispute_id", disputeID,
		"order_id", order.ID,
		"resolution", resolution,
		"refund_to_buyer_cents", refundToBuyerCents,
		"transfer_to_seller_cents", transferToSellerCents,
		"admin_id", adminID,
	)
	return resolved, nil
}

// --- Auto-release cron ---

// AutoReleaseListingOrders is invoked by a 4h cron. It finds listing orders
// in `held` status with no open dispute that are older than the auto-release
// window and transitions them to released, transferring funds to the seller.
//
// Returns the number of orders successfully released.
func (s *MarketplaceService) AutoReleaseListingOrders(ctx context.Context, batchLimit int) (int, error) {
	if batchLimit <= 0 {
		batchLimit = 100
	}
	threshold := s.now().Add(-s.cfg.AutoReleaseAfter)
	orders, err := s.repo.ListListingOrdersForAutoRelease(ctx, threshold, batchLimit)
	if err != nil {
		return 0, fmt.Errorf("auto release: list: %w", err)
	}

	released := 0
	for _, o := range orders {
		// MON-18: lock the order row before acting so a concurrent dispute
		// file cannot race the auto-release transfer.
		claimed, err := s.repo.ClaimListingOrderForRelease(ctx, o.ID)
		if err != nil {
			if errors.Is(err, ErrInvalidEscrowState) {
				slog.Info("auto release: order no longer eligible, skipping",
					"order_id", o.ID, "error", err)
				continue
			}
			slog.Error("auto release: claim failed, continuing",
				"order_id", o.ID, "error", err)
			continue
		}
		if err := s.releaseToSeller(ctx, claimed, nil); err != nil {
			slog.Error("auto release: failed for order, continuing",
				"order_id", o.ID,
				"error", err,
			)
			continue
		}
		if err := s.notifier.NotifyAutoReleaseToBuyer(ctx, o.BuyerID, o.ID); err != nil {
			slog.Warn("auto release: notify buyer failed",
				"order_id", o.ID, "buyer_id", o.BuyerID, "error", err)
		}
		if err := s.notifier.NotifyAutoReleaseToSeller(ctx, o.SellerID, o.ID, o.AmountCents-o.FeeCents); err != nil {
			slog.Warn("auto release: notify seller failed",
				"order_id", o.ID, "seller_id", o.SellerID, "error", err)
		}
		released++
	}

	if released > 0 {
		slog.Info("auto-released listing orders",
			"count", released,
			"threshold_cutoff", threshold.Format(time.RFC3339),
		)
	}
	return released, nil
}
