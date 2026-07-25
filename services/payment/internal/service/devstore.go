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
	}
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
	return pm
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
