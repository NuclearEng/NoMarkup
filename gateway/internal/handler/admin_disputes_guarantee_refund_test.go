package handler

import (
	"testing"
)

func TestGuaranteeRefundError(t *testing.T) {
	t.Parallel()
	err := &guaranteeRefundError{status: 409, message: "no refundable payment"}
	if err.Error() != "no refundable payment" {
		t.Fatalf("Error() = %q", err.Error())
	}
	if err.status != 409 {
		t.Fatalf("status = %d", err.status)
	}
}

func TestNewAdminDisputesHandler_acceptsNilPaymentClient(t *testing.T) {
	t.Parallel()
	h := NewAdminDisputesHandler(nil, nil, nil)
	if h == nil {
		t.Fatal("expected handler")
	}
	if h.paymentClient != nil {
		t.Fatal("expected nil payment client")
	}
}

func TestAllocateGuaranteeRefunds_singlePayment(t *testing.T) {
	t.Parallel()
	payments := []refundablePayment{{ID: "p1", Remaining: 10000, Status: "escrow"}}
	got, err := allocateGuaranteeRefunds(payments, 4000)
	if err != nil {
		t.Fatalf("unexpected err: %+v", err)
	}
	if len(got) != 1 || got[0].ID != "p1" || got[0].Remaining != 4000 {
		t.Fatalf("got %+v", got)
	}
}

func TestAllocateGuaranteeRefunds_multiPaymentOldestFirst(t *testing.T) {
	t.Parallel()
	payments := []refundablePayment{
		{ID: "old", Remaining: 3000, Status: "released"},
		{ID: "new", Remaining: 8000, Status: "escrow"},
	}
	got, err := allocateGuaranteeRefunds(payments, 5000)
	if err != nil {
		t.Fatalf("unexpected err: %+v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 slices, got %+v", got)
	}
	if got[0].ID != "old" || got[0].Remaining != 3000 {
		t.Fatalf("first slice: %+v", got[0])
	}
	if got[1].ID != "new" || got[1].Remaining != 2000 {
		t.Fatalf("second slice: %+v", got[1])
	}
}

func TestAllocateGuaranteeRefunds_underfunded(t *testing.T) {
	t.Parallel()
	payments := []refundablePayment{{ID: "p1", Remaining: 1000, Status: "escrow"}}
	_, err := allocateGuaranteeRefunds(payments, 5000)
	if err == nil || err.status != 400 {
		t.Fatalf("want 400 underfunded, got %+v", err)
	}
}

func TestAllocateGuaranteeRefunds_empty(t *testing.T) {
	t.Parallel()
	_, err := allocateGuaranteeRefunds(nil, 100)
	if err == nil || err.status != 409 {
		t.Fatalf("want 409 empty, got %+v", err)
	}
}
