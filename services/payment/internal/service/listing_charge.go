package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
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

// PendingListingTransferPrefix marks stripe_transfer_id while a release worker
// owns the payout path but has not yet stamped a real Stripe transfer id
// (MON-18 durable claim). Real Connect transfer ids start with "tr_".
const PendingListingTransferPrefix = "pending:"

// PendingListingTransferClaim returns the durable in-flight claim marker for an order.
func PendingListingTransferClaim(orderID string) string {
	return PendingListingTransferPrefix + orderID
}

// IsPendingListingTransferClaim reports whether transferID is an in-flight claim.
func IsPendingListingTransferClaim(transferID string) bool {
	return strings.HasPrefix(transferID, PendingListingTransferPrefix)
}

// IsFinalListingTransfer reports whether transferID is a completed Stripe payout.
func IsFinalListingTransfer(transferID string) bool {
	return transferID != "" && !IsPendingListingTransferClaim(transferID)
}

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
	ID                    string
	ListingOrderID        string
	OpenedBy              string
	Reason                string
	Description           string
	Status                string // open, under_review, resolved, closed
	Resolution            string // refund_full, refund_partial, release_to_seller, no_action
	RefundToBuyerCents    int64
	TransferToSellerCents int64
	ResolutionNotes       string
	ResolvedBy            *string
	ResolvedAt            *time.Time
	CreatedAt             time.Time
	UpdatedAt             time.Time
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
	// ClaimListingOrderForRelease locks the order row (FOR UPDATE) and stamps a
	// durable pending transfer claim when still eligible for payout
	// (held/released, no dispute, no final transfer). Returns
	// ErrInvalidEscrowState when another worker claimed it or a dispute is open
	// (MON-18). The pending claim blocks concurrent FileListingDispute freezes
	// for the duration of the Stripe transfer call.
	ClaimListingOrderForRelease(ctx context.Context, orderID string) (*MarketplaceListingOrder, error)
	// ClaimListingOrderForDispute locks the order row (FOR UPDATE) and freezes
	// it as disputed with the given disputeID when still eligible (held or
	// pickup_confirmed, no open dispute, no transfer/claim). Fail closed with
	// ErrInvalidEscrowState / ErrDisputeAlreadyOpen (MON-18).
	ClaimListingOrderForDispute(ctx context.Context, orderID, disputeID string) (*MarketplaceListingOrder, error)
	// MarkListingOrderTransferred stamps the Stripe Connect transfer id on a
	// paid-out order. This is the durable "already paid" marker that lets the
	// auto-release worker reconcile handshake-released orders exactly once.
	MarkListingOrderTransferred(ctx context.Context, orderID, transferID string) error
	// ReleaseAuthorizedBidBondForUser releases the buyer's authorized bid bond
	// after escrow is funded (winner path). Returns rows affected.
	ReleaseAuthorizedBidBondForUser(ctx context.Context, listingID, userID string) (int64, error)

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

	// NotifyListingPaymentProblem tells the BUYER that collecting payment for an
	// order they owe did not succeed, and what they must do about it.
	//
	// outcome distinguishes the cases that must never be collapsed (no card on
	// file / SCA required / insufficient funds / declined); buyerMessage is the
	// already-audience-appropriate text from ChargeOutcome.BuyerMessage. The
	// buyer must be told: an auction win they cannot pay for, that nobody
	// mentions, is how a marketplace loses both sides of a trade.
	NotifyListingPaymentProblem(ctx context.Context, buyerID, orderID string, outcome ChargeOutcome, buyerMessage string) error

	// NotifyListingPaymentCaptured confirms to the BUYER that an off-session
	// charge succeeded and their order is funded. Required because the charge
	// happens while they are away: the first they would otherwise know of a
	// completed payment is their card statement.
	NotifyListingPaymentCaptured(ctx context.Context, buyerID, orderID string, totalCents int64) error
}

// noopMarketplaceNotifier is the default if no notifier is wired.
type noopMarketplaceNotifier struct{}

