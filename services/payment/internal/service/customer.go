package service

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// CustomerDirectory is the persistence surface CustomerProvisioner needs.
//
// Declared here, in the consuming package, rather than bolted onto the 60-method
// domain.PaymentRepository — the same pattern MarketplaceRepository and
// ConnectAccountResolver already use. *repository.PostgresRepository satisfies it
// structurally.
type CustomerDirectory interface {
	// GetUserStripeCustomerID returns "" (no error) when unprovisioned, and an
	// error when the user does not exist.
	GetUserStripeCustomerID(ctx context.Context, userID string) (string, error)
	// ClaimUserStripeCustomerID atomically binds a customer id iff none is bound,
	// and returns whichever id is bound afterwards (this call's or the winner's).
	ClaimUserStripeCustomerID(ctx context.Context, userID, customerID string) (string, error)
	GetUserBillingIdentity(ctx context.Context, userID string) (email, displayName string, err error)

	UpsertUserPaymentMethod(ctx context.Context, userID, stripeCustomerID string, pm domain.PaymentMethod) error
	SetDefaultUserPaymentMethod(ctx context.Context, userID, stripePaymentMethodID string) error
	ListUserPaymentMethods(ctx context.Context, userID string) ([]domain.PaymentMethod, error)
	GetDefaultUserPaymentMethod(ctx context.Context, userID string) (string, error)
	SoftDeleteUserPaymentMethod(ctx context.Context, userID, stripePaymentMethodID string) error
	FindUserByStripeCustomerID(ctx context.Context, stripeCustomerID string) (string, error)
	FindUserByPaymentMethodID(ctx context.Context, stripePaymentMethodID string) (string, error)
}

// CustomerProvisioner lazily creates and records exactly one Stripe Customer per
// platform user.
//
// ---------------------------------------------------------------------------
// ORDERING: why Stripe-first, and not reserve-first
// ---------------------------------------------------------------------------
//
// The failure we must never produce is a Customer that exists at Stripe which we
// have no record of: it is invisible to us, it may accumulate the user's saved
// cards, and nothing will ever charge it or delete it (including the GDPR
// erasure path, which enumerates from our DB).
//
// Reserve-first is not available. "Reserve" would mean writing a row before the
// Stripe call, but the value we would write — the cus_ id — does not exist until
// Stripe mints it. The alternative, a placeholder + later fill-in, converts one
// failure mode into a worse one: a crash between the two writes leaves a row
// claiming provisioning is in progress with no id and no way to tell whether
// Stripe was reached, which is exactly the ambiguity we are trying to remove.
//
// So: Stripe first, DB second, with three defenses that together make the orphan
// window closed rather than merely narrow:
//
//	1. DETERMINISTIC IDEMPOTENCY KEY, derived from the platform user id alone
//	   (CreateStripeCustomer). This is what makes the ordering safe. If the DB
//	   write fails or the process dies after Stripe returns, the next attempt
//	   sends the SAME key and Stripe returns the SAME Customer — the orphan
//	   re-adopts itself. Concurrency is likewise resolved AT STRIPE: N racing
//	   callers all send one key and all receive one object, so N goroutines
//	   cannot create N Customers no matter how the DB race resolves.
//
//	2. GUARDED DB CLAIM (ClaimUserStripeCustomerID). UPDATE ... WHERE
//	   stripe_customer_id IS NULL. Exactly one writer wins; every loser is handed
//	   the winner's id and adopts it. Backed by a partial UNIQUE index so two
//	   users can never point at one Customer.
//
//	3. SEARCH RECONCILIATION (FindStripeCustomerByUser), consulted before
//	   creating. Stripe idempotency keys expire after 24 HOURS, so defense (1)
//	   does not cover an orphan older than that. Search by metadata does. It is
//	   eventually consistent and therefore useless for the concurrent case, which
//	   is precisely why it complements rather than replaces the key.
//
// RESIDUAL RISK, stated plainly: if Stripe creates the Customer and the response
// is lost, AND the process dies, AND more than 24h passes, AND Stripe's search
// index does not return the object, a duplicate is created. Defenses 1 and 3
// cover disjoint time windows with no gap between them, so reaching this
// requires search to be actively wrong rather than merely lagging. When it does
// happen, the loser's Customer is orphaned but harmless: no card is ever attached
// to it, because every card is attached through the id returned by this function,
// which is always the DB winner.
type CustomerProvisioner struct {
	dir    CustomerDirectory
	stripe *StripeService

	// inflight collapses concurrent provisioning of the SAME user within THIS
	// process to a single Stripe call. Purely an efficiency and blast-radius
	// guard: correctness comes from the deterministic idempotency key and the
	// guarded DB claim above, both of which hold across processes where this
	// map cannot. Keyed by user id so unrelated users never serialize.
	mu       sync.Mutex
	inflight map[string]*provisionCall
}

