package service

import (
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// DevStore is a process-local in-memory store backing dev-mode Stripe stubs
// so the app works end-to-end without real Stripe credentials. Non-persistent:
// data resets on service restart.
type DevStore struct {
	mu sync.RWMutex

	paymentMethods map[string][]domain.PaymentMethod // customerKey -> methods
	subscriptions  map[string]devSubscription        // subscriptionID -> record
	customerSubs   map[string]string                 // customerKey -> subscriptionID
	advances       map[string]devAdvance             // advanceID -> record
	advanceKeys    map[string]string                 // idempotencyKey -> transfer id (dedup)
	transferKeys   map[string]string                 // idempotencyKey -> transfer id (escrow release)
	refundKeys     map[string]string                 // idempotencyKey -> refund id
	captureKeys    map[string]string                 // idempotencyKey -> payment intent id
	payoutKeys     map[string]string                 // idempotencyKey -> payout id
	setupIntents   map[string]string                 // clientSecret -> customerKey

	// customers models Stripe's Customer object well enough to exercise the
	// provisioning contract: EnsureCustomer is idempotent per platform user, so
	// N racing goroutines observe exactly one id — the same guarantee the
	// deterministic Stripe idempotency key provides in production.
	customers map[string]string // platformUserID -> cus_ id

	// setupIntentCustomer records which cus_ a dev SetupIntent was minted
	// against, so confirmation can return a consistent (pm, customer) pair.
	setupIntentCustomer map[string]string // clientSecret -> cus_ id
	// setupIntentPM is the payment method a confirmed dev SetupIntent yields.
	// Allocated once per intent so repeated confirmation is idempotent.
	setupIntentPM map[string]string // clientSecret -> pm_ id

	// paymentMethodByID indexes every dev payment method by its pm_ id, so
	// GetPaymentMethod can return display fields the way Stripe does.
	paymentMethodByID map[string]domain.PaymentMethod
	// defaultPM mirrors customer.invoice_settings.default_payment_method.
	defaultPM map[string]string // cus_ id -> pm_ id

	// paymentIntents backs the off-session confirm path.
	paymentIntents map[string]*devPaymentIntent // pi id -> record
	// confirmKeys gives dev confirms Stripe's idempotency-key semantics: a
	// replayed key returns the ORIGINAL outcome, including an original failure.
	confirmKeys map[string]devConfirmResult

	// declineRules lets a test force a specific issuer outcome for a payment
	// method, so each distinct failure mode can be exercised end to end.
	declineRules map[string]error // pm_ id -> error to raise on confirm
}

// devPaymentIntent is the subset of a Stripe PaymentIntent the dev off-session
// confirm path needs. ClientSecret is stored so idempotent re-entry of
// ChargeListingWinner can hand the browser a usable secret on retry — Stripe
// returns it from PaymentIntent.Get; the order row only keeps the PI id.
type devPaymentIntent struct {
	ID           string
	CustomerID   string
	AmountCts    int64
	Status       string
	ClientSecret string
}

// devConfirmResult is a memoized confirm outcome keyed by idempotency key.
type devConfirmResult struct {
	status string
	err    error
}

type devSubscription struct {
	ID              string
	CustomerKey     string
	StripePriceID   string
	PaymentMethodID string
	CreatedAt       time.Time
}

type devAdvance struct {
	ID         string
	ProviderID string
	AmountCts  int64
	CreatedAt  time.Time
}

func newDevStore() *DevStore {
	return &DevStore{
		paymentMethods: make(map[string][]domain.PaymentMethod),
		subscriptions:  make(map[string]devSubscription),
		customerSubs:   make(map[string]string),
		advances:       make(map[string]devAdvance),
		advanceKeys:    make(map[string]string),
		transferKeys:   make(map[string]string),
		refundKeys:     make(map[string]string),
		captureKeys:    make(map[string]string),
		payoutKeys:     make(map[string]string),
		setupIntents:   make(map[string]string),

		customers:           make(map[string]string),
		setupIntentCustomer: make(map[string]string),
		setupIntentPM:       make(map[string]string),
		paymentMethodByID:   make(map[string]domain.PaymentMethod),
		defaultPM:           make(map[string]string),
		paymentIntents:      make(map[string]*devPaymentIntent),
		confirmKeys:         make(map[string]devConfirmResult),
		declineRules:        make(map[string]error),
	}
}

// --- Customers ---

// EnsureCustomer returns the dev Stripe Customer id for a platform user,
// allocating one on first call.
//
// Idempotent under concurrency by holding the write lock across the
// check-and-set: N goroutines racing on the same user observe exactly ONE id.
// That is the dev-mode analogue of the deterministic Stripe idempotency key in
// CreateStripeCustomer, and it is what makes the concurrency test meaningful
// rather than a test of the mutex alone.
func (d *DevStore) EnsureCustomer(platformUserID string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if existing, ok := d.customers[platformUserID]; ok {
		return existing
	}
	id := "cus_dev_" + uuid.NewString()
	d.customers[platformUserID] = id
	return id
}

// LookupCustomer returns the dev customer id for a user, or "" if none.
func (d *DevStore) LookupCustomer(platformUserID string) string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.customers[platformUserID]
}

