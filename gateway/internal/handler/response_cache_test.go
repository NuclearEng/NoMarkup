package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// wantPublicPolicy is the exact Cache-Control the §14 DATA-layer CDN cache
// depends on for the common (sMaxAge=60, swr=300) call pattern. stale-if-error
// is bounded relative to those windows (max(60*10, 300*2)=600), not a flat day.
// Asserted literally so a hit-rate regression fails loudly.
const wantPublicPolicy = "public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=600"

// strongETagRe matches a correctly-formed STRONG validator: a quoted opaque
// token with no `W/` weakness prefix. 32 hex chars = the first 16 bytes of the
// body's SHA-256.
var strongETagRe = regexp.MustCompile(`^"[0-9a-f]{32}"$`)

type cachePayload struct {
	Listings []string `json:"listings"`
}

func samplePayload() cachePayload {
	return cachePayload{Listings: []string{"a", "b", "c"}}
}

// authedRequest returns a request whose context carries resolved JWT claims,
// i.e. exactly what middleware.AuthMiddleware (or the router's optionalAuth
// wrapper) installs for a signed-in caller.
func authedRequest(t *testing.T, method, target string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	ctx := context.WithValue(req.Context(), middleware.ClaimsContextKey, &middleware.Claims{
		UserID: "11111111-1111-1111-1111-111111111111",
		Email:  "buyer@example.com",
		Roles:  []string{"customer"},
	})
	return req.WithContext(ctx)
}

// TestWriteCachedJSON_CachePolicyByIdentity is the core guard assertion:
// anonymous traffic keeps the public shared-cache policy verbatim, and anything
// the gateway has resolved to a user is downgraded to `private, no-store` —
// byte-identical to middleware.PrivateNoStore's authenticated default.
func TestWriteCachedJSON_CachePolicyByIdentity(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		// mutate shapes the incoming request.
		mutate func(t *testing.T, r *http.Request) *http.Request
		want   string
	}{
		{
			name:   "anonymous request keeps the public CDN policy",
			mutate: func(_ *testing.T, r *http.Request) *http.Request { return r },
			want:   wantPublicPolicy,
		},
		{
			name: "resolved JWT claims downgrade to private no-store",
			mutate: func(t *testing.T, _ *http.Request) *http.Request {
				return authedRequest(t, http.MethodGet, "/api/v1/listings")
			},
			want: privateCachePolicy,
		},
		{
			name: "refresh-token cookie downgrades to private no-store",
			mutate: func(_ *testing.T, r *http.Request) *http.Request {
				r.AddCookie(&http.Cookie{Name: refreshTokenCookieName, Value: "rt-value"})
				return r
			},
			want: privateCachePolicy,
		},
		{
			name: "empty refresh-token cookie is not treated as a credential",
			mutate: func(_ *testing.T, r *http.Request) *http.Request {
				r.AddCookie(&http.Cookie{Name: refreshTokenCookieName, Value: ""})
				return r
			},
			want: wantPublicPolicy,
		},
		{
			// DELIBERATE: the web client attaches a Bearer to every request once
			// logged in. Downgrading here would disable the edge cache for the
			// majority of catalog traffic and let a signed-in client's SWR refresh
			// evict a warm entry, regressing the anonymous hit rate.
			name: "bare Authorization header without resolved claims stays public",
			mutate: func(_ *testing.T, r *http.Request) *http.Request {
				r.Header.Set("Authorization", "Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig")
				return r
			},
			want: wantPublicPolicy,
		},
		{
			// DELIBERATE: has_session is a non-httpOnly constant with Path=/ that
			// carries no identity. It is present on every signed-in request.
			name: "has_session sentinel cookie stays public",
			mutate: func(_ *testing.T, r *http.Request) *http.Request {
				r.AddCookie(&http.Cookie{Name: sessionFlagCookieName, Value: "1"})
				return r
			},
			want: wantPublicPolicy,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			req := tc.mutate(t, httptest.NewRequest(http.MethodGet, "/api/v1/listings", nil))
			rec := httptest.NewRecorder()

			writeCachedJSON(rec, req, http.StatusOK, samplePayload(), 60, 300)

			res := rec.Result()
			t.Cleanup(func() { _ = res.Body.Close() })

			assert.Equal(t, http.StatusOK, res.StatusCode)
			assert.Equal(t, tc.want, res.Header.Get("Cache-Control"))
			assert.Equal(t, "application/json", res.Header.Get("Content-Type"))
			assert.Equal(t, []string{"Accept-Encoding"}, res.Header.Values("Vary"))
			assert.Regexp(t, strongETagRe, res.Header.Get("ETag"))

			// The body must be identical regardless of the cache decision — the
			// guard changes storability, never content.
			var got cachePayload
			require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
			assert.Equal(t, samplePayload(), got)

			if tc.want == privateCachePolicy {
				assert.NotContains(t, res.Header.Get("Cache-Control"), "public")
				assert.NotContains(t, res.Header.Get("Cache-Control"), "s-maxage")
			}
		})
	}
}

