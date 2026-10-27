package router

import (
	"regexp"
	"strings"
	"testing"
)

// Cross-user authorization matrix (source-level, like the other *_mount_test
// files in this package). Every route registered in router.New must be one of:
//   - inside a group that mounts authMW.Handler via r.Use,
//   - registered with r.With(authMW.Handler, ...),
//   - wrapped in optionalAuth(...) (handler decides), or
//   - explicitly listed in publicHandlers below.
// Adding a new unauthenticated route therefore requires an explicit,
// reviewed edit to this allowlist.
//
// It also pins the {id} job mutations to RequireOwnership(jobOwner) and the
// /admin subtree to RequireAdmin.

var publicHandlers = map[string]bool{
	// health
	"healthHandler": true, "readinessHandler": true,
	// auth bootstrap (rate-limited TierAuth)
	"authHandler.Register": true, "authHandler.Login": true, "authHandler.Refresh": true,
	"authHandler.VerifyEmail": true, "authHandler.ResendVerification": true,
	"authHandler.RequestPasswordReset": true, "authHandler.ResetPassword": true,
	"authHandler.RegisterPhoneOnly": true, "authHandler.SendRegisterPhoneOTP": true,
	"authHandler.VerifyMFA": true, "authHandler.Logout": true,
	"oauthHandler.InitGoogleOAuth": true, "oauthHandler.GoogleOAuthCallback": true,
	"oauthHandler.InitAppleOAuth": true, "oauthHandler.AppleOAuthCallback": true,
	"oauthHandler.InitFacebookOAuth": true, "oauthHandler.FacebookOAuthCallback": true,
	"oauthHandler.NativeAppleSignIn": true, "oauthHandler.NativeGoogleSignIn": true,
	"oauthHandler.NativeFacebookSignIn": true, "oauthHandler.ExchangeOAuthMFAChallenge": true,
	"passkeyHandler.AssertOptions": true, "passkeyHandler.AssertVerify": true,
	// signature-verified webhooks
	"webhookHandler.HandleStripeWebhook": true, "webhookHandler.HandleSubscriptionWebhook": true,
	"backgroundCheckHandler.HandleWebhook": true,
	// signed-token unsubscribe, consent + RUM beacons
	"notificationHandler.Unsubscribe": true, "complianceHandler.LogCookieConsent": true,
	"rumHandler.PostSample": true, "listingsHandler.PingViewer": true, "jobHandler.PingViewerPublic": true,
	// public catalog / marketplace reads
	"categoriesHandler.List": true, "categoriesHandler.Tree": true,
	"categoryQuestionsHandler.ListByCategory": true, "marketsHandler.List": true,
	"jobHandler.Search": true, "jobHandler.MapView": true, "jobHandler.GetViewerCount": true,
	"bidHandler.GetBidCount": true, "trustHandler.GetTierRequirements": true,
	"subscriptionHandler.ListTiers": true, "subscriptionHandler.GetTier": true,
	"providerHandler.SearchProviders": true, "providerLicenseHandler.ListProviderVerifiedLicenses": true,
	"providerLicenseHandler.ListLegalCategories": true, "featureFlagHandler.GetFeatureFlags": true,
	"pricingHandler.GetPricingOverview": true, "pricingHandler.GetHeatmap": true,
	"pricingHandler.GetPricingByCategory": true, "auctionReplayHandler.GetAuctionReplay": true,
	"complianceHandler.GetCurrentToS": true, "listingsHandler.ListListings": true,
	"listingsSearchHandler.Autocomplete": true, "listingsSearchHandler.Similar": true,
	"listingsHandler.GetListing": true, "listingReplayHandler.GetListingReplay": true,
	"followsHandler.ListFollowers": true, "reviewHandler.ListReviewsForUser": true,
	"analyticsHandler.GetMarketRange": true, "analyticsHandler.GetFairPrice": true,
	"insuranceHandler.ListProducts": true, // flag-gated public product catalog
	// bearer-token gated in protectMetrics (localhost-only in prod without token)
	"protectMetrics": true,
	// WebSockets authenticate in-handler via extractWSToken + ValidateToken
	// (chat.go:929-939, auction_ws.go:43-47); spectator streams are PII-stripped.
	"chatHandler.WebSocket": true, "auctionWSHandler.WebSocket": true,
	"spectatorWSHandler.SpectateAuction": true, "marketplaceSpectatorWSHandler.Spectate": true,
}

var (
	routeCallRe = regexp.MustCompile(`\.(Get|Post|Put|Patch|Delete|Head|Options|Handle|HandleFunc|Method)\(\s*"`)
	stringLitRe = regexp.MustCompile("\"(?:[^\"\\\\]|\\\\.)*\"|`[^`]*`")
	handlerRe   = regexp.MustCompile(`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)(?:\([^()]*\))?\)\s*$`)
)