// CustomerCount reports how many distinct customers were minted (test helper).
func (d *DevStore) CustomerCount() int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.customers)
}

// --- Payment methods ---

func (d *DevStore) AddPaymentMethod(customerKey, brand, last4 string, expMonth, expYear int32) domain.PaymentMethod {
	d.mu.Lock()
	defer d.mu.Unlock()
	pm := domain.PaymentMethod{
		ID:       "pm_dev_" + uuid.NewString(),
		Type:     "card",
		Brand:    brand,
		LastFour: last4,
		ExpMonth: expMonth,
		ExpYear:  expYear,
	}
	d.paymentMethods[customerKey] = append(d.paymentMethods[customerKey], pm)
	d.paymentMethodByID[pm.ID] = pm
	return pm
}

// GetPaymentMethod returns a dev payment method's display fields by id.
// Returns a bare card record for unknown ids, mirroring the fact that a real
// pm_ id is opaque and may predate this process.
func (d *DevStore) GetPaymentMethod(paymentMethodID string) domain.PaymentMethod {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if pm, ok := d.paymentMethodByID[paymentMethodID]; ok {
		return pm
	}
	return domain.PaymentMethod{ID: paymentMethodID, Type: "card"}
}

// SetDefaultPaymentMethod mirrors customer.invoice_settings.default_payment_method.
func (d *DevStore) SetDefaultPaymentMethod(customerStripeID, paymentMethodID string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.defaultPM[customerStripeID] = paymentMethodID
}

// DefaultPaymentMethod returns the dev customer's default method (test helper).
func (d *DevStore) DefaultPaymentMethod(customerStripeID string) string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.defaultPM[customerStripeID]
}

// SetDeclineRule makes a subsequent ConfirmPaymentIntent against paymentMethodID
// fail with err. Test-only: this is how each distinct issuer failure mode
// (declined, insufficient funds, SCA) is exercised end to end without Stripe.
// Passing a nil err clears the rule.
func (d *DevStore) SetDeclineRule(paymentMethodID string, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if err == nil {
		delete(d.declineRules, paymentMethodID)
		return
	}
	d.declineRules[paymentMethodID] = err
}

// --- Payment intents (off-session confirm) ---

// RecordPaymentIntent registers a dev PaymentIntent so it can later be confirmed
// and so its client_secret can be re-read on ChargeListingWinner re-entry.
// clientSecret may be empty for older call sites that only need confirm; the
// marketplace charge path always supplies one.
func (d *DevStore) RecordPaymentIntent(piID, customerStripeID string, amountCts int64, clientSecret string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if existing, ok := d.paymentIntents[piID]; ok {
		// Fill a secret if a later call knows it and the first registration did not.
		if existing.ClientSecret == "" && clientSecret != "" {
			existing.ClientSecret = clientSecret
		}
		return
	}
	d.paymentIntents[piID] = &devPaymentIntent{
		ID:           piID,
		CustomerID:   customerStripeID,
		AmountCts:    amountCts,
		Status:       "requires_payment_method",
		ClientSecret: clientSecret,
	}
}

// PaymentIntentClientSecret returns the stored client_secret for a dev PI, or
// "" if the intent is unknown / was recorded without one.
func (d *DevStore) PaymentIntentClientSecret(piID string) string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if pi, ok := d.paymentIntents[piID]; ok {
		return pi.ClientSecret
	}
	return ""
}

// ConfirmPaymentIntent simulates an off-session confirmation.
//
// Reproduces the two Stripe behaviours the settlement path depends on:
//
//   - Idempotency-key replay returns the ORIGINAL outcome, failures included.
//     This is why the production key must be attempt-scoped: an order-scoped key
//     would replay a decline forever and a buyer who fixed their card could
//     never pay.
//   - A decline leaves the intent in requires_payment_method (retryable), while
//     a success is terminal.
func (d *DevStore) ConfirmPaymentIntent(piID, paymentMethodID, idempotencyKey string) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if prior, ok := d.confirmKeys[idempotencyKey]; ok {
		return prior.status, prior.err
	}

	pi, ok := d.paymentIntents[piID]
	if !ok {
		// Unknown intent: register it so dev flows that skipped creation still
		// work, mirroring the permissiveness of the other dev stubs.
		pi = &devPaymentIntent{ID: piID, Status: "requires_payment_method"}
		d.paymentIntents[piID] = pi
	}

	if pi.Status == "succeeded" {
		// Already paid. Terminal and idempotent.
		d.confirmKeys[idempotencyKey] = devConfirmResult{status: "succeeded"}
		return "succeeded", nil
	}

	if ruleErr, ok := d.declineRules[paymentMethodID]; ok {
		d.confirmKeys[idempotencyKey] = devConfirmResult{err: ruleErr}
		return "", ruleErr
	}

	pi.Status = "succeeded"
	d.confirmKeys[idempotencyKey] = devConfirmResult{status: "succeeded"}
	return "succeeded", nil
}