// TestWriteCachedJSON_BodyAndETagAreIdentityIndependent proves the body and the
// validator are a pure function of the value passed in — the guard must not
// fork the payload, or a CDN would serve a body that never matches its ETag.
func TestWriteCachedJSON_BodyAndETagAreIdentityIndependent(t *testing.T) {
	t.Parallel()

	anon := httptest.NewRequest(http.MethodGet, "/api/v1/listings", nil)
	anonRec := httptest.NewRecorder()
	writeCachedJSON(anonRec, anon, http.StatusOK, samplePayload(), 60, 300)

	authed := authedRequest(t, http.MethodGet, "/api/v1/listings")
	authedRec := httptest.NewRecorder()
	writeCachedJSON(authedRec, authed, http.StatusOK, samplePayload(), 60, 300)

	assert.Equal(t, anonRec.Body.String(), authedRec.Body.String())
	assert.Equal(t, anonRec.Header().Get("ETag"), authedRec.Header().Get("ETag"))
	assert.NotEqual(t, anonRec.Header().Get("Cache-Control"), authedRec.Header().Get("Cache-Control"))
}

// TestWriteCachedJSON_NoRequestInputBeyondURLAffectsResponse asserts the cache
// key invariant: nothing outside the URL may change the body, the validator, or
// the freshness policy. If it could, the response would need a Vary the CDN
// cannot express cheaply — and the entry would be poisonable by a header.
func TestWriteCachedJSON_NoRequestInputBeyondURLAffectsResponse(t *testing.T) {
	t.Parallel()

	base := httptest.NewRequest(http.MethodGet, "/api/v1/listings?page=1", nil)
	baseRec := httptest.NewRecorder()
	writeCachedJSON(baseRec, base, http.StatusOK, samplePayload(), 60, 300)

	headers := []struct {
		name  string
		key   string
		value string
	}{
		{"accept language", "Accept-Language", "de-DE"},
		{"device id", "X-Device-ID", "device-abc"},
		{"user agent", "User-Agent", "Mozilla/5.0 (crawler)"},
		{"forwarded for", "X-Forwarded-For", "203.0.113.9"},
		{"origin", "Origin", "https://evil.example"},
		{"session sentinel cookie", "Cookie", sessionFlagCookieName + "=1"},
		{"unknown analytics cookie", "Cookie", "_ga=GA1.2.3"},
	}

	for _, h := range headers {
		t.Run(h.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/api/v1/listings?page=1", nil)
			req.Header.Set(h.key, h.value)
			rec := httptest.NewRecorder()

			writeCachedJSON(rec, req, http.StatusOK, samplePayload(), 60, 300)

			assert.Equal(t, baseRec.Body.String(), rec.Body.String())
			assert.Equal(t, baseRec.Header().Get("ETag"), rec.Header().Get("ETag"))
			assert.Equal(t, baseRec.Header().Get("Cache-Control"), rec.Header().Get("Cache-Control"))
		})
	}
}

