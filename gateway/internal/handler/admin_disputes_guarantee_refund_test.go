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