func (noopMarketplaceNotifier) NotifyListingPaymentProblem(_ context.Context, _, _ string, _ ChargeOutcome, _ string) error {
	return nil
}
func (noopMarketplaceNotifier) NotifyListingPaymentCaptured(_ context.Context, _, _ string, _ int64) error {
	return nil
}

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
	AutoReleaseAfter   time.Duration // default 14d
	DisputeWindowAfter time.Duration // dispute allowed up to: pickup_confirmed_at + this duration (default 24h)
	// MarketplaceFeeBps is a TEST/LEGACY override for the combined seller-side
	// take in basis points. Production charge paths load rates from
	// platform_fee_config (fee_percentage + guarantee_percentage) via
	// FeeConfigLoader. When the loader is set, this field is ignored.
	// Kept so unit tests can force a known bps without a fee-config mock.
	MarketplaceFeeBps int64

	// PaymentWindow is how long a buyer has to fund an order minted in
	// 'pending_payment' (auction win, buy-now, accepted offer) before the
	// settlement sweeper calls it unpaid. 72h is an ASSUMPTION, not a product
	// decision anyone has made — eBay's equivalent unpaid-item window is 4 days.
	// Tunable via MARKETPLACE_PAYMENT_WINDOW.
	PaymentWindow time.Duration
}

// DefaultMarketplaceConfig returns the v1 defaults.
// MarketplaceFeeBps remains 1000 as a documented fallback when no FeeConfigLoader
// is wired (tests); production wires platform_fee_config (seeded 8%+2%).
func DefaultMarketplaceConfig() MarketplaceConfig {
	return MarketplaceConfig{
		AutoReleaseAfter:   14 * 24 * time.Hour,
		DisputeWindowAfter: 24 * time.Hour,
		PaymentWindow:      72 * time.Hour,
		MarketplaceFeeBps:  1000, // fallback only — prefer FeeConfigLoader
	}
}

// FeeConfigLoader loads platform_fee_config for goods take-rate (R6.1).
// Implemented by payment PostgresRepository (GetDefaultFeeConfig / GetFeeConfig).
type FeeConfigLoader interface {
	GetDefaultFeeConfig(ctx context.Context) (*domain.FeeConfig, error)
	GetFeeConfig(ctx context.Context, categoryID string) (*domain.FeeConfig, error)
}

// MarketplaceSellerFeeCents computes listing_orders.fee_cents from fee config.
// Combined platform + guarantee rates as one bps sum (single fee_cents column),
// ceiling fractional cents, then min/max floor/cap on the combined fee.
// Lead-gen is services-only and is intentionally omitted for goods.
func MarketplaceSellerFeeCents(amountCents int64, fc *domain.FeeConfig) int64 {
	if amountCents <= 0 {
		return 0
	}
	if fc == nil {
		fc = domain.DefaultFeeConfig()
	}
	bps := rateToBPS(fc.FeePercentage) + rateToBPS(fc.GuaranteePercentage)
	if bps <= 0 {
		// Corrupt/zero config — use documented default take (8%+2%).
		bps = rateToBPS(domain.DefaultFeeConfig().FeePercentage) +
			rateToBPS(domain.DefaultFeeConfig().GuaranteePercentage)
	}
	fee := feeFromBPS(amountCents, bps)
	if fee < fc.MinFeeCents {
		fee = fc.MinFeeCents
	}
	if fc.MaxFeeCents != nil && *fc.MaxFeeCents > 0 && fee > *fc.MaxFeeCents {
		fee = *fc.MaxFeeCents
	}
	return fee
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
	// feeLoader reads platform_fee_config. When nil, MarketplaceFeeBps / DefaultFeeConfig.
	feeLoader FeeConfigLoader

	// buyers resolves a buyer's Stripe Customer and default payment method so an
	// auction win can be collected off-session. Optional: when nil the sweeper
	// keeps its previous behaviour exactly (attach a PaymentIntent, collect
	// nothing) rather than guessing at a card.
	buyers *CustomerProvisioner

	// offSessionCharge gates merchant-initiated collection on auction wins.
	//
	// This is the only place in the goods flow where the platform moves a
	// buyer's money without the buyer present. Process startup (cmd/server)
	// keeps it OFF unless MARKETPLACE_OFFSESSION_CHARGE=true AND
	// MARKETPLACE_OFFSESSION_TOS_VERSION is a non-empty terms id/date
	// (Decision-ID OFFSESSION-LEGAL). The constructor default below is ON so
	// unit tests of the collect path do not have to arm the flag; production
	// never uses that default — main always calls SetOffSessionCharge.
	offSessionCharge bool

	// expireUnfunded gates the ONLY irreversible half of the settlement sweeper:
	// moving an unfunded order to the terminal 'payment_failed'. Default false.
	//
	// Off, the sweeper still finds and loudly logs every overdue unfunded order
	// (so the failure is visible and actionable today) but changes no row. Same
	// OFFSESSION-LEGAL pairing as off-session charge: MARKETPLACE_PAYMENT_EXPIRY
	// cannot stay true without MARKETPLACE_OFFSESSION_TOS_VERSION.
	expireUnfunded bool
}