// provisionCall is one in-flight provisioning attempt that later arrivals wait
// on instead of duplicating.
type provisionCall struct {
	done sync.WaitGroup
	id   string
	err  error
}

// NewCustomerProvisioner constructs a provisioner.
func NewCustomerProvisioner(dir CustomerDirectory, stripe *StripeService) *CustomerProvisioner {
	return &CustomerProvisioner{
		dir:      dir,
		stripe:   stripe,
		inflight: make(map[string]*provisionCall),
	}
}

// Lookup returns the user's Stripe Customer id WITHOUT creating one.
//
// Returns ("", nil) when the user has none. Read paths must use this, never
// EnsureCustomer: a GET (list my cards) that provisions a Stripe object as a
// side effect would mint a Customer for every user who ever opens the billing
// page, including ones who never save a card.
func (p *CustomerProvisioner) Lookup(ctx context.Context, userID string) (string, error) {
	if userID == "" {
		return "", fmt.Errorf("lookup stripe customer: user id required")
	}
	return p.dir.GetUserStripeCustomerID(ctx, userID)
}

// EnsureCustomer returns the user's Stripe Customer id, creating and recording
// one if necessary. Safe to call concurrently and repeatedly.
func (p *CustomerProvisioner) EnsureCustomer(ctx context.Context, userID string) (string, error) {
	if userID == "" {
		return "", fmt.Errorf("ensure stripe customer: user id required")
	}

	// Fast path: already provisioned. This is the overwhelmingly common case and
	// costs one indexed read with no Stripe call and no locking.
	if existing, err := p.dir.GetUserStripeCustomerID(ctx, userID); err != nil {
		return "", fmt.Errorf("ensure stripe customer: %w", err)
	} else if existing != "" {
		return existing, nil
	}

	// Slow path: collapse concurrent first-time provisioning for this user.
	p.mu.Lock()
	if call, ok := p.inflight[userID]; ok {
		p.mu.Unlock()
		call.done.Wait()
		return call.id, call.err
	}
	call := &provisionCall{}
	call.done.Add(1)
	p.inflight[userID] = call
	p.mu.Unlock()

	call.id, call.err = p.provision(ctx, userID)

	p.mu.Lock()
	delete(p.inflight, userID)
	p.mu.Unlock()
	call.done.Done()

	return call.id, call.err
}

// provision performs one first-time provisioning attempt. Callers are
// serialized per user by EnsureCustomer.
func (p *CustomerProvisioner) provision(ctx context.Context, userID string) (string, error) {
	// Re-check under the in-process lock: a racer that we queued behind may have
	// just finished and committed. Cheap, and avoids a pointless Stripe call.
	if existing, err := p.dir.GetUserStripeCustomerID(ctx, userID); err != nil {
		return "", fmt.Errorf("ensure stripe customer: %w", err)
	} else if existing != "" {
		return existing, nil
	}

	email, displayName, err := p.dir.GetUserBillingIdentity(ctx, userID)
	if err != nil {
		// A user we cannot identify is a user we must not bill. Fail closed
		// rather than create an unlabelled Customer nobody can reconcile.
		return "", fmt.Errorf("ensure stripe customer: %w", err)
	}

	// Defense 3: adopt an orphan from a previous attempt whose idempotency key
	// has since expired. A search failure is NOT fatal — the index is a
	// convenience, and the deterministic key still covers the 24h window — so we
	// log and continue to create.
	adopted, searchErr := p.stripe.FindStripeCustomerByUser(ctx, userID)
	if searchErr != nil {
		slog.WarnContext(ctx, "stripe customer search failed during provisioning; falling through to create",
			"user_id", userID, "error", searchErr)
	} else if adopted != "" {
		slog.InfoContext(ctx, "adopted pre-existing stripe customer for user",
			"user_id", userID, "stripe_customer_id", adopted)
		return p.claim(ctx, userID, adopted)
	}

	// Defenses 1: deterministic key, so racing processes and retried attempts
	// all converge on one Customer.
	created, err := p.stripe.CreateStripeCustomer(ctx, userID, email, displayName)
	if err != nil {
		return "", fmt.Errorf("ensure stripe customer: %w", err)
	}

	return p.claim(ctx, userID, created)
}