// TestWriteCachedJSON_ConditionalRequests covers the 304 path: it must emit no
// body, preserve the validator and the freshness policy so the client's stored
// copy is refreshed rather than orphaned, and must not fire where 304 is not a
// legal substitute for the real status.
func TestWriteCachedJSON_ConditionalRequests(t *testing.T) {
	t.Parallel()

	// The validator the helper produces for samplePayload(), computed once.
	seed := httptest.NewRecorder()
	writeCachedJSON(seed, httptest.NewRequest(http.MethodGet, "/x", nil), http.StatusOK, samplePayload(), 60, 300)
	etag := seed.Header().Get("ETag")
	require.Regexp(t, strongETagRe, etag)

	tests := []struct {
		name         string
		method       string
		code         int
		ifNoneMatch  string
		wantStatus   int
		wantBody     bool
		wantCacheHdr string
	}{
		{
			name:         "exact strong match returns 304",
			method:       http.MethodGet,
			code:         http.StatusOK,
			ifNoneMatch:  etag,
			wantStatus:   http.StatusNotModified,
			wantCacheHdr: wantPublicPolicy,
		},
		{
			name:         "weakened validator still matches (weak comparison)",
			method:       http.MethodGet,
			code:         http.StatusOK,
			ifNoneMatch:  "W/" + etag,
			wantStatus:   http.StatusNotModified,
			wantCacheHdr: wantPublicPolicy,
		},
		{
			name:         "wildcard matches",
			method:       http.MethodGet,
			code:         http.StatusOK,
			ifNoneMatch:  "*",
			wantStatus:   http.StatusNotModified,
			wantCacheHdr: wantPublicPolicy,
		},
		{
			name:         "match inside a comma separated list",
			method:       http.MethodGet,
			code:         http.StatusOK,
			ifNoneMatch:  `"deadbeef", ` + etag + `, "cafebabe"`,
			wantStatus:   http.StatusNotModified,
			wantCacheHdr: wantPublicPolicy,
		},
		{
			name:         "HEAD is also eligible",
			method:       http.MethodHead,
			code:         http.StatusOK,
			ifNoneMatch:  etag,
			wantStatus:   http.StatusNotModified,
			wantCacheHdr: wantPublicPolicy,
		},
		{
			name:         "non matching validator returns the body",
			method:       http.MethodGet,
			code:         http.StatusOK,
			ifNoneMatch:  `"00000000000000000000000000000000"`,
			wantStatus:   http.StatusOK,
			wantBody:     true,
			wantCacheHdr: wantPublicPolicy,
		},
		{
			name:         "absent If-None-Match returns the body",
			method:       http.MethodGet,
			code:         http.StatusOK,
			wantStatus:   http.StatusOK,
			wantBody:     true,
			wantCacheHdr: wantPublicPolicy,
		},
		{
			name:         "unsafe method never short-circuits to 304",
			method:       http.MethodPost,
			code:         http.StatusOK,
			ifNoneMatch:  etag,
			wantStatus:   http.StatusOK,
			wantBody:     true,
			wantCacheHdr: wantPublicPolicy,
		},
		{
			name:         "304 is not substituted for a non-200 status",
			method:       http.MethodGet,
			code:         http.StatusAccepted,
			ifNoneMatch:  etag,
			wantStatus:   http.StatusAccepted,
			wantBody:     true,
			wantCacheHdr: wantPublicPolicy,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(tc.method, "/api/v1/listings", nil)
			if tc.ifNoneMatch != "" {
				req.Header.Set("If-None-Match", tc.ifNoneMatch)
			}
			rec := httptest.NewRecorder()

			writeCachedJSON(rec, req, tc.code, samplePayload(), 60, 300)

			assert.Equal(t, tc.wantStatus, rec.Code)
			// A 304 must preserve the validator and the freshness policy so the
			// client can keep serving its stored copy.
			assert.Equal(t, etag, rec.Header().Get("ETag"))
			assert.Equal(t, tc.wantCacheHdr, rec.Header().Get("Cache-Control"))
			assert.Equal(t, []string{"Accept-Encoding"}, rec.Header().Values("Vary"))

			if tc.wantBody {
				assert.NotEmpty(t, rec.Body.String())
			} else {
				assert.Empty(t, rec.Body.String(), "304 must carry no body")
			}
		})
	}
}