// NewMarketplaceService constructs a service with sane defaults.
func NewMarketplaceService(repo MarketplaceRepository, stripe *StripeService) *MarketplaceService {
	return &MarketplaceService{
		repo:             repo,
		stripe:           stripe,
		notifier:         noopMarketplaceNotifier{},
		cfg:              DefaultMarketplaceConfig(),
		now:              time.Now,
		offSessionCharge: true,
	}
}

// SetCustomerProvisioner wires buyer Stripe Customer / default-card resolution.
// Without it the sweeper cannot collect off-session and says so explicitly.
func (s *MarketplaceService) SetCustomerProvisioner(p *CustomerProvisioner) {
	s.buyers = p
}

// SetOffSessionCharge arms or disarms merchant-initiated collection on auction
// wins. See MarketplaceService.offSessionCharge.
func (s *MarketplaceService) SetOffSessionCharge(enabled bool) {
	s.offSessionCharge = enabled
}

// OffSessionChargeEnabled reports whether merchant-initiated collection is armed.
func (s *MarketplaceService) OffSessionChargeEnabled() bool {
	return s.offSessionCharge
}

// ExpireUnfundedEnabled reports whether the sweeper may move overdue unfunded
// orders to terminal payment_failed.
func (s *MarketplaceService) ExpireUnfundedEnabled() bool {
	return s.expireUnfunded
}

// lookupBuyerCustomer returns the buyer's Stripe Customer id, or "" when there
// isn't one.
//
// Never provisions: creating a Stripe Customer for someone on a background cron,
// as a side effect of them winning an auction, would mint objects for users who
// have never entered a card. Provisioning belongs on the setup-intent path where
// the user is present and asking to save a card.
func (s *MarketplaceService) lookupBuyerCustomer(ctx context.Context, buyerID string) string {
	if s.buyers == nil || buyerID == "" {
		return ""
	}
	cus, err := s.buyers.Lookup(ctx, buyerID)
	if err != nil {
		slog.WarnContext(ctx, "could not resolve buyer stripe customer",
			"buyer_id", buyerID, "error", err)
		return ""
	}
	return cus
}

