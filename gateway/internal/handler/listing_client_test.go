package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestIOSClient(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		header string
		want   bool
	}{
		{name: "ios", header: "ios", want: true},
		{name: "IOS", header: "IOS", want: true},
		{name: "padded", header: " ios ", want: true},
		{name: "empty", header: "", want: false},
		{name: "web", header: "web", want: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/listings", nil)
			req.Header.Set("X-NoMarkup-Client", tc.header)
			if got := iosClient(req); got != tc.want {
				t.Fatalf("iosClient(%q) = %v, want %v", tc.header, got, tc.want)
			}
		})
	}
}

func TestStripPaidPlacement(t *testing.T) {
	t.Parallel()

	until := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	l := listingJSON{IsPromoted: true, PromotedUntil: &until, Title: "keep"}
	stripPaidPlacement(&l)
	if l.IsPromoted {
		t.Fatal("IsPromoted still true")
	}
	if l.PromotedUntil != nil {
		t.Fatal("PromotedUntil still set")
	}
	if l.Title != "keep" {
		t.Fatalf("Title = %q, want keep", l.Title)
	}

	detail := listingDetailJSON{listingJSON: listingJSON{IsPromoted: true, PromotedUntil: &until}}
	stripPaidPlacement(&detail.listingJSON)
	if detail.IsPromoted || detail.PromotedUntil != nil {
		t.Fatal("listingDetailJSON embed still carries a paid placement")
	}

	stripPaidPlacement(nil)
}

func TestPromoteListingRejectsIOS(t *testing.T) {
	t.Parallel()
	assertPromotionClosedToIOS(t, func(h *PromotedListingsHandler, w http.ResponseWriter, r *http.Request) {
		h.PromoteListing(w, r)
	})
}

func TestConfirmPromotionRejectsIOS(t *testing.T) {
	t.Parallel()
	assertPromotionClosedToIOS(t, func(h *PromotedListingsHandler, w http.ResponseWriter, r *http.Request) {
		h.ConfirmPromotion(w, r)
	})
}

func assertPromotionClosedToIOS(t *testing.T, call func(*PromotedListingsHandler, http.ResponseWriter, *http.Request)) {
	t.Helper()
	h := NewPromotedListingsHandler(nil, nil)
	tests := []struct {
		name   string
		header string
		want   int
	}{
		{name: "ios", header: "ios", want: http.StatusForbidden},
		{name: "IOS", header: "IOS", want: http.StatusForbidden},
		{name: "padded", header: " ios ", want: http.StatusForbidden},
		{name: "empty", header: "", want: http.StatusServiceUnavailable},
		{name: "web", header: "web", want: http.StatusServiceUnavailable},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/listings/x/promote", nil)
			req.Header.Set("X-NoMarkup-Client", tc.header)
			rec := httptest.NewRecorder()
			call(h, rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d body=%s", rec.Code, tc.want, rec.Body.String())
			}
			const msg = "Listing promotion is not available in the iOS app."
			if tc.want == http.StatusForbidden && !strings.Contains(rec.Body.String(), msg) {
				t.Fatalf("body = %s, want message %q", rec.Body.String(), msg)
			}
			if tc.want != http.StatusForbidden && strings.Contains(rec.Body.String(), msg) {
				t.Fatalf("non-iOS body refused promotion: %s", rec.Body.String())
			}
		})
	}
}
