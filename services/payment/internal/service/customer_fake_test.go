package service

import (
	"context"
	"fmt"
	"sync"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// fakeCustomerDirectory is an in-memory CustomerDirectory.
//
// It reproduces the two properties migrations 102/103 enforce in Postgres,
// because the provisioning contract is only meaningful if they hold:
//
//   - ClaimUserStripeCustomerID is a guarded compare-and-set under a mutex, so
//     of N racing claimants exactly one wins and every loser is handed the
//     winner's id — the behaviour of `UPDATE ... WHERE stripe_customer_id IS
//     NULL`.
//   - at most one default payment method per user, the behaviour of the partial
//     unique index idx_user_payment_methods_one_default.
//
// A fake that let both writers "win" would make the concurrency test pass
// vacuously.
type fakeCustomerDirectory struct {
	mu sync.Mutex

	customers map[string]string                  // userID -> cus_
	identities map[string][2]string              // userID -> {email, displayName}
	methods   map[string][]domain.PaymentMethod  // userID -> methods
	defaults  map[string]string                  // userID -> pm_

	// claimAttempts counts how many times a claim was attempted, so a test can
	// assert that racing callers really did contend rather than serialize by
	// accident.
	claimAttempts int
	// failClaim, when set, makes every claim fail — the "created at Stripe but
	// could not record it" orphan path.
	failClaim error
}

func newFakeCustomerDirectory() *fakeCustomerDirectory {
	return &fakeCustomerDirectory{
		customers:  make(map[string]string),
		identities: make(map[string][2]string),
		methods:    make(map[string][]domain.PaymentMethod),
		defaults:   make(map[string]string),
	}
}

// addUser registers a user so billing identity lookups succeed.
func (f *fakeCustomerDirectory) addUser(userID, email, displayName string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.identities[userID] = [2]string{email, displayName}
}

func (f *fakeCustomerDirectory) GetUserStripeCustomerID(_ context.Context, userID string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.identities[userID]; !ok {
		return "", domain.ErrPaymentNotFound
	}
	return f.customers[userID], nil
}

func (f *fakeCustomerDirectory) ClaimUserStripeCustomerID(_ context.Context, userID, customerID string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.claimAttempts++
	if f.failClaim != nil {
		return "", f.failClaim
	}
	if existing, ok := f.customers[userID]; ok && existing != "" {
		// Lost the race: hand back the winner, never the caller's candidate.
		return existing, nil
	}
	f.customers[userID] = customerID
	return customerID, nil
}

func (f *fakeCustomerDirectory) GetUserBillingIdentity(_ context.Context, userID string) (string, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id, ok := f.identities[userID]
	if !ok {
		return "", "", domain.ErrPaymentNotFound
	}
	return id[0], id[1], nil
}

func (f *fakeCustomerDirectory) UpsertUserPaymentMethod(_ context.Context, userID, _ string, pm domain.PaymentMethod) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, existing := range f.methods[userID] {
		if existing.ID == pm.ID {
			keep := f.methods[userID][i].IsDefault
			pm.IsDefault = keep
			f.methods[userID][i] = pm
			return nil
		}
	}
	f.methods[userID] = append(f.methods[userID], pm)
	return nil
}

func (f *fakeCustomerDirectory) SetDefaultUserPaymentMethod(_ context.Context, userID, pmID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	found := false
	for i := range f.methods[userID] {
		isTarget := f.methods[userID][i].ID == pmID
		// Exactly one default, mirroring the partial unique index.
		f.methods[userID][i].IsDefault = isTarget
		if isTarget {
			found = true
		}
	}
	if !found {
		return domain.ErrPaymentNotFound
	}
	f.defaults[userID] = pmID
	return nil
}

func (f *fakeCustomerDirectory) ListUserPaymentMethods(_ context.Context, userID string) ([]domain.PaymentMethod, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]domain.PaymentMethod, len(f.methods[userID]))
	copy(out, f.methods[userID])
	return out, nil
}

func (f *fakeCustomerDirectory) GetDefaultUserPaymentMethod(_ context.Context, userID string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.defaults[userID], nil
}

func (f *fakeCustomerDirectory) SoftDeleteUserPaymentMethod(_ context.Context, userID, pmID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	kept := f.methods[userID][:0]
	for _, m := range f.methods[userID] {
		if m.ID != pmID {
			kept = append(kept, m)
		}
	}
	f.methods[userID] = kept
	if f.defaults[userID] == pmID {
		delete(f.defaults, userID)
	}
	return nil
}

func (f *fakeCustomerDirectory) FindUserByStripeCustomerID(_ context.Context, customerID string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for userID, cus := range f.customers {
		if cus == customerID {
			return userID, nil
		}
	}
	return "", fmt.Errorf("no user for customer %s: %w", customerID, domain.ErrPaymentNotFound)
}

func (f *fakeCustomerDirectory) FindUserByPaymentMethodID(_ context.Context, pmID string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for userID, methods := range f.methods {
		for _, m := range methods {
			if m.ID == pmID {
				return userID, nil
			}
		}
	}
	return "", fmt.Errorf("no user for payment method %s: %w", pmID, domain.ErrPaymentNotFound)
}
