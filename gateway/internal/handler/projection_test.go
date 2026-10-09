package handler

// Regression guards for the two frontend<->gateway projection fixes:
//
//   - escrowToOrderStatus (commit 36194ae): maps the listing_orders.escrow_status
//     state machine onto the buyer-facing web lifecycle enum. An unknown value
//     MUST fall back to "pending", never "" (the order page renders the status,
//     so it can never be blank — that was the original crash).
//   - protoJobToJSON (commit dbb4ad4): must emit the FLAT category_id/
//     category_name/category_slug fields the web Job type reads, in addition to
//     the nested category object. Without them every job surface rendered an
//     empty category.

import (
	"testing"

	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
)

func TestEscrowToOrderStatus(t *testing.T) {
	t.Parallel()

	tests := []struct {
		escrow string
		want   string
	}{
		{"pending_payment", "pending"},
		{"held", "paid"},
		{"pickup_confirmed", "picked_up"},
		{"released", "completed"},
		{"disputed", "disputed"},
		{"refunded", "cancelled"},
		{"partially_refunded", "cancelled"},
		// Unknown / future DB value must fall back to a non-empty status.
		{"some_new_state", "pending"},
		{"", "pending"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.escrow, func(t *testing.T) {
			t.Parallel()
			got := escrowToOrderStatus(tt.escrow)
			if got != tt.want {
				t.Errorf("escrowToOrderStatus(%q) = %q, want %q", tt.escrow, got, tt.want)
			}
			if got == "" {
				t.Errorf("escrowToOrderStatus(%q) returned empty status — the page would render blank", tt.escrow)
			}
		})
	}
}

func TestProtoJobToJSON_FlatCategoryFields(t *testing.T) {
	t.Parallel()

	j := &jobv1.Job{
		Id:         "job-1",
		CustomerId: "cust-1",
		Title:      "Fix sink",
		Category: &jobv1.ServiceCategory{
			Id:   "cat-7",
			Name: "Plumbing",
			Slug: "plumbing",
			Icon: "wrench",
		},
	}

	out := protoJobToJSON(j)

	// The flat fields the web Job type reads must be present and correct.
	if got := out["category_id"]; got != "cat-7" {
		t.Errorf("category_id = %v, want cat-7", got)
	}
	if got := out["category_name"]; got != "Plumbing" {
		t.Errorf("category_name = %v, want Plumbing", got)
	}
	if got := out["category_slug"]; got != "plumbing" {
		t.Errorf("category_slug = %v, want plumbing", got)
	}

	// The nested object must still be emitted (auction/replay terminals read it).
	nested, ok := out["category"].(map[string]interface{})
	if !ok {
		t.Fatalf("category nested object missing or wrong type: %T", out["category"])
	}
	if nested["slug"] != "plumbing" {
		t.Errorf("nested category slug = %v, want plumbing", nested["slug"])
	}
}

// TestProtoJobToJSON_NoCategoryOmitsFlatFields guards that a job with no category
// does not emit empty flat fields (they should be absent, not "").
func TestProtoJobToJSON_NoCategoryOmitsFlatFields(t *testing.T) {
	t.Parallel()

	j := &jobv1.Job{Id: "job-2", Title: "No category"}
	out := protoJobToJSON(j)

	if _, present := out["category_id"]; present {
		t.Errorf("category_id should be absent when the job has no category")
	}
	if _, present := out["category"]; present {
		t.Errorf("nested category should be absent when the job has no category")
	}
}
