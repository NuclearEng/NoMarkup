package handler

import (
	"net/http"
	"strings"
)

// iosClient reports the native iOS app. Paid listing placement is a digital
// boost sold on the web; that client must not see it or buy it.
func iosClient(r *http.Request) bool {
	if r == nil {
		return false
	}
	client := strings.TrimSpace(r.Header.Get(noMarkupClientHeader))
	return strings.EqualFold(client, "ios")
}

// stripPaidPlacement clears a paid placement boost. listingDetailJSON embeds
// listingJSON, so detail responses pass &detail.listingJSON.
func stripPaidPlacement(l *listingJSON) {
	if l == nil {
		return
	}
	l.IsPromoted = false
	l.PromotedUntil = nil
}