// claim records the customer id and returns the value that actually won.
func (p *CustomerProvisioner) claim(ctx context.Context, userID, candidate string) (string, error) {
	winner, err := p.dir.ClaimUserStripeCustomerID(ctx, userID, candidate)
	if err != nil {
		// The Customer exists at Stripe but we could not record it. This is the
		// orphan case, and it is RECOVERABLE, not lost: the next call replays the
		// same deterministic idempotency key (<24h) or finds the object by
		// metadata search (>24h) and adopts it. Log loudly with the id so an
		// operator can reconcile immediately rather than waiting for the retry.
		slog.ErrorContext(ctx, "created stripe customer but failed to record it; will be re-adopted on retry",
			"user_id", userID,
			"stripe_customer_id", candidate,
			"error", err,
		)
		return "", fmt.Errorf("ensure stripe customer: record: %w", err)
	}
	if winner != candidate {
		// A concurrent writer in ANOTHER process won. With the deterministic key
		// this should be the same id anyway; if it is not, the two attempts
		// straddled the 24h key expiry. Adopt the winner and report the loser so
		// it can be cleaned up. Never return the loser: cards must all attach to
		// the one id of record.
		slog.WarnContext(ctx, "lost stripe customer provisioning race; adopting winner",
			"user_id", userID,
			"winner_stripe_customer_id", winner,
			"orphaned_stripe_customer_id", candidate,
		)
	}
	return winner, nil
}

// --- Payment method persistence ---

// RecordConfirmedPaymentMethod persists a payment method confirmed by a
// SetupIntent and makes it the user's default.
//
// Idempotent end to end, which it must be: it is driven by BOTH the
// setup_intent.succeeded event (which Stripe redelivers) and the synchronous
// confirmation fast path, so the same method routinely arrives twice. The DB
// upsert keys on the pm_ id and the Stripe default-update carries a
// deterministic idempotency key, so a second arrival is a no-op rather than a
// duplicate row or a flapping default.
//
// Ordering is DB-then-Stripe, the opposite of provisioning, and deliberately so.
// Here the recoverable direction is reversed: a card recorded locally but not
// yet defaulted at Stripe is visible, listable and fixable on the next pass,
// whereas a card defaulted at Stripe that we have no row for is invisible to the
// fail-closed chargeability check and would silently never be used.
func (p *CustomerProvisioner) RecordConfirmedPaymentMethod(ctx context.Context, userID, stripeCustomerID, paymentMethodID string) error {
	if userID == "" || stripeCustomerID == "" || paymentMethodID == "" {
		return fmt.Errorf("record confirmed payment method: user id, customer id and payment method id are required")
	}

	// Read the display fields. A failure here must not lose the method: persist
	// what we know (the id, which is the only field that matters for charging)
	// and let a later pass enrich it.
	pm, err := p.stripe.GetPaymentMethod(ctx, paymentMethodID)
	if err != nil {
		slog.WarnContext(ctx, "could not read payment method details; persisting id only",
			"user_id", userID, "payment_method_id", paymentMethodID, "error", err)
		pm = domain.PaymentMethod{ID: paymentMethodID, Type: "card"}
	}
	if pm.ID == "" {
		pm.ID = paymentMethodID
	}

	if err := p.dir.UpsertUserPaymentMethod(ctx, userID, stripeCustomerID, pm); err != nil {
		return fmt.Errorf("record confirmed payment method: %w", err)
	}

	if err := p.dir.SetDefaultUserPaymentMethod(ctx, userID, pm.ID); err != nil {
		return fmt.Errorf("record confirmed payment method: set local default: %w", err)
	}

	if err := p.stripe.SetCustomerDefaultPaymentMethod(ctx, stripeCustomerID, pm.ID); err != nil {
		// Local state is correct and the method is attached and chargeable — we
		// always pass an explicit PaymentMethod on off-session confirms rather
		// than relying on the Stripe-side default, so this does NOT block
		// charging. Log and succeed rather than fail a card the user just saved.
		slog.WarnContext(ctx, "recorded payment method locally but failed to set stripe-side default",
			"user_id", userID,
			"stripe_customer_id", stripeCustomerID,
			"payment_method_id", pm.ID,
			"error", err,
		)
	}

	slog.InfoContext(ctx, "payment method saved for user",
		"user_id", userID,
		"stripe_customer_id", stripeCustomerID,
		"payment_method_id", pm.ID,
		"brand", pm.Brand,
		"last_four", pm.LastFour,
	)
	return nil
}

// DefaultPaymentMethod returns the pm_ id to charge off-session, or "" when the
// user has none.
//
// Reads LOCAL state on purpose. This is the fail-closed chargeability gate: on a
// cron sweeping a batch of orders, "" must mean "do not charge", and that answer
// has to be available from our own database rather than depending on a third
// party being reachable.
func (p *CustomerProvisioner) DefaultPaymentMethod(ctx context.Context, userID string) (string, error) {
	if userID == "" {
		return "", fmt.Errorf("default payment method: user id required")
	}
	return p.dir.GetDefaultUserPaymentMethod(ctx, userID)
}
