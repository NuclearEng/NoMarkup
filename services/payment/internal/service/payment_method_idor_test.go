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