// PaymentIntentStatus reports a dev intent's status (test helper).
func (d *DevStore) PaymentIntentStatus(piID string) string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if pi, ok := d.paymentIntents[piID]; ok {
		return pi.Status
	}
	return ""
}

func (d *DevStore) ListPaymentMethods(customerKey string) []domain.PaymentMethod {
	d.mu.RLock()
	defer d.mu.RUnlock()
	src := d.paymentMethods[customerKey]
	out := make([]domain.PaymentMethod, len(src))
	copy(out, src)
	return out
}

func (d *DevStore) DeletePaymentMethod(paymentMethodID string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	for key, methods := range d.paymentMethods {
		for i, pm := range methods {
			if pm.ID == paymentMethodID {
				d.paymentMethods[key] = append(methods[:i], methods[i+1:]...)
				return true
			}
		}
	}
	return false
}

// --- Setup intents ---

// NewSetupIntent allocates a dev client_secret bound to a customer key.
// The prefix "dev_seti_" is a sentinel the frontend recognizes to switch to
// the manual card-entry fallback (no Stripe.js).
func (d *DevStore) NewSetupIntent(customerKey string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	token := "dev_seti_" + uuid.NewString()
	d.setupIntents[token] = customerKey
	return token
}

// NewSetupIntentForCustomer allocates a dev client_secret bound to BOTH the
// platform user (for the ownership check in GetSetupIntentStatus) and the Stripe
// Customer the resulting card attaches to.
//
// The customer binding is the dev-mode counterpart of params.Customer in
// CreateSetupIntent: without it, a confirmed dev card would attach to nothing,
// which is precisely the production bug this work removes — so the stub must not
// be more forgiving than production.
func (d *DevStore) NewSetupIntentForCustomer(platformUserID, customerStripeID string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	token := "dev_seti_" + uuid.NewString()
	d.setupIntents[token] = platformUserID
	d.setupIntentCustomer[token] = customerStripeID
	return token
}

// ConfirmSetupIntent resolves a dev SetupIntent to its (paymentMethodID,
// customerID) pair, allocating and attaching the card on first call.
//
// Allocated ONCE per intent and memoized, so repeated confirmation — which
// happens routinely, since both the event handler and the synchronous fast path
// resolve the same intent — yields the same method rather than a new card each
// time.
func (d *DevStore) ConfirmSetupIntent(clientSecret string) (paymentMethodID, customerID string) {
	d.mu.Lock()
	defer d.mu.Unlock()

	customerID = d.setupIntentCustomer[clientSecret]
	if existing, ok := d.setupIntentPM[clientSecret]; ok {
		return existing, customerID
	}

	pm := domain.PaymentMethod{
		ID:       "pm_dev_" + uuid.NewString(),
		Type:     "card",
		Brand:    "visa",
		LastFour: "4242",
		ExpMonth: 12,
		ExpYear:  2030,
	}
	d.setupIntentPM[clientSecret] = pm.ID
	d.paymentMethodByID[pm.ID] = pm

	// Attach to the owning platform user's method list so dev ListPaymentMethods
	// (which is keyed by platform user id) sees it.
	if owner, ok := d.setupIntents[clientSecret]; ok && owner != "" {
		d.paymentMethods[owner] = append(d.paymentMethods[owner], pm)
	}
	if customerID != "" {
		d.paymentMethods[customerID] = append(d.paymentMethods[customerID], pm)
	}
	return pm.ID, customerID
}

// IsDevSetupIntent reports whether a client_secret was issued by DevStore.
func IsDevSetupIntent(clientSecret string) bool {
	return strings.HasPrefix(clientSecret, "dev_seti_")
}

// SetupIntentOwner returns the customer key a dev client_secret was minted
// for. Used by GetSetupIntentStatus so the dev path still enforces the
// intent-belongs-to-caller binding rather than approving any string.
func (d *DevStore) SetupIntentOwner(clientSecret string) (string, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	owner, ok := d.setupIntents[clientSecret]
	return owner, ok
}

// --- Subscriptions ---

