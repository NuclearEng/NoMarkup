package service

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"
)

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
