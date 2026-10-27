package handler

import "testing"

func TestMaskBiddersStablePseudonyms(t *testing.T) {
	bids := []listingBidJSON{
		{BidderID: "u-a", BidderDisplayName: "Alice"},
		{BidderID: "u-b", BidderDisplayName: "Bob"},
		{BidderID: "u-a", BidderDisplayName: "Alice"},
	}
	maskBidders(bids)
	want := []struct{ id, name string }{{"bidder-1", "Bidder 1"}, {"bidder-2", "Bidder 2"}, {"bidder-1", "Bidder 1"}}
	for i, w := range want {
		if bids[i].BidderID != w.id || bids[i].BidderDisplayName != w.name {
			t.Fatalf("row %d = %q/%q, want %q/%q", i, bids[i].BidderID, bids[i].BidderDisplayName, w.id, w.name)
		}
	}
	for _, b := range bids {
		if b.BidderID == "u-a" || b.BidderDisplayName == "Alice" {
			t.Fatal("real identity leaked")
		}
	}
}