// TestWriteCachedJSON_304UnderIdentityStaysPrivate proves the guard also holds
// on the conditional path — a 304 must not smuggle the public policy back in.
func TestWriteCachedJSON_304UnderIdentityStaysPrivate(t *testing.T) {
	t.Parallel()

	seed := httptest.NewRecorder()
	writeCachedJSON(seed, httptest.NewRequest(http.MethodGet, "/x", nil), http.StatusOK, samplePayload(), 60, 300)
	etag := seed.Header().Get("ETag")

	req := authedRequest(t, http.MethodGet, "/api/v1/listings")
	req.Header.Set("If-None-Match", etag)
	rec := httptest.NewRecorder()

	writeCachedJSON(rec, req, http.StatusOK, samplePayload(), 60, 300)

	assert.Equal(t, http.StatusNotModified, rec.Code)
	assert.Empty(t, rec.Body.String())
	assert.Equal(t, privateCachePolicy, rec.Header().Get("Cache-Control"))
	assert.Equal(t, etag, rec.Header().Get("ETag"))
}

// TestWriteCachedJSON_MarshalFailureIsNotCacheable guards the error path: a 500
// on a publicly-cacheable route must be explicitly unstorable, or an
// intermediary may hold it under RFC 9111 heuristic freshness.
func TestWriteCachedJSON_MarshalFailureIsNotCacheable(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/listings", nil)
	rec := httptest.NewRecorder()

	// A channel is not JSON-marshalable.
	writeCachedJSON(rec, req, http.StatusOK, map[string]interface{}{"c": make(chan int)}, 60, 300)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Equal(t, privateCachePolicy, rec.Header().Get("Cache-Control"))
	assert.Empty(t, rec.Header().Get("ETag"))
	assert.NotContains(t, rec.Body.String(), "chan")
}

// TestWriteCachedJSON_PreservesExistingVary asserts the helper appends to Vary
// rather than clobbering it. CORS middleware writes `Vary: Origin`; dropping it
// would let one origin's cached response be reused for another.
func TestWriteCachedJSON_PreservesExistingVary(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/listings", nil)
	rec := httptest.NewRecorder()
	rec.Header().Add("Vary", "Origin")

	writeCachedJSON(rec, req, http.StatusOK, samplePayload(), 60, 300)

	assert.Equal(t, []string{"Origin", "Accept-Encoding"}, rec.Header().Values("Vary"))
}

// TestETagIsStrongAndContentDerived pins the validator's shape and its coupling
// to the body. A weak validator would let a CDN serve a semantically-equivalent
// but different byte stream on a range/conditional request.
func TestETagIsStrongAndContentDerived(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		a, b interface{}
		same bool
	}{
		{"identical values share a validator", samplePayload(), samplePayload(), true},
		{"different values differ", samplePayload(), cachePayload{Listings: []string{"a", "b"}}, false},
		{"empty slice differs from nil slice", cachePayload{Listings: []string{}}, cachePayload{}, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			etagOf := func(v interface{}) string {
				rec := httptest.NewRecorder()
				writeCachedJSON(rec, httptest.NewRequest(http.MethodGet, "/x", nil), http.StatusOK, v, 60, 300)
				return rec.Header().Get("ETag")
			}

			ea, eb := etagOf(tc.a), etagOf(tc.b)
			assert.Regexp(t, strongETagRe, ea)
			assert.Regexp(t, strongETagRe, eb)
			assert.False(t, strings.HasPrefix(ea, "W/"), "validator must be strong")

			if tc.same {
				assert.Equal(t, ea, eb)
			} else {
				assert.NotEqual(t, ea, eb)
			}
		})
	}
}

