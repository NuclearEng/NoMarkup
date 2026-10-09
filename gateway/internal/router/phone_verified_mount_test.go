package router

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// FR-1.9: transact mutations must sit behind RequirePhoneVerified. Browse,
// profile, and the OTP routes themselves must not — gating verify-phone would
// deadlock unverified users.
func TestRequirePhoneVerifiedMountedOnTransactRoutes(t *testing.T) {
	t.Parallel()

	src := readRouterSource(t)
	if !strings.Contains(src, "phoneVerified := middleware.RequirePhoneVerified(dbPool)") {
		t.Fatal("phoneVerified middleware is not constructed in router.New")
	}

	mustMount := []string{
		"bidHandler.PlaceBid",
		"bidHandler.AcceptOffer",
		"bidHandler.AwardBid",
		"bidBondHandler.CreateBidBond",
		"bidBondHandler.ConfirmBidBond",
		"listingsHandler.PlaceListingBid",
		"listingsHandler.BuyItNow",
		"offersHandler.UpdateOffer",
		"paymentHandler.CreatePayment",
		"paymentHandler.ProcessPayment",
		"paymentHandler.ReleasePayment",
		"listingOrdersHandler.PayOrder",
		"listingOrdersHandler.CancelUnpaidOrder",
		"contractTipHandler.Tip",
		"paymentHandler.InstantPayout",
		"paymentHandler.RefundPayment",
		"promotedListingsHandler.PromoteListing",
		"promotedListingsHandler.ConfirmPromotion",
		"offersHandler.CreateOffer",
		"installmentHandler.CreateInstallmentPlan",
		"insuranceHandler.PurchaseInsurance",
		"workingCapitalHandler.RequestAdvance",
		"workingCapitalHandler.RepayAdvance",
	}
	for _, handler := range mustMount {
		if !handlerHasMiddleware(src, handler, "phoneVerified") {
			t.Errorf("FR-1.9: %s is not wrapped with phoneVerified", handler)
		}
	}

	mustNotMount := []string{
		"jobHandler.Search",
		"jobHandler.GetJob",
		"listingsHandler.ListListings",
		"listingsHandler.GetListing",
		"listingsHandler.MyListings",
		"authHandler.VerifyPhone",
		"authHandler.SendPhoneOTP",
		"userHandler.GetMe",
		"userHandler.UpdateMe",
		"paymentHandler.ListPayments",
		"paymentHandler.GetPayment",
		"paymentHandler.ListPaymentMethods",
		"paymentHandler.CalculateFees",
		"offersHandler.ListOffersForListing",
		"listingOrdersHandler.GetOrder",
		"listingOrdersHandler.ListMyOrders",
	}
	for _, handler := range mustNotMount {
		if handlerHasMiddleware(src, handler, "phoneVerified") {
			t.Errorf("FR-1.9: %s must not require phone verification (browse/profile/OTP)", handler)
		}
	}
}

func readRouterSource(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	src, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "router.go"))
	if err != nil {
		t.Fatalf("read router.go: %v", err)
	}
	return string(src)
}

// handlerHasMiddleware reports whether every Chi registration of handlerName
// includes mwName in that registration's r.With/r.Verb chain. Sibling routes
// on the previous line (e.g. CreatePayment then ListPayments) must not leak.
func handlerHasMiddleware(src, handlerName, mwName string) bool {
	found := false
	searchFrom := 0
	for {
		idx := strings.Index(src[searchFrom:], handlerName)
		if idx < 0 {
			return found
		}
		abs := searchFrom + idx
		window := src[lastRouteStart(src[:abs]):abs]
		if strings.Contains(window, mwName) {
			found = true
		} else if found {
			// One registration has the middleware, a later one does not.
			return false
		}
		searchFrom = abs + len(handlerName)
	}
}

func lastRouteStart(prefix string) int {
	markers := []string{"r.With(", "r.Get(", "r.Head(", "r.Post(", "r.Patch(", "r.Put(", "r.Delete("}
	last := 0
	for _, m := range markers {
		if i := strings.LastIndex(prefix, m); i > last {
			last = i
		}
	}
	return last
}

func TestHandlerHasMiddleware_doesNotLeakFromSibling(t *testing.T) {
	t.Parallel()
	src := `
		r.With(phoneVerified).Post("/", paymentHandler.CreatePayment)
		r.Get("/", paymentHandler.ListPayments)
		r.With(phoneVerified, middleware.RequireIdempotencyKey(cacheClient)).
			Post("/{id}/pay", listingOrdersHandler.PayOrder)
		r.Get("/{id}", listingOrdersHandler.GetOrder)
`
	if !handlerHasMiddleware(src, "paymentHandler.CreatePayment", "phoneVerified") {
		t.Fatal("CreatePayment should be gated")
	}
	if handlerHasMiddleware(src, "paymentHandler.ListPayments", "phoneVerified") {
		t.Fatal("ListPayments must not inherit sibling With(phoneVerified)")
	}
	if !handlerHasMiddleware(src, "listingOrdersHandler.PayOrder", "phoneVerified") {
		t.Fatal("wrapped-line PayOrder should be gated")
	}
	if handlerHasMiddleware(src, "listingOrdersHandler.GetOrder", "phoneVerified") {
		t.Fatal("GetOrder must not inherit PayOrder's gate")
	}
}
