package handler

import (
	"net/url"
	"testing"
)

// TestParsePagination_Clamps covers the gRPC-flavored helper used by the admin
// list endpoints (admin_verification.go). It previously accepted any positive
// page_size with no ceiling, and nothing clamped it downstream.
func TestParsePagination_Clamps(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		query        string
		wantPage     int32
		wantPageSize int32
	}{
		{name: "defaults when absent", query: "", wantPage: 1, wantPageSize: 20},
		{name: "honors in-range values", query: "page=3&page_size=50", wantPage: 3, wantPageSize: 50},
		{name: "accepts the exact ceilings", query: "page=10000&page_size=100", wantPage: 10000, wantPageSize: 100},
		{name: "clamps oversized page_size", query: "page_size=100000", wantPage: 1, wantPageSize: 100},
		{name: "clamps deep page number", query: "page=999999999", wantPage: 10000, wantPageSize: 20},
		{name: "clamps both at once", query: "page=999999999&page_size=999999999", wantPage: 10000, wantPageSize: 100},
		{name: "ignores zero and negative", query: "page=0&page_size=-5", wantPage: 1, wantPageSize: 20},
		{name: "ignores unparseable values", query: "page=abc&page_size=xyz", wantPage: 1, wantPageSize: 20},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			q, err := url.ParseQuery(tt.query)
			if err != nil {
				t.Fatalf("ParseQuery(%q): %v", tt.query, err)
			}
			got := parsePagination(q)
			if got.GetPage() != tt.wantPage {
				t.Errorf("page = %d, want %d", got.GetPage(), tt.wantPage)
			}
			if got.GetPageSize() != tt.wantPageSize {
				t.Errorf("page_size = %d, want %d", got.GetPageSize(), tt.wantPageSize)
			}
		})
	}
}

// TestParseDirectPagination_ClampsPage covers the pgx-direct helper. page_size
// was already clamped to the caller's maxSize; page was not, so a huge page
// number produced a huge OFFSET (a deep-pagination scan).
func TestParseDirectPagination_ClampsPage(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name                              string
		query                             string
		defaultPage, defaultSize, maxSize int
		wantPage, wantSize                int
	}{
		{
			name:  "defaults when absent",
			query: "", defaultPage: 1, defaultSize: 20, maxSize: 100,
			wantPage: 1, wantSize: 20,
		},
		{
			name:  "honors in-range values",
			query: "page=5&page_size=60", defaultPage: 1, defaultSize: 20, maxSize: 100,
			wantPage: 5, wantSize: 60,
		},
		{
			name:  "still clamps size to the caller's max",
			query: "page_size=5000", defaultPage: 1, defaultSize: 20, maxSize: 100,
			wantPage: 1, wantSize: 100,
		},
		{
			name:  "respects a caller max above the shared default",
			query: "page_size=5000", defaultPage: 1, defaultSize: 50, maxSize: 200,
			wantPage: 1, wantSize: 200,
		},
		{
			name:  "clamps deep page number",
			query: "page=2000000", defaultPage: 1, defaultSize: 20, maxSize: 100,
			wantPage: maxPageNumber, wantSize: 20,
		},
		{
			name:  "accepts the exact page ceiling",
			query: "page=10000", defaultPage: 1, defaultSize: 20, maxSize: 100,
			wantPage: 10000, wantSize: 20,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			q, err := url.ParseQuery(tt.query)
			if err != nil {
				t.Fatalf("ParseQuery(%q): %v", tt.query, err)
			}
			gotPage, gotSize := parseDirectPagination(q, tt.defaultPage, tt.defaultSize, tt.maxSize)
			if gotPage != tt.wantPage {
				t.Errorf("page = %d, want %d", gotPage, tt.wantPage)
			}
			if gotSize != tt.wantSize {
				t.Errorf("page_size = %d, want %d", gotSize, tt.wantSize)
			}
		})
	}
}

// TestPaginationCeilings pins the shared constants. They bound how much work a
// single request can ask the database for; a silent bump would reopen the hole.
func TestPaginationCeilings(t *testing.T) {
	t.Parallel()

	if maxPageSize != 100 {
		t.Errorf("maxPageSize = %d, want 100", maxPageSize)
	}
	if maxPageNumber != 10000 {
		t.Errorf("maxPageNumber = %d, want 10000", maxPageNumber)
	}
}