// TestPublicCachePolicyDirectives pins every directive the CDN strategy relies
// on, per §14. A silent drop here is a hit-rate regression, not a style change.
func TestPublicCachePolicyDirectives(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		sMaxAge int
		swr     int
		want    string
	}{
		{"listing detail", 15, 60, "public, max-age=0, s-maxage=15, stale-while-revalidate=60, stale-if-error=150"},
		{"search results", 60, 300, wantPublicPolicy},
		// max(300*10, 3600*2)=7200, hard-capped at 3600.
		{"near static catalog", 300, 3600, "public, max-age=0, s-maxage=300, stale-while-revalidate=3600, stale-if-error=3600"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.want, publicCachePolicy(tc.sMaxAge, tc.swr))
		})
	}
}

// TestAnonymousCacheabilityMatrix is the hit-rate regression check. It walks
// every distinct (s-maxage, stale-while-revalidate) pair in use across the
// writeCachedJSON call sites and asserts that an anonymous request — the traffic
// the edge cache exists to serve — still receives the exact pre-guard policy.
// It also logs the emitted header for each so a before/after comparison is
// visible in CI output rather than inferred.
func TestAnonymousCacheabilityMatrix(t *testing.T) {
	t.Parallel()

	// The six pairs used across the call sites, from listing detail (15s) to
	// near-static catalog (300s).
	pairs := []struct {
		sMaxAge, swr int
	}{
		{15, 60}, {30, 120}, {30, 300}, {60, 300}, {300, 600}, {300, 3600},
	}

	for _, p := range pairs {
		t.Run(fmt.Sprintf("s-maxage=%d,swr=%d", p.sMaxAge, p.swr), func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/api/v1/listings", nil)
			rec := httptest.NewRecorder()
			writeCachedJSON(rec, req, http.StatusOK, samplePayload(), p.sMaxAge, p.swr)

			got := rec.Header().Get("Cache-Control")
			// Compute SIE independently of publicCachePolicy so a change to
			// that helper cannot make this assertion agree with itself. Must
			// stay in lockstep with staleIfErrorSeconds (max(s*10, swr*2), cap 1h).
			sie := p.sMaxAge * 10
			if alt := p.swr * 2; alt > sie {
				sie = alt
			}
			if sie > 3600 {
				sie = 3600
			}
			want := fmt.Sprintf(
				"public, max-age=0, s-maxage=%d, stale-while-revalidate=%d, stale-if-error=%d",
				p.sMaxAge, p.swr, sie,
			)
			t.Logf("anonymous Cache-Control: %s", got)
			assert.Equal(t, want, got)
			assert.Regexp(t, strongETagRe, rec.Header().Get("ETag"))
		})
	}
}

// TestEtagMatches exercises the weak-comparison matcher directly.
func TestEtagMatches(t *testing.T) {
	t.Parallel()

	const tag = `"abc123"`

	tests := []struct {
		name        string
		ifNoneMatch string
		want        bool
	}{
		{"empty header", "", false},
		{"wildcard", "*", true},
		{"exact", tag, true},
		{"surrounding whitespace", "  " + tag + "  ", true},
		{"weak request tag", `W/"abc123"`, true},
		{"list containing the tag", `"zzz", W/"abc123"`, true},
		{"different tag", `"zzz"`, false},
		{"unquoted value never matches", "abc123", false},
		{"prefix is not a match", `"abc12"`, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.want, etagMatches(tc.ifNoneMatch, tag))
		})
	}
}
