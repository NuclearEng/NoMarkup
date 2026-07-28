package service

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/nomarkup/nomarkup/services/notification/internal/domain"
)

// newAPNsTestDispatcher builds a PushDispatcher whose APNs provider points at
// a local test server, with a fresh ES256 key so bearerJWT signing works.
func newAPNsTestDispatcher(t *testing.T, handler http.Handler) *PushDispatcher {
	t.Helper()

	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	d := NewPushDispatcher("", "", nil)
	d.apns = &apnsProvider{
		keyID:    "KEYID123",
		teamID:   "TEAMID123",
		bundleID: "com.nomarkup.app",
		host:     srv.URL,
		key:      key,
		client:   srv.Client(),
	}
	d.apnsDevMode = false
	return d
}

func TestBuildAPNsPayload(t *testing.T) {
	t.Parallel()
	badge := 3
	raw, err := buildAPNsPayload(pushMessage{
		Title:     "Outbid",
		Body:      "Someone bid higher",
		ActionURL: "/listings/abc",
		NotifType: "bid_outbid",
		Badge:     &badge,
	})
	if err != nil {
		t.Fatalf("buildAPNsPayload: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	aps, ok := payload["aps"].(map[string]any)
	if !ok {
		t.Fatalf("missing aps: %v", payload)
	}
	alert, ok := aps["alert"].(map[string]any)
	if !ok {
		t.Fatalf("missing alert: %v", aps)
	}
	if alert["title"] != "Outbid" || alert["body"] != "Someone bid higher" {
		t.Fatalf("alert mismatch: %v", alert)
	}
	if aps["category"] != "bid_outbid" {
		t.Fatalf("category: got %v", aps["category"])
	}
	if int(aps["badge"].(float64)) != 3 {
		t.Fatalf("badge: got %v", aps["badge"])
	}
	if payload["action_url"] != "/listings/abc" {
		t.Fatalf("action_url: %v", payload["action_url"])
	}
	if payload["type"] != "bid_outbid" {
		t.Fatalf("type: %v", payload["type"])
	}
}

func TestAPNsCategory(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"bid_outbid":           "bid_outbid",
		"bid_awarded":          "bid_awarded",
		"auction_closing_soon": "auction_closing_soon",
		"contract_created":     "contract_created",
		"price_drop":           "",
		"":                     "",
	}
	for in, want := range cases {
		if got := apnsCategory(in); got != want {
			t.Errorf("apnsCategory(%q)=%q want %q", in, got, want)
		}
	}
}

func TestAPNsJWTAndProvider(t *testing.T) {
	t.Parallel()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})

	provider, err := newAPNsProvider(&APNsConfig{
		KeyID:      "KEYID123",
		TeamID:     "TEAMID123",
		BundleID:   "com.nomarkup.app",
		AuthKeyPEM: pemBytes,
		Production: false,
	})
	if err != nil {
		t.Fatalf("newAPNsProvider: %v", err)
	}
	if !strings.Contains(provider.host, "sandbox") {
		t.Fatalf("expected sandbox host, got %s", provider.host)
	}
	token, err := provider.bearerJWT()
	if err != nil {
		t.Fatalf("bearerJWT: %v", err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("jwt parts: %d", len(parts))
	}
	// Second call should reuse cached JWT.
	token2, err := provider.bearerJWT()
	if err != nil {
		t.Fatalf("bearerJWT 2: %v", err)
	}
	if token != token2 {
		t.Fatal("expected cached JWT to match")
	}
}

// TestBuildAPNsPayloadClassShaping covers the IOS-SYS.NT.3/NT.6 server half:
// interruption-level per type, sound omitted for the promotional class, and
// thread-id derived from the dispatched entity.
func TestBuildAPNsPayloadClassShaping(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		msg        pushMessage
		wantLevel  string
		wantSound  bool
		wantThread string
	}{
		{
			name:       "outbid is time-sensitive with listing thread",
			msg:        pushMessage{NotifType: "bid_outbid", EntityType: "listing", EntityID: "abc-123"},
			wantLevel:  "time-sensitive",
			wantSound:  true,
			wantThread: "listing:abc-123",
		},
		{
			name:      "closing soon is time-sensitive",
			msg:       pushMessage{NotifType: "auction_closing_soon"},
			wantLevel: "time-sensitive",
			wantSound: true,
		},
		{
			name:       "price drop is passive and silent",
			msg:        pushMessage{NotifType: "price_drop", EntityType: "listing", EntityID: "l1"},
			wantLevel:  "passive",
			wantSound:  false,
			wantThread: "listing:l1",
		},
		{
			name:      "welcome is passive and silent",
			msg:       pushMessage{NotifType: "welcome_day_1"},
			wantLevel: "passive",
			wantSound: false,
		},
		{
			name:       "nps survey is passive and silent",
			msg:        pushMessage{NotifType: "nps_survey", EntityType: "listing_order", EntityID: "o1"},
			wantLevel:  "passive",
			wantSound:  false,
			wantThread: "listing_order:o1",
		},
		{
			name:       "message is active with bare entity-id thread",
			msg:        pushMessage{NotifType: "new_message", EntityID: "conv-9"},
			wantLevel:  "active",
			wantSound:  true,
			wantThread: "conv-9",
		},
		{
			name:      "payment is active without thread",
			msg:       pushMessage{NotifType: "payment_received"},
			wantLevel: "active",
			wantSound: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			tt.msg.Title = "t"
			tt.msg.Body = "b"
			raw, err := buildAPNsPayload(tt.msg)
			if err != nil {
				t.Fatalf("buildAPNsPayload: %v", err)
			}
			var payload map[string]any
			if err := json.Unmarshal(raw, &payload); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			aps, ok := payload["aps"].(map[string]any)
			if !ok {
				t.Fatalf("missing aps: %v", payload)
			}
			if got := aps["interruption-level"]; got != tt.wantLevel {
				t.Errorf("interruption-level = %v, want %q", got, tt.wantLevel)
			}
			if _, hasSound := aps["sound"]; hasSound != tt.wantSound {
				t.Errorf("sound present = %v, want %v", hasSound, tt.wantSound)
			}
			thread, _ := aps["thread-id"].(string)
			if thread != tt.wantThread {
				t.Errorf("thread-id = %q, want %q", thread, tt.wantThread)
			}
		})
	}
}