type routeReg struct {
	line    int
	stmt    string
	authed  bool // enclosing group mounts authMW
	admin   bool // enclosing group mounts RequireAdmin
	handler string
}

// collectRoutes walks router.New tracking brace depth so it knows which
// r.Route/r.Group blocks mount authMW.Handler / RequireAdmin.
func collectRoutes(t *testing.T, src string) []routeReg {
	t.Helper()
	start := strings.Index(src, "func New(")
	if start < 0 {
		t.Fatal("router.New not found")
	}
	body := src[start:]
	if end := strings.Index(body, "\nfunc "); end > 0 {
		body = body[:end]
	}
	lines := strings.Split(body, "\n")

	type frame struct{ authed, admin bool }
	stack := []frame{{}}
	var out []routeReg
	var pending string
	pendingLine := 0

	for i, raw := range lines {
		line := raw
		if idx := strings.Index(line, "//"); idx >= 0 && !strings.Contains(line[:idx], "\"") {
			line = line[:idx]
		}
		trimmed := strings.TrimSpace(line)
		cur := stack[len(stack)-1]
		if strings.Contains(trimmed, "r.Use(authMW.Handler)") {
			stack[len(stack)-1].authed = true
		}
		if strings.Contains(trimmed, "r.Use(middleware.RequireAdmin)") {
			stack[len(stack)-1].admin = true
		}

		// Assemble multi-line route statements (r.With(...).\n Get(...)).
		if pending != "" || routeCallRe.MatchString(trimmed) || strings.HasSuffix(trimmed, ").") {
			if pending == "" {
				pendingLine = i
			}
			pending += trimmed
			if !strings.HasSuffix(trimmed, ".") && !strings.HasSuffix(trimmed, "(") && !strings.HasSuffix(trimmed, ",") {
				if routeCallRe.MatchString(pending) && !strings.Contains(pending, "func(") {
					h := ""
					if m := handlerRe.FindStringSubmatch(pending); m != nil {
						h = m[1]
					}
					out = append(out, routeReg{line: pendingLine, stmt: pending, authed: cur.authed, admin: cur.admin, handler: h})
				}
				pending = ""
			}
		}

		bare := stringLitRe.ReplaceAllString(line, `""`)
		for _, c := range bare {
			switch c {
			case '{':
				top := stack[len(stack)-1]
				stack = append(stack, frame{authed: top.authed, admin: top.admin})
			case '}':
				if len(stack) > 1 {
					stack = stack[:len(stack)-1]
				}
			}
		}
	}
	return out
}

func TestEveryRouteIsAuthedOrExplicitlyPublic(t *testing.T) {
	t.Parallel()
	routes := collectRoutes(t, readRouterSource(t))
	if len(routes) < 300 {
		t.Fatalf("parsed only %d routes; parser is out of sync with router.go", len(routes))
	}
	for _, r := range routes {
		if r.authed || strings.Contains(r.stmt, "authMW.Handler") || strings.Contains(r.stmt, "optionalAuth(") {
			continue
		}
		name := r.handler
		if i := strings.Index(name, "("); i >= 0 {
			name = name[:i]
		}
		if publicHandlers[name] || strings.Contains(r.stmt, "protectMetrics(") {
			continue
		}
		t.Errorf("router.New+%d: route has no authMW and is not allowlisted as public: %s", r.line, r.stmt)
	}
}

func TestJobIDMutationsRequireOwnership(t *testing.T) {
	t.Parallel()
	src := readRouterSource(t)
	for _, h := range []string{"jobHandler.Update", "jobHandler.Delete", "jobHandler.Publish", "jobHandler.Close", "jobHandler.Cancel"} {
		if !strings.Contains(src, h) {
			continue // handler renamed/removed; other tests cover mounts
		}
		if !handlerHasMiddleware(src, h, "RequireOwnership(dbPool, jobOwner)") {
			t.Errorf("%s must be wrapped with RequireOwnership(dbPool, jobOwner)", h)
		}
	}
}

func TestAdminRoutesRequireAdmin(t *testing.T) {
	t.Parallel()
	for _, r := range collectRoutes(t, readRouterSource(t)) {
		if strings.Contains(r.handler, "admin") || strings.HasPrefix(r.handler, "Admin") {
			if !r.admin && !strings.Contains(r.stmt, "RequireAdmin") && !strings.Contains(r.stmt, "optionalAuth(") {
				t.Errorf("router.New+%d: admin handler outside RequireAdmin: %s", r.line, r.stmt)
			}
		}
	}
}

func TestPublicListingBidsUsesOptionalAuth(t *testing.T) {
	t.Parallel()
	if !strings.Contains(readRouterSource(t), `optionalAuth(authMW, listingsHandler.GetListingBids)`) {
		t.Fatal("GET /listings/{id}/bids must be wrapped in optionalAuth so anonymous viewers get masked bidders")
	}
}
