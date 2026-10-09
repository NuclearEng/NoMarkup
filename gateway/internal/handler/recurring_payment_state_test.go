package handler

import "testing"

func TestRecurringPaymentStatusIsFunded(t *testing.T) {
	t.Parallel()
	cases := []struct {
		status string
		want   bool
	}{
		{"escrow", true},
		{"released", true},
		{"completed", true},
		{"processing", true},
		{"pending", false},
		{"failed", false},
		{"refunded", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := recurringPaymentStatusIsFunded(tc.status); got != tc.want {
			t.Errorf("recurringPaymentStatusIsFunded(%q)=%v want %v", tc.status, got, tc.want)
		}
	}
}

func TestAttachRecurringInstancePaymentState_nilDBNoop(t *testing.T) {
	t.Parallel()
	h := &ContractHandler{} // db nil
	instances := []map[string]interface{}{
		{"id": "11111111-1111-4111-8111-111111111111", "status": "completed"},
	}
	h.attachRecurringInstancePaymentState(t.Context(), "22222222-2222-4222-8222-222222222222", instances)
	if _, ok := instances[0]["payment_funded"]; ok {
		t.Fatal("nil db must not invent payment_funded")
	}
}
