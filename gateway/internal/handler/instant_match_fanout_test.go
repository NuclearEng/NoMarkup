package handler

import (
	"testing"
	"time"

	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
)

func TestLoadInstantJobMatchContext_categoriesFromJob(t *testing.T) {
	t.Parallel()
	h := &InstantMatchHandler{} // nil db — categories only from proto
	job := &jobv1.Job{
		Category:    &jobv1.ServiceCategory{Id: "11111111-1111-4111-8111-111111111111"},
		Subcategory: &jobv1.ServiceCategory{Id: "22222222-2222-4222-8222-222222222222"},
	}
	ctx := h.loadInstantJobMatchContext(t.Context(), "job-1", job)
	if len(ctx.CategoryIDs) != 2 {
		t.Fatalf("category ids=%v want 2", ctx.CategoryIDs)
	}
	if ctx.HasGeo {
		t.Fatal("nil db must not invent geo")
	}
}

func TestLoadInstantJobMatchContext_emptyJob(t *testing.T) {
	t.Parallel()
	h := &InstantMatchHandler{}
	ctx := h.loadInstantJobMatchContext(t.Context(), "", nil)
	if ctx.HasGeo || len(ctx.CategoryIDs) != 0 {
		t.Fatalf("empty job want empty context, got %+v", ctx)
	}
}

func TestNotifyInstantOfferToProviders_nilDB(t *testing.T) {
	t.Parallel()
	h := &InstantMatchHandler{}
	n := h.notifyInstantOfferToProviders(
		t.Context(),
		"cust",
		"job",
		"Title",
		5000,
		time.Now().Add(15*time.Minute),
		instantJobMatchContext{HasGeo: true, Lat: 47.6, Lng: -122.3},
	)
	if n != 0 {
		t.Fatalf("nil db want 0 notified, got %d", n)
	}
}

func TestProviderMatchesInstantJob_nilDBFailOpen(t *testing.T) {
	t.Parallel()
	h := &InstantMatchHandler{}
	if !h.providerMatchesInstantJob(t.Context(), "provider-1", instantJobMatchContext{
		HasGeo:      true,
		Lat:         47.6,
		Lng:         -122.3,
		CategoryIDs: []string{"11111111-1111-4111-8111-111111111111"},
	}) {
		t.Fatal("nil db must fail-open so schedule-only tests still list offers")
	}
}

func TestProviderMatchesInstantJob_emptyProvider(t *testing.T) {
	t.Parallel()
	h := &InstantMatchHandler{}
	if h.providerMatchesInstantJob(t.Context(), "", instantJobMatchContext{}) {
		t.Fatal("empty provider must not match")
	}
}