// TestAPNsSendHeadersByClass verifies the wire headers: promotional pushes go
// out at apns-priority 5, transactional at 10, all as alert push type on the
// app topic (IOS-SYS.NT.3).
func TestAPNsSendHeadersByClass(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	var got http.Header
	d := newAPNsTestDispatcher(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		got = r.Header.Clone()
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))

	tests := []struct {
		notifType    string
		wantPriority string
	}{
		{"price_drop", "5"},
		{"welcome_day_1", "5"},
		{"nps_survey", "5"},
		{"bid_outbid", "10"},
		{"new_message", "10"},
	}

	for _, tt := range tests {
		if err := d.Send(context.Background(), pushMessage{
			DeviceToken: "aabbcc",
			Platform:    "ios",
			Title:       "t",
			Body:        "b",
			NotifType:   tt.notifType,
		}); err != nil {
			t.Fatalf("send %s: %v", tt.notifType, err)
		}
		mu.Lock()
		if p := got.Get("apns-priority"); p != tt.wantPriority {
			t.Errorf("%s: apns-priority = %q, want %q", tt.notifType, p, tt.wantPriority)
		}
		if pt := got.Get("apns-push-type"); pt != "alert" {
			t.Errorf("%s: apns-push-type = %q, want alert", tt.notifType, pt)
		}
		if topic := got.Get("apns-topic"); topic != "com.nomarkup.app" {
			t.Errorf("%s: apns-topic = %q, want com.nomarkup.app", tt.notifType, topic)
		}
		mu.Unlock()
	}
}

// TestSendMultipleReturnsStaleTokens covers the IOS-SYS.NT.4 wire half: only
// 410 Unregistered and 400 BadDeviceToken mark a token for pruning.
func TestSendMultipleReturnsStaleTokens(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		status    int
		body      string
		wantStale bool
	}{
		{"410 unregistered", http.StatusGone, `{"reason":"Unregistered"}`, true},
		{"400 bad device token", http.StatusBadRequest, `{"reason":"BadDeviceToken"}`, true},
		{"400 other reason", http.StatusBadRequest, `{"reason":"BadMessageId"}`, false},
		{"403 auth failure", http.StatusForbidden, `{"reason":"InvalidProviderToken"}`, false},
		{"500 server error", http.StatusInternalServerError, `{"reason":"InternalServerError"}`, false},
		{"410 unparseable body", http.StatusGone, `gone`, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			d := newAPNsTestDispatcher(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))

			sent, stale, errs := d.SendMultiple(context.Background(),
				[]domain.DeviceToken{{Token: "tok-a", Platform: "ios"}},
				pushMessage{Title: "t", Body: "b", NotifType: "bid_outbid"},
			)
			if sent != 0 {
				t.Fatalf("sent = %d, want 0", sent)
			}
			if len(errs) != 1 {
				t.Fatalf("errs = %v, want exactly 1", errs)
			}
			gotStale := len(stale) == 1 && stale[0] == "tok-a"
			if gotStale != tt.wantStale {
				t.Errorf("stale = %v, wantStale %v", stale, tt.wantStale)
			}
		})
	}
}

// TestSendMultipleSkipsLiveActivityTokens is the IOS-SYS.LA.3 safe half:
// ActivityKit tokens registered as platform "ios_live_activity" must never
// receive alert fan-out (neither APNs alert nor the FCM default branch).
func TestSendMultipleSkipsLiveActivityTokens(t *testing.T) {
	t.Parallel()

	d := NewPushDispatcher("", "", nil) // dev mode: real platforms "deliver"
	sent, stale, errs := d.SendMultiple(t.Context(), []domain.DeviceToken{
		{Token: "apns-tok", Platform: "ios"},
		{Token: "la-tok", Platform: "ios_live_activity"},
		{Token: "fcm-tok", Platform: "android"},
	}, pushMessage{Title: "t", Body: "b", NotifType: "bid_outbid"})

	if sent != 2 {
		t.Fatalf("sent = %d, want 2 (live-activity token must be excluded from alert fan-out)", sent)
	}
	if len(stale) != 0 || len(errs) != 0 {
		t.Fatalf("stale = %v errs = %v, want none", stale, errs)
	}
}

func TestPushDispatcherDevModeRouting(t *testing.T) {
	t.Parallel()
	d := NewPushDispatcher("", "", nil)
	if !d.fcmDevMode || !d.apnsDevMode {
		t.Fatal("expected both paths in dev mode")
	}
	// Dev mode never hits the network.
	if err := d.Send(t.Context(), pushMessage{
		DeviceToken: "aabbcc",
		Platform:    "ios",
		Title:       "t",
		Body:        "b",
	}); err != nil {
		t.Fatalf("ios dev send: %v", err)
	}
	if err := d.Send(t.Context(), pushMessage{
		DeviceToken: "fcm-token",
		Platform:    "android",
		Title:       "t",
		Body:        "b",
	}); err != nil {
		t.Fatalf("android dev send: %v", err)
	}
}
