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

// PendingListingOrder is the narrow projection the settlement sweeper reads.
// It carries only what deciding "charge it / expire it / leave it" needs, so
// adding the migration-101 payment columns did not have to touch the three
// full-row SELECTs that the escrow/dispute/release paths depend on.
type PendingListingOrder struct {
	ID              string
	ListingID       string
	SellerID        string
	BuyerID         string
	AmountCents     int64
	PaymentIntentID string
	PaymentAttempts int
	// PaymentDueAt is nil until the first settlement pass stamps it. A nil
	// deadline is treated as CreatedAt + PaymentWindow so orders written before
	// migration 101 are still swept rather than living forever.
	PaymentDueAt *time.Time
	CreatedAt    time.Time
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
	// ListListingOrdersAwaitingPayment returns orders still in
	// escrow_status='pending_payment', oldest first, bounded by limit. This is
	// the settlement sweeper's input set: orders whose buyer has not funded
	// escrow. Deliberately a narrow projection rather than a full
	// MarketplaceListingOrder — the sweeper needs only identity, the PI (or its
	// absence) and the payment clock.
	ListListingOrdersAwaitingPayment(ctx context.Context, limit int) ([]*PendingListingOrder, error)
	// RecordListingPaymentAttempt increments payment_attempts and stamps
	// last_payment_error (empty string clears it). paymentDueAt is written only
	// when non-nil, so a retry never extends a deadline that is already running.
	RecordListingPaymentAttempt(ctx context.Context, orderID string, paymentDueAt *time.Time, lastErr string) error
	// FailListingOrderPayment moves an unfunded order from 'pending_payment' to
	// the terminal 'payment_failed' (migration 101). The status guard is in the
	// UPDATE itself, so an order that funded in the meantime is never clobbered.
	// Returns ErrInvalidEscrowState when no row matched.
	FailListingOrderPayment(ctx context.Context, orderID, reason string) error
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
	// MarketplaceFeeBps is the combined seller-side take (platform + guarantee)
	// in integer basis points. MON-20: aligned with services 8% + 2% = 10%
	// (1000 bps). Single fee_cents column.
	//
	// MONEY: this MUST stay identical to `feeBps` in
	// services/job/internal/repository/listing_repo.go, which computes and
	// PERSISTS listing_orders.fee_cents at auction close using the same
	// round-fractional-cent-UP rule. The two paths compute the same number; if
	// they disagree the buyer is charged a total that contradicts the order row.
	MarketplaceFeeBps int64

	// PaymentWindow is how long a buyer has to fund an order minted in
	// 'pending_payment' (auction win, buy-now, accepted offer) before the
	// settlement sweeper calls it unpaid. 72h is an ASSUMPTION, not a product
	// decision anyone has made — eBay's equivalent unpaid-item window is 4 days.
	// Tunable via MARKETPLACE_PAYMENT_WINDOW.
	PaymentWindow time.Duration
}

