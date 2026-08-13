package service

import (
	"context"
	"errors"
	"testing"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// TestDeletePaymentMethod_IDOR is a regression test for the security-audit
// 2026-04 finding: DeletePaymentMethod scoped only by payment_method_id let any
// user delete another user's card by id. The fix scopes deletion to the owner
// (customer_id). This exercises the real dev-mode StripeService + DevStore so it
// covers the same code path the running stack uses in dev.
func TestDeletePaymentMethod_IDOR(t *testing.T) {
	t.Parallel()

	const userA = "00000000-0000-0000-0000-00000000000a"
	const userB = "00000000-0000-0000-0000-00000000000b"

	svc := newTestPaymentService(&mockPaymentRepo{}, &mockStripeService{})
	ctx := context.Background()

	// User A adds a payment method.
	pmA, err := svc.AddDevPaymentMethod(ctx, userA, "visa", "4242", 12, 2030)
	if err != nil {
		t.Fatalf("A add payment method: %v", err)
	}

	// User B attempts to delete A's payment method by id — must be rejected as
	// not-found (no cross-user delete, no existence leak).
	if err := svc.DeletePaymentMethod(ctx, userB, pmA.ID); !errors.Is(err, domain.ErrPaymentNotFound) {
		t.Fatalf("B deleting A's method: want ErrPaymentNotFound, got %v", err)
	}

	// A's method must still exist after B's failed attempt.
	methods, err := svc.ListPaymentMethods(ctx, userA)
	if err != nil {
		t.Fatalf("list A methods: %v", err)
	}
	found := false
	for _, m := range methods {
		if m.ID == pmA.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("A's payment method was deleted by non-owner B (IDOR not closed)")
	}

	// The owner (A) can still delete their own method.
	if err := svc.DeletePaymentMethod(ctx, userA, pmA.ID); err != nil {
		t.Fatalf("A deleting own method: %v", err)
	}
	methods, err = svc.ListPaymentMethods(ctx, userA)
	if err != nil {
		t.Fatalf("list A methods after self-delete: %v", err)
	}
	for _, m := range methods {
		if m.ID == pmA.ID {
			t.Fatalf("A's own delete did not remove the method")
		}
	}
}

// TestSetDefaultPaymentMethod_IDOR: a caller cannot promote another user's
// saved card. Fail closed as not-found so the probe leaks neither existence
// nor ownership. The owner's default is left untouched.
func TestSetDefaultPaymentMethod_IDOR(t *testing.T) {
	t.Parallel()

	const userA = "00000000-0000-0000-0000-00000000000a"
	const userB = "00000000-0000-0000-0000-00000000000b"

	ss := &StripeService{devMode: true}
	svc := NewPaymentService(&mockPaymentRepo{}, ss)
	dir := newFakeCustomerDirectory()
	dir.addUser(userA, "a@example.com", "User A")
	dir.addUser(userB, "b@example.com", "User B")
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, ss))

	ctx := context.Background()
	if _, err := dir.ClaimUserStripeCustomerID(ctx, userA, "cus_a"); err != nil {
		t.Fatalf("claim A: %v", err)
	}
	if _, err := dir.ClaimUserStripeCustomerID(ctx, userB, "cus_b"); err != nil {
		t.Fatalf("claim B: %v", err)
	}

	pmA := domain.PaymentMethod{ID: "pm_a", Type: "card", Brand: "visa", LastFour: "4242"}
	pmB := domain.PaymentMethod{ID: "pm_b", Type: "card", Brand: "visa", LastFour: "5555"}
	if err := dir.UpsertUserPaymentMethod(ctx, userA, "cus_a", pmA); err != nil {
		t.Fatalf("upsert A: %v", err)
	}
	if err := dir.UpsertUserPaymentMethod(ctx, userB, "cus_b", pmB); err != nil {
		t.Fatalf("upsert B: %v", err)
	}
	if err := dir.SetDefaultUserPaymentMethod(ctx, userA, pmA.ID); err != nil {
		t.Fatalf("default A: %v", err)
	}
	if err := dir.SetDefaultUserPaymentMethod(ctx, userB, pmB.ID); err != nil {
		t.Fatalf("default B: %v", err)
	}

	if err := svc.SetDefaultPaymentMethod(ctx, userB, pmA.ID); !errors.Is(err, domain.ErrPaymentNotFound) {
		t.Fatalf("B defaulting A's method: want ErrPaymentNotFound, got %v", err)
	}

	gotA, err := dir.GetDefaultUserPaymentMethod(ctx, userA)
	if err != nil || gotA != pmA.ID {
		t.Fatalf("A's default mutated by B: got (%q, %v)", gotA, err)
	}
	gotB, err := dir.GetDefaultUserPaymentMethod(ctx, userB)
	if err != nil || gotB != pmB.ID {
		t.Fatalf("B's default flipped to a foreign card: got (%q, %v)", gotB, err)
	}
}

// TestSetDefaultPaymentMethod_tableIsSourceOfTruth: flipping default updates
// the local directory even when no Stripe Customer is provisioned. Ownership
// still fails closed; siblings lose is_default.
func TestSetDefaultPaymentMethod_tableIsSourceOfTruth(t *testing.T) {
	t.Parallel()

	const userID = "00000000-0000-0000-0000-00000000000a"

	ss := &StripeService{devMode: true}
	svc := NewPaymentService(&mockPaymentRepo{}, ss)
	dir := newFakeCustomerDirectory()
	dir.addUser(userID, "a@example.com", "User A")
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, ss))

	ctx := context.Background()
	visa := domain.PaymentMethod{ID: "pm_visa", Type: "card", Brand: "visa", LastFour: "4242"}
	mc := domain.PaymentMethod{ID: "pm_mc", Type: "card", Brand: "mastercard", LastFour: "5555"}
	if err := dir.UpsertUserPaymentMethod(ctx, userID, "cus_unused", visa); err != nil {
		t.Fatalf("upsert visa: %v", err)
	}
	if err := dir.UpsertUserPaymentMethod(ctx, userID, "cus_unused", mc); err != nil {
		t.Fatalf("upsert mc: %v", err)
	}
	if err := dir.SetDefaultUserPaymentMethod(ctx, userID, visa.ID); err != nil {
		t.Fatalf("seed default: %v", err)
	}

	if err := svc.SetDefaultPaymentMethod(ctx, userID, mc.ID); err != nil {
		t.Fatalf("set default to mastercard: %v", err)
	}
	got, err := dir.GetDefaultUserPaymentMethod(ctx, userID)
	if err != nil || got != mc.ID {
		t.Fatalf("default after flip: got (%q, %v), want %q", got, err, mc.ID)
	}
	methods, err := dir.ListUserPaymentMethods(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, m := range methods {
		wantDefault := m.ID == mc.ID
		if m.IsDefault != wantDefault {
			t.Fatalf("method %s is_default=%v, want %v", m.ID, m.IsDefault, wantDefault)
		}
	}

	if err := svc.SetDefaultPaymentMethod(ctx, userID, "pm_missing"); !errors.Is(err, domain.ErrPaymentNotFound) {
		t.Fatalf("unknown method: want ErrPaymentNotFound, got %v", err)
	}
	got, err = dir.GetDefaultUserPaymentMethod(ctx, userID)
	if err != nil || got != mc.ID {
		t.Fatalf("unknown-id probe mutated default: got (%q, %v)", got, err)
	}
}