func (d *DevStore) UpsertSubscription(customerKey, stripePriceID, paymentMethodID string) devSubscription {
	d.mu.Lock()
	defer d.mu.Unlock()
	if existingID, ok := d.customerSubs[customerKey]; ok {
		if sub, ok := d.subscriptions[existingID]; ok {
			sub.StripePriceID = stripePriceID
			if paymentMethodID != "" {
				sub.PaymentMethodID = paymentMethodID
			}
			d.subscriptions[existingID] = sub
			return sub
		}
	}
	sub := devSubscription{
		ID:              "sub_dev_" + uuid.NewString(),
		CustomerKey:     customerKey,
		StripePriceID:   stripePriceID,
		PaymentMethodID: paymentMethodID,
		CreatedAt:       time.Now().UTC(),
	}
	d.subscriptions[sub.ID] = sub
	d.customerSubs[customerKey] = sub.ID
	return sub
}

func (d *DevStore) UpdateSubscriptionPrice(subscriptionID, newPriceID string) (devSubscription, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	sub, ok := d.subscriptions[subscriptionID]
	if !ok {
		return devSubscription{}, false
	}
	sub.StripePriceID = newPriceID
	d.subscriptions[subscriptionID] = sub
	return sub, true
}

func (d *DevStore) CancelSubscription(subscriptionID string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	sub, ok := d.subscriptions[subscriptionID]
	if !ok {
		return false
	}
	delete(d.subscriptions, subscriptionID)
	delete(d.customerSubs, sub.CustomerKey)
	return true
}

// --- Advances ---

// RecordAdvance records a dev-mode platform transfer, deduped by idempotencyKey.
// A repeated (or racing) call with the same key returns the SAME transfer id and
// records nothing new — mirroring Stripe's idempotency-key semantics so the dev
// path exhibits the same no-double-payout guarantee as production.
func (d *DevStore) RecordAdvance(idempotencyKey, providerID string, amountCts int64) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if existing, ok := d.advanceKeys[idempotencyKey]; ok {
		return existing
	}
	id := "tr_platform_dev_" + uuid.NewString()
	d.advances[id] = devAdvance{
		ID:         id,
		ProviderID: providerID,
		AmountCts:  amountCts,
		CreatedAt:  time.Now().UTC(),
	}
	d.advanceKeys[idempotencyKey] = id
	return id
}

// AdvanceCount is the number of unique platform transfers recorded (tests).
func (d *DevStore) AdvanceCount() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.advances)
}

// RecordTransfer records a dev-mode escrow CreateTransfer, deduped by key.
func (d *DevStore) RecordTransfer(idempotencyKey, destination string, amountCts int64) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.transferKeys == nil {
		d.transferKeys = make(map[string]string)
	}
	if existing, ok := d.transferKeys[idempotencyKey]; ok {
		return existing
	}
	id := "tr_dev_" + uuid.NewString()
	d.transferKeys[idempotencyKey] = id
	return id
}

// TransferCount returns how many distinct transfer keys were recorded (test helper).
func (d *DevStore) TransferCount() int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.transferKeys)
}

// RecordRefund records a dev-mode refund, deduped by key.
func (d *DevStore) RecordRefund(idempotencyKey, paymentIntentID string, amountCts int64) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.refundKeys == nil {
		d.refundKeys = make(map[string]string)
	}
	if existing, ok := d.refundKeys[idempotencyKey]; ok {
		return existing
	}
	id := "re_dev_" + uuid.NewString()
	d.refundKeys[idempotencyKey] = id
	return id
}

// RefundCount returns how many distinct refund keys were recorded (test helper).
func (d *DevStore) RefundCount() int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.refundKeys)
}

// RecordCapture records a dev-mode capture, deduped by key. Returns error only
// for interface symmetry; always nil.
func (d *DevStore) RecordCapture(idempotencyKey, paymentIntentID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.captureKeys == nil {
		d.captureKeys = make(map[string]string)
	}
	if _, ok := d.captureKeys[idempotencyKey]; ok {
		return nil
	}
	d.captureKeys[idempotencyKey] = paymentIntentID
	return nil
}

// CaptureCount returns how many distinct capture keys were recorded (test helper).
func (d *DevStore) CaptureCount() int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.captureKeys)
}

// RecordPayout records a dev-mode instant payout, deduped by key.
func (d *DevStore) RecordPayout(idempotencyKey, accountID string, amountCts int64) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.payoutKeys == nil {
		d.payoutKeys = make(map[string]string)
	}
	if existing, ok := d.payoutKeys[idempotencyKey]; ok {
		return existing
	}
	id := "payout_dev_" + uuid.NewString()
	d.payoutKeys[idempotencyKey] = id
	return id
}