// resolveBuyerInstrument returns the payment method to charge off-session.
//
// Fails closed with ErrNoPaymentInstrument on every uncertain path — no
// provisioner, no customer, no default card, or a DB error. "We are not sure
// which card to charge" must never resolve to "charge something".
func (s *MarketplaceService) resolveBuyerInstrument(ctx context.Context, buyerID string) (customerID, paymentMethodID string, err error) {
	if s.buyers == nil {
		return "", "", fmt.Errorf("resolve buyer instrument: customer provisioner not configured: %w", ErrNoPaymentInstrument)
	}
	customerID, err = s.buyers.Lookup(ctx, buyerID)
	if err != nil {
		return "", "", fmt.Errorf("resolve buyer instrument for %s: %w", buyerID, err)
	}
	if customerID == "" {
		return "", "", fmt.Errorf("resolve buyer instrument for %s: no stripe customer: %w", buyerID, ErrNoPaymentInstrument)
	}
	paymentMethodID, err = s.buyers.DefaultPaymentMethod(ctx, buyerID)
	if err != nil {
		return "", "", fmt.Errorf("resolve buyer instrument for %s: %w", buyerID, err)
	}
	if paymentMethodID == "" {
		return "", "", fmt.Errorf("resolve buyer instrument for %s: no default payment method: %w", buyerID, ErrNoPaymentInstrument)
	}
	return customerID, paymentMethodID, nil
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

// SetFeeConfigLoader wires platform_fee_config for goods take-rate (R6.1).
// Production must call this so admin fee-config edits apply to marketplace charges.
func (s *MarketplaceService) SetFeeConfigLoader(l FeeConfigLoader) {
	s.feeLoader = l
}

// resolveMarketplaceFeeCents is the charge-path SSOT for listing_orders.fee_cents.
// Prefer live fee config; fall back to cfg.MarketplaceFeeBps; last resort DefaultFeeConfig.
func (s *MarketplaceService) resolveMarketplaceFeeCents(ctx context.Context, amountCents int64) int64 {
	if s.feeLoader != nil {
		if fc, err := s.feeLoader.GetDefaultFeeConfig(ctx); err == nil && fc != nil {
			return MarketplaceSellerFeeCents(amountCents, fc)
		}
		// Soft-fail: log and continue to bps/default rather than fail the charge.
		// Admin misconfig must not brick all goods settlement.
	}
	if s.cfg.MarketplaceFeeBps > 0 {
		return feeFromBPS(amountCents, s.cfg.MarketplaceFeeBps)
	}
	return MarketplaceSellerFeeCents(amountCents, domain.DefaultFeeConfig())
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
	//
	// ClientSecret is NOT on the order row — only the PI id is. Without re-
	// reading it from Stripe (or the dev store), a buyer whose first charge
	// attempt left them with SCA / a dismissed sheet gets an empty secret on
	// POST /orders/{id}/pay and cannot complete payment. Settlement only needs
	// the PI id; empty secret on held is fine, but pending_payment re-entry
	// must populate it when Stripe will still hand it out.
	if order.PaymentIntentID != "" && (order.EscrowStatus == "pending_payment" || order.EscrowStatus == "held") {
		slog.Info("charge listing winner: existing payment intent",
			"order_id", orderID,
			"pi_id", order.PaymentIntentID,
			"status", order.EscrowStatus,
		)
		result := &ChargeListingResult{
			OrderID:         order.ID,
			PaymentIntentID: order.PaymentIntentID,
			AmountCents:     order.AmountCents,
			FeeCents:        order.FeeCents,
			TaxCents:        order.TaxCents,
			TotalCents:      order.AmountCents + order.FeeCents + order.TaxCents,
		}
		if order.EscrowStatus == "pending_payment" {
			secret, secErr := s.stripe.GetPaymentIntentClientSecret(ctx, order.PaymentIntentID)
			if secErr != nil {
				// Do not fail the whole charge: the settlement sweeper re-enters
				// here with only the PI id. Log loudly so a pay-route empty
				// secret is diagnosable rather than silent.
				slog.WarnContext(ctx, "charge listing winner: could not re-read client secret",
					"order_id", orderID,
					"pi_id", order.PaymentIntentID,
					"error", secErr,
				)
			} else {
				result.ClientSecret = secret
			}
		}
		return result, nil
	}

	if order.EscrowStatus != "pending_payment" {
		return nil, fmt.Errorf("charge listing winner: order in status %q: %w", order.EscrowStatus, ErrInvalidEscrowState)
	}

	// Compute fee + tax. Recompute fee as SSOT from platform_fee_config (R6.1)
	// so mint-time and charge-time stay aligned when both load the same config.
	// MONEY: integer bps math with fractional cent rounded UP.
	feeCents := s.resolveMarketplaceFeeCents(ctx, order.AmountCents)
	taxState, taxCents := ComputeTaxCentsForZip(order.AmountCents, order.PickupZipCode)
	totalCents := order.AmountCents + feeCents + taxCents

	// Idempotency key: deterministic per order + stage so retries dedupe.
	idemKey := fmt.Sprintf("listing-charge:%s", order.ID)

	// Bind the PaymentIntent to the buyer's Stripe Customer. Without this the PI
	// is customerless and can only ever be confirmed by a browser holding the
	// client_secret — which is fine for buy-now (the buyer is present) and
	// useless for an auction win (they are not). Best-effort: a buyer with no
	// Customer yet still gets a PI they can pay on-session; only the off-session
	// path requires one, and that path checks separately.
	buyerCustomerID := s.lookupBuyerCustomer(ctx, order.BuyerID)

	// Funds are held in the platform Stripe account (no destination charge).
	// The seller is paid via a separate transfer when escrow releases.
	piID, clientSecret, err := s.stripe.CreateMarketplacePaymentIntent(
		ctx,
		totalCents,
		"usd",
		buyerCustomerID,
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
	// Winner paid: release their authorized bid bond (losers already released
	// at auction close). Fail-soft — escrow is already held.
	s.releaseWinnerBidBond(ctx, order)
	return nil
}

// releaseWinnerBidBond flips the buyer's authorized bond for this listing to
// released after escrow is funded. Idempotent if already released/captured.
func (s *MarketplaceService) releaseWinnerBidBond(ctx context.Context, order *MarketplaceListingOrder) {
	if order == nil || order.ListingID == "" || order.BuyerID == "" {
		return
	}
	// MarketplaceRepository exposes the shared pool via a small helper.
	n, err := s.repo.ReleaseAuthorizedBidBondForUser(ctx, order.ListingID, order.BuyerID)
	if err != nil {
		slog.WarnContext(ctx, "listing held: winner bid bond release failed (escrow still held)",
			"order_id", order.ID,
			"listing_id", order.ListingID,
			"buyer_id", order.BuyerID,
			"error", err,
		)
		return
	}
	if n > 0 {
		slog.InfoContext(ctx, "listing held: released winner bid bond",
			"order_id", order.ID,
			"listing_id", order.ListingID,
			"buyer_id", order.BuyerID,
		)
	}
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

	// MON-18: durable claim before transfer so a concurrent dispute freeze loses.
	claimed, err := s.repo.ClaimListingOrderForRelease(ctx, order.ID)
	if err != nil {
		return nil, fmt.Errorf("confirm pickup: claim: %w", err)
	}

	now := s.now()
	if err := s.releaseToSeller(ctx, claimed, &now); err != nil {
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
//
// Callers that race with FileListingDispute must pass an order already claimed
// via ClaimListingOrderForRelease (durable pending transfer marker). ConfirmPickup
// claims inline before invoking this helper.
func (s *MarketplaceService) releaseToSeller(ctx context.Context, order *MarketplaceListingOrder, pickupConfirmedAt *time.Time) error {
	// Double-pay guard: a final Stripe transfer id means the seller was already
	// paid. A pending claim (MON-18) is intentionally not a skip — it means this
	// worker owns the payout path and should proceed to CreateMarketplaceTransfer.
	if IsFinalListingTransfer(order.StripeTransferID) {
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
//
// MON-18: freezes the order under FOR UPDATE via ClaimListingOrderForDispute so
// a concurrent auto-release cannot transfer after (or while) the dispute opens.
// Fail closed when the order is no longer held/eligible or a release claim won.
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

	// Fail closed against a concurrent release claim before we insert a dispute row.
	if IsFinalListingTransfer(order.StripeTransferID) || IsPendingListingTransferClaim(order.StripeTransferID) {
		return nil, fmt.Errorf("file dispute: order already claimed for release: %w", ErrInvalidEscrowState)
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

	// MON-18: lock + freeze under FOR UPDATE. Serializes with ClaimListingOrderForRelease.
	frozen, err := s.repo.ClaimListingOrderForDispute(ctx, order.ID, dispute.ID)
	if err != nil {
		return nil, fmt.Errorf("file dispute: claim/freeze: %w", err)
	}

	if err := s.notifier.NotifyDisputeFiled(ctx, frozen.SellerID, frozen.ID, dispute.ID); err != nil {
		slog.Warn("failed to notify seller of dispute",
			"order_id", frozen.ID, "dispute_id", dispute.ID, "error", err)
	}
	slog.Info("listing dispute filed",
		"order_id", frozen.ID, "dispute_id", dispute.ID, "reason", reason,
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
//
// The collection counters are deliberately one-per-outcome rather than a single
// "failed" tally. They are the operational readout of the whole payment system:
// a spike in NoInstrument means the card-saving funnel is broken (a platform
// problem), a spike in AuthRequired means buyers are being asked to authenticate
// and are not coming back (a UX problem), and a spike in Declined means exactly
// what it says (a buyer-quality problem). One combined number would hide all
// three behind each other.
type SettlementStats struct {
	Scanned      int // orders in 'pending_payment' examined this pass
	Charged      int // PaymentIntents newly created (or replayed idempotently)
	ChargeFailed int // ChargeListingWinner returned an error
	Overdue      int // unfunded past their payment deadline
	Expired      int // moved to terminal 'payment_failed' (only when armed)

	// Off-session collection outcomes.
	Collected      int // funds captured off-session; order moved to 'held'
	NoInstrument   int // no chargeable card on file — never attempted
	AuthRequired   int // SCA: the buyer must return to the app
	Declined       int // issuer declined (any reason other than funds)
	InsufficientFn int // issuer declined specifically for insufficient funds
	CollectError   int // infrastructure failure; not attributable to the buyer
}

// countOutcome folds one collection result into the stats.
func (st *SettlementStats) countOutcome(o ChargeOutcome) {
	switch o {
	case ChargeOutcomeSucceeded:
		st.Collected++
	case ChargeOutcomeNoPaymentMethod:
		st.NoInstrument++
	case ChargeOutcomeAuthenticationRequired:
		st.AuthRequired++
	case ChargeOutcomeInsufficientFunds:
		st.InsufficientFn++
	case ChargeOutcomeCardDeclined:
		st.Declined++
	default:
		st.CollectError++
	}
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
//  1. Charge. For an order with no PaymentIntent, call ChargeListingWinner.
//     That recomputes fee + tax from the order row, creates the PI under the
//     deterministic Stripe key "listing-charge:<orderID>", and stamps
//     payment_intent_id / tax_cents / fee_cents / auto_release_at. Re-entry is
//     safe twice over: ChargeListingWinner short-circuits when the order
//     already carries a PI, and the Stripe key dedupes at Stripe. The first
//     pass also stamps payment_due_at = now + PaymentWindow, and only the
//     first — RecordListingPaymentAttempt never overwrites a running deadline.
//
//  2. Expire. An order still unfunded past its deadline is counted, logged at
//     ERROR with the buyer, seller and amount, and — only when SetExpireUnfunded
//     is armed — moved to the terminal 'payment_failed' (migration 101).
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
				// A PaymentIntent now exists. Try to collect against it in this
				// same pass rather than waiting a full tick: the buyer just won
				// an auction and the mandate is freshest now.
				if outcome, ok := s.collectOnePendingOrder(ctx, o, &stats); ok && outcome == ChargeOutcomeSucceeded {
					continue
				}
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
		} else {
			// A PaymentIntent is already attached but the order is still
			// unfunded. This is the auction-settlement case: nobody is going to
			// confirm it client-side, because the buyer is not on the site.
			outcome, attempted := s.collectOnePendingOrder(ctx, o, &stats)
			if attempted {
				if outcome == ChargeOutcomeSucceeded {
					continue
				}
				if outcome == ChargeOutcomeAuthenticationRequired {
					// SCA. The buyer has been told to come back and authenticate;
					// expiring the order underneath them would cancel a purchase
					// that is actively waiting on a step WE asked them to take.
					// Skip the expiry branch this pass. This can keep an order
					// alive indefinitely if the buyer never returns — accepted
					// deliberately, because the alternative (cancelling a
					// solvent, willing buyer's win) is the worse error, and the
					// condition is visible in stats.AuthRequired and in the
					// ERROR log below.
					continue
				}
			}
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

// collectOnePendingOrder attempts an off-session charge against the buyer's
// saved card for an order that already carries a PaymentIntent.
//
// Returns (outcome, attempted). attempted is false when collection is disarmed
// or the order carries no PaymentIntent — in that case the caller falls through
// to the ordinary deadline logic and nothing is recorded against the buyer.
//
// EVERY exit path is fail-closed on money: the order moves to 'held' if and only
// if Stripe reports the PaymentIntent succeeded. Any error, any ambiguous
// status, any classification we do not recognise leaves the order exactly where
// it was, unfunded, and lets the next pass or a human decide.
func (s *MarketplaceService) collectOnePendingOrder(ctx context.Context, o *PendingListingOrder, stats *SettlementStats) (ChargeOutcome, bool) {
	if !s.offSessionCharge {
		return "", false
	}
	if s.buyers == nil {
		// No provisioner wired: collection is not merely failing, it is not
		// configured. Report NOTHING rather than classifying every order as
		// "buyer has no card" — that would blame buyers for a deployment gap and
		// bury a real card-saving outage in a metric that is always saturated.
		// Behaviour is then identical to before off-session collection existed:
		// attach a PaymentIntent, collect nothing.
		return "", false
	}

	// Re-read the order: chargeOnePendingOrder may have just stamped the
	// PaymentIntent, and the projection we were handed predates that write.
	order, err := s.repo.GetListingOrder(ctx, o.ID)
	if err != nil {
		slog.ErrorContext(ctx, "collect: could not reload order, skipping",
			"order_id", o.ID, "error", err)
		return "", false
	}
	if order.PaymentIntentID == "" {
		return "", false
	}
	// Guard against collecting on an order that moved on between the sweep query
	// and now. Charging a refunded or already-held order would take money for
	// nothing.
	if order.EscrowStatus != "pending_payment" {
		slog.InfoContext(ctx, "collect: order left pending_payment before collection, skipping",
			"order_id", order.ID, "status", order.EscrowStatus)
		return "", false
	}

	totalCents := order.AmountCents + order.FeeCents + order.TaxCents

	customerID, paymentMethodID, err := s.resolveBuyerInstrument(ctx, order.BuyerID)
	if err != nil {
		outcome, classified := classifyChargeError(err)
		s.recordCollectionOutcome(ctx, order, outcome, classified, stats)
		return outcome, true
	}

	// ATTEMPT-scoped idempotency key, deterministic in (order, attempt). Not
	// random and not order-scoped:
	//   - random would defeat the point and risk double-charging on a retry
	//     after an ambiguous timeout;
	//   - order-scoped would make Stripe replay a cached DECLINE forever, so a
	//     buyer who added funds could never pay.
	// Same construction as the BNPL installment key (processOneInstallment).
	idemKey := fmt.Sprintf("listing-collect:%s:attempt-%d", order.ID, o.PaymentAttempts+1)

	status, confirmErr := s.stripe.ConfirmOffSessionPaymentIntent(ctx, order.PaymentIntentID, paymentMethodID, idemKey)
	if confirmErr != nil {
		outcome, classified := classifyChargeError(confirmErr)
		s.recordCollectionOutcome(ctx, order, outcome, classified, stats)
		return outcome, true
	}

	outcome := classifyChargeStatus(status)
	if outcome != ChargeOutcomeSucceeded {
		// Stripe returned success at the API level but the intent did not
		// actually collect (requires_action, processing, ...). Treat it as the
		// classified non-success — never as payment.
		s.recordCollectionOutcome(ctx, order, outcome,
			fmt.Errorf("payment intent %s ended in status %q", order.PaymentIntentID, status), stats)
		return outcome, true
	}

	// Funds captured. Move the order to 'held'.
	//
	// HandleListingPaymentIntentSucceeded is the same transition the
	// payment_intent.succeeded event drives, and it is idempotent (a second call
	// on an already-'held' order returns nil). Doing it synchronously means the
	// sweeper's own stats are truthful in the same pass; the event remains the
	// backstop if this process dies between the capture and this write.
	if err := s.HandleListingPaymentIntentSucceeded(ctx, order.PaymentIntentID); err != nil {
		// Money HAS moved and the order is not marked funded. The event handler
		// will reconcile, but this must be loud: it is the one window where our
		// records understate what the buyer was charged.
		slog.ErrorContext(ctx, "collect: charged buyer but failed to move order to held; awaiting event reconciliation",
			"order_id", order.ID,
			"payment_intent_id", order.PaymentIntentID,
			"total_cents", totalCents,
			"error", err,
		)
	}

	if recErr := s.repo.RecordListingPaymentAttempt(ctx, order.ID, nil, ""); recErr != nil {
		slog.WarnContext(ctx, "collect: could not clear last_payment_error after success",
			"order_id", order.ID, "error", recErr)
	}

	stats.countOutcome(ChargeOutcomeSucceeded)
	slog.InfoContext(ctx, "collected listing order off-session",
		"order_id", order.ID,
		"listing_id", order.ListingID,
		"buyer_id", order.BuyerID,
		"seller_id", order.SellerID,
		"payment_intent_id", order.PaymentIntentID,
		"stripe_customer_id", customerID,
		"total_cents", totalCents,
	)

	if err := s.notifier.NotifyListingPaymentCaptured(ctx, order.BuyerID, order.ID, totalCents); err != nil {
		slog.WarnContext(ctx, "collect: failed to notify buyer of successful capture",
			"order_id", order.ID, "buyer_id", order.BuyerID, "error", err)
	}
	return ChargeOutcomeSucceeded, true
}

// recordCollectionOutcome persists and reports one unsuccessful collection.
//
// Three separate audiences, each getting what they can act on:
//   - the ROW gets last_payment_error, so support can see why an order is stuck;
//   - the LOG gets the full classification at a severity matching whose problem
//     it is (platform gaps and infra are ERROR; buyer-side declines are WARN);
//   - the BUYER gets ChargeOutcome.BuyerMessage, which is self-serve guidance and
//     never a raw Stripe string.
func (s *MarketplaceService) recordCollectionOutcome(
	ctx context.Context,
	order *MarketplaceListingOrder,
	outcome ChargeOutcome,
	cause error,
	stats *SettlementStats,
) {
	stats.countOutcome(outcome)

	reason := fmt.Sprintf("%s: %v", outcome, cause)
	if len(reason) > 500 {
		reason = reason[:500]
	}
	// Never stamp a deadline here. A charge that failed must not start or extend
	// the buyer's clock — and for the outcomes that are not their fault it must
	// not consume it either.
	if recErr := s.repo.RecordListingPaymentAttempt(ctx, order.ID, nil, reason); recErr != nil {
		slog.ErrorContext(ctx, "collect: failed to record payment attempt",
			"order_id", order.ID, "error", recErr)
	}

	attrs := []any{
		"order_id", order.ID,
		"listing_id", order.ListingID,
		"buyer_id", order.BuyerID,
		"seller_id", order.SellerID,
		"payment_intent_id", order.PaymentIntentID,
		"outcome", string(outcome),
		"attributable_to_buyer", outcome.AttributableToBuyer(),
		"retryable", outcome.Retryable(),
		"error", cause,
	}
	if outcome.AttributableToBuyer() {
		slog.WarnContext(ctx, "collect: off-session charge did not complete", attrs...)
	} else {
		// No card on file, or Stripe/infra failure. Both are the platform's
		// problem to fix and neither is the buyer's fault — CLAUDE.md §15:
		// platform-config failures alert the admin, not the end user.
		slog.ErrorContext(ctx, "collect: off-session charge blocked by a platform-side condition", attrs...)
	}

	if err := s.notifier.NotifyListingPaymentProblem(ctx, order.BuyerID, order.ID, outcome, outcome.BuyerMessage()); err != nil {
		slog.WarnContext(ctx, "collect: failed to notify buyer of payment problem",
			"order_id", order.ID, "buyer_id", order.BuyerID, "outcome", string(outcome), "error", err)
	}
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