// DefaultMarketplaceConfig returns the v1 defaults.
func DefaultMarketplaceConfig() MarketplaceConfig {
	return MarketplaceConfig{
		AutoReleaseAfter:   14 * 24 * time.Hour,
		DisputeWindowAfter: 24 * time.Hour,
		PaymentWindow:      72 * time.Hour,
		MarketplaceFeeBps:  1000, // 8% platform + 2% guarantee (MON-20)
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

	// expireUnfunded gates the ONLY irreversible half of the settlement sweeper:
	// moving an unfunded order to the terminal 'payment_failed'. Default false.
	//
	// Off, the sweeper still finds and loudly logs every overdue unfunded order
	// (so the failure is visible and actionable today) but changes no row. Whether
	// an unpaid auction win should be cancelled — and what happens to the listing,
	// the awarded bid and the bidder's bond when it is — is a product decision
	// nobody has made yet, and it is not one a background worker should make by
	// default. Set MARKETPLACE_PAYMENT_EXPIRY=true to arm it.
	expireUnfunded bool
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

// SetExpireUnfunded arms (or disarms) the terminal 'payment_failed' transition
// in the settlement sweeper. See MarketplaceService.expireUnfunded.
func (s *MarketplaceService) SetExpireUnfunded(enabled bool) {
	s.expireUnfunded = enabled
}

// SetConfig overrides the defaults (used by tests + admin tooling).
func (s *MarketplaceService) SetConfig(cfg MarketplaceConfig) {
	if cfg.AutoReleaseAfter > 0 {
		s.cfg.AutoReleaseAfter = cfg.AutoReleaseAfter
	}
	if cfg.DisputeWindowAfter > 0 {
		s.cfg.DisputeWindowAfter = cfg.DisputeWindowAfter
	}
	if cfg.MarketplaceFeeBps > 0 {
		s.cfg.MarketplaceFeeBps = cfg.MarketplaceFeeBps
	}
	if cfg.PaymentWindow > 0 {
		s.cfg.PaymentWindow = cfg.PaymentWindow
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
	// MONEY: integer bps math with the fractional cent rounded UP — byte-for-byte
	// the rule used by listing_repo.CloseListing when it persisted
	// listing_orders.fee_cents. Previously this truncated, so the buyer's total
	// could be 1c below the fee already recorded on the order.
	feeCents := feeFromBPS(order.AmountCents, s.cfg.MarketplaceFeeBps)
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

// --- Settlement sweeper (auction close) ---

// SettlementStats summarises one SettlePendingListingOrders pass.
type SettlementStats struct {
	Scanned      int // orders in 'pending_payment' examined this pass
	Charged      int // PaymentIntents newly created (or replayed idempotently)
	ChargeFailed int // ChargeListingWinner returned an error
	Overdue      int // unfunded past their payment deadline
	Expired      int // moved to terminal 'payment_failed' (only when armed)
}

// SettlePendingListingOrders is the missing caller for ChargeListingWinner.
//
// WHY THIS EXISTS. A won auction is closed by the job service, which inserts
// listing_orders in escrow_status='pending_payment' with no payment_intent_id
// (services/job/internal/repository/listing_repo.go). Its cron comment claimed
// "ChargeListingWinner (payment service) attaches the PI" — nothing did.
// ChargeListingWinner had exactly two callers, both in the gateway on the
// synchronous buy-now and offer-accept paths, so an auction win produced an
// order that nothing ever touched again: escrow_status never reached 'held',
// the auto-release worker (which selects only 'held'/'released') never saw it,
// and nobody was told. This sweeper is that caller.
//
// WHAT IT DOES AND DOES NOT DO. Two phases, both idempotent:
//
//	1. Charge. For an order with no PaymentIntent, call ChargeListingWinner.
//	   That recomputes fee + tax from the order row, creates the PI under the
//	   deterministic Stripe key "listing-charge:<orderID>", and stamps
//	   payment_intent_id / tax_cents / fee_cents / auto_release_at. Re-entry is
//	   safe twice over: ChargeListingWinner short-circuits when the order
//	   already carries a PI, and the Stripe key dedupes at Stripe. The first
//	   pass also stamps payment_due_at = now + PaymentWindow, and only the
//	   first — RecordListingPaymentAttempt never overwrites a running deadline.
//
//	2. Expire. An order still unfunded past its deadline is counted, logged at
//	   ERROR with the buyer, seller and amount, and — only when SetExpireUnfunded
//	   is armed — moved to the terminal 'payment_failed' (migration 101).
//
// IT DOES NOT COLLECT MONEY, and cannot yet. CreateMarketplacePaymentIntent
// builds a PaymentIntent with no Customer, no PaymentMethod and Confirm unset,
// so the PI lands in requires_payment_method and someone has to confirm it
// client-side. For an auction there is nobody there: the buyer is not on the
// site at close. An off-session charge is not merely unwired, it is impossible
// with today's plumbing — no Stripe Customer is ever created anywhere in this
// repo (subscriptions.stripe_customer_id is written from a domain field that is
// never populated, so GetStripeCustomerID returns "" for every user),
// CreateSetupIntent never sets params.Customer so a confirmed card is attached
// to nothing, and bid_bonds stores the SetupIntent client_secret rather than a
// pm_ id. Closing that gap needs changes in stripe.go, the gateway and the web
// app. Until then this sweeper's job is to attach the PI and make the dead end
// visible, not to pretend money moved.
//
// Fail-soft per order: one bad row is logged and skipped so it can never stall
// the backlog. Fail-closed on money: nothing here transfers, captures or
// refunds, and an order that reached 'held' or beyond is never in the input set.
func (s *MarketplaceService) SettlePendingListingOrders(ctx context.Context, batchLimit int) (SettlementStats, error) {
	var stats SettlementStats
	if batchLimit <= 0 {
		batchLimit = 100
	}

	orders, err := s.repo.ListListingOrdersAwaitingPayment(ctx, batchLimit)
	if err != nil {
		return stats, fmt.Errorf("settle pending listing orders: list: %w", err)
	}
	stats.Scanned = len(orders)

	now := s.now()
	for _, o := range orders {
		if o.PaymentIntentID == "" {
			if s.chargeOnePendingOrder(ctx, o, now) {
				stats.Charged++
				// The deadline was just stamped at now + window, so it is in the
				// future by construction: nothing to expire on this pass.
				continue
			}
			stats.ChargeFailed++
			// Deliberately NOT `continue`. An order the platform cannot charge
			// at all — a permanently poisoned row — would otherwise be retried
			// every tick forever with no way to terminate. Falling through to
			// the deadline check below (which uses created_at + window, since a
			// failed attempt never stamps payment_due_at) gives it the same
			// finite life as any other unfunded order.
		}

		deadline := o.CreatedAt.Add(s.cfg.PaymentWindow)
		if o.PaymentDueAt != nil {
			deadline = *o.PaymentDueAt
		}
		if now.Before(deadline) {
			continue
		}
		stats.Overdue++

		slog.ErrorContext(ctx, "listing order past its payment deadline and still unfunded",
			"order_id", o.ID,
			"listing_id", o.ListingID,
			"buyer_id", o.BuyerID,
			"seller_id", o.SellerID,
			"amount_cents", o.AmountCents,
			"payment_intent_id", o.PaymentIntentID,
			"payment_attempts", o.PaymentAttempts,
			"deadline", deadline.Format(time.RFC3339),
			"expiry_armed", s.expireUnfunded,
		)
		if !s.expireUnfunded {
			continue
		}
		if err := s.repo.FailListingOrderPayment(ctx, o.ID,
			fmt.Sprintf("buyer did not fund escrow within %s of order creation", s.cfg.PaymentWindow)); err != nil {
			if errors.Is(err, ErrInvalidEscrowState) {
				// Funded (or otherwise moved on) between the SELECT and the
				// UPDATE. The status-guarded UPDATE is what makes that safe.
				slog.InfoContext(ctx, "settle: order left pending_payment before expiry, skipping",
					"order_id", o.ID)
				continue
			}
			slog.ErrorContext(ctx, "settle: failed to expire unfunded order, continuing",
				"order_id", o.ID, "error", err)
			continue
		}
		stats.Expired++
		slog.WarnContext(ctx, "listing order marked payment_failed",
			"order_id", o.ID,
			"listing_id", o.ListingID,
			"buyer_id", o.BuyerID,
			"seller_id", o.SellerID,
		)
	}

	return stats, nil
}

// chargeOnePendingOrder attaches a PaymentIntent to one unfunded order and
// stamps the payment clock. Reports whether the charge call succeeded; every
// outcome is recorded on the row so a stuck order is never indistinguishable
// from a fresh one.
func (s *MarketplaceService) chargeOnePendingOrder(ctx context.Context, o *PendingListingOrder, now time.Time) bool {
	res, err := s.ChargeListingWinner(ctx, o.ID)
	if err != nil {
		// Record the attempt WITHOUT a deadline: a platform-side failure must
		// not start (or restart) the buyer's clock. Truncate the message so a
		// verbose upstream error cannot bloat the column.
		reason := err.Error()
		if len(reason) > 500 {
			reason = reason[:500]
		}
		if recErr := s.repo.RecordListingPaymentAttempt(ctx, o.ID, nil, reason); recErr != nil {
			slog.ErrorContext(ctx, "settle: failed to record payment attempt", "order_id", o.ID, "error", recErr)
		}
		slog.ErrorContext(ctx, "settle: charge listing winner failed, continuing",
			"order_id", o.ID,
			"listing_id", o.ListingID,
			"buyer_id", o.BuyerID,
			"attempts", o.PaymentAttempts+1,
			"error", err,
		)
		return false
	}

	due := now.Add(s.cfg.PaymentWindow)
	if recErr := s.repo.RecordListingPaymentAttempt(ctx, o.ID, &due, ""); recErr != nil {
		// The PI exists and is stamped on the order; only the clock is missing.
		// The next pass falls back to created_at + window, so this degrades
		// rather than losing the order.
		slog.ErrorContext(ctx, "settle: charged but failed to stamp payment deadline",
			"order_id", o.ID, "error", recErr)
	}

	slog.InfoContext(ctx, "settle: payment intent attached to unfunded listing order",
		"order_id", o.ID,
		"listing_id", o.ListingID,
		"buyer_id", o.BuyerID,
		"seller_id", o.SellerID,
		"payment_intent_id", res.PaymentIntentID,
		"total_cents", res.TotalCents,
		"payment_due_at", due.Format(time.RFC3339),
	)
	return true
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
