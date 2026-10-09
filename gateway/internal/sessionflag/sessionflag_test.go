package sessionflag

import (
	"strings"
	"testing"
	"time"
)

func TestSignVerify_roundTrip(t *testing.T) {
	t.Parallel()
	secret := []byte("test-session-secret-32bytes-long!!")
	exp := time.Now().Add(2 * time.Hour).Unix()

	val, err := Sign(secret, "user-abc-123", exp)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if !strings.HasPrefix(val, "v1.") {
		t.Fatalf("expected v1. prefix, got %q", val)
	}

	uid, ok := Verify(secret, val, time.Now().Unix())
	if !ok {
		t.Fatal("Verify rejected a valid token")
	}
	if uid != "user-abc-123" {
		t.Fatalf("userID = %q, want user-abc-123", uid)
	}
}

func TestVerify_forgedMAC(t *testing.T) {
	t.Parallel()
	secret := []byte("test-session-secret-32bytes-long!!")
	exp := time.Now().Add(time.Hour).Unix()
	val, err := Sign(secret, "u1", exp)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	// Tamper with the MAC (last segment).
	parts := strings.Split(val, ".")
	parts[3] = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	forged := strings.Join(parts, ".")

	if _, ok := Verify(secret, forged, time.Now().Unix()); ok {
		t.Fatal("forged MAC must not verify")
	}
}

func TestVerify_wrongSecret(t *testing.T) {
	t.Parallel()
	exp := time.Now().Add(time.Hour).Unix()
	val, err := Sign([]byte("secret-a"), "u1", exp)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if _, ok := Verify([]byte("secret-b"), val, time.Now().Unix()); ok {
		t.Fatal("wrong secret must not verify")
	}
}

func TestVerify_expired(t *testing.T) {
	t.Parallel()
	secret := []byte("test-session-secret-32bytes-long!!")
	exp := time.Now().Add(-time.Minute).Unix()
	val, err := Sign(secret, "u1", exp)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if _, ok := Verify(secret, val, time.Now().Unix()); ok {
		t.Fatal("expired token must not verify")
	}
}

func TestVerify_legacyConstantOne(t *testing.T) {
	t.Parallel()
	secret := []byte("test-session-secret-32bytes-long!!")
	// Pre-SEC-07 forgeable value.
	if _, ok := Verify(secret, "1", time.Now().Unix()); ok {
		t.Fatal("legacy has_session=1 must not verify")
	}
}

func TestSign_emptySecret(t *testing.T) {
	t.Parallel()
	if _, err := Sign(nil, "u1", time.Now().Add(time.Hour).Unix()); err == nil {
		t.Fatal("expected error for empty secret")
	}
}

func TestSign_userIDWithDot(t *testing.T) {
	t.Parallel()
	if _, err := Sign([]byte("s"), "a.b", time.Now().Add(time.Hour).Unix()); err == nil {
		t.Fatal("expected error for user_id containing '.'")
	}
}

func TestSignWithMaxAge(t *testing.T) {
	t.Parallel()
	secret := []byte("test-session-secret-32bytes-long!!")
	val, err := SignWithMaxAge(secret, "uuid-here", 3600)
	if err != nil {
		t.Fatalf("SignWithMaxAge: %v", err)
	}
	uid, ok := Verify(secret, val, time.Now().Unix())
	if !ok || uid != "uuid-here" {
		t.Fatalf("Verify = (%q, %v)", uid, ok)
	}
}

func TestVerify_emptyUserID(t *testing.T) {
	t.Parallel()
	secret := []byte("test-session-secret-32bytes-long!!")
	exp := time.Now().Add(time.Hour).Unix()
	val, err := Sign(secret, "", exp)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	uid, ok := Verify(secret, val, time.Now().Unix())
	if !ok || uid != "" {
		t.Fatalf("Verify = (%q, %v)", uid, ok)
	}
}

// Golden vector shared with web/src/lib/session-flag (Node HMAC-SHA256 base64url).
// Fixed inputs pin wire compatibility between Go gateway and Next edge verify.
func TestGoldenVector(t *testing.T) {
	t.Parallel()
	const (
		secret = "golden-session-secret-for-sec07"
		userID = "550e8400-e29b-41d4-a716-446655440000"
		exp    = int64(1893456000) // 2030-01-01 UTC
		want   = "v1.550e8400-e29b-41d4-a716-446655440000.1893456000.yGwjJNegomL9GGKPkqwwiQv30wLPiMePIYkSx_ExFN0"
	)
	got, err := Sign([]byte(secret), userID, exp)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if got != want {
		t.Fatalf("Sign = %q\nwant %q", got, want)
	}
	uid, ok := Verify([]byte(secret), want, 1700000000)
	if !ok || uid != userID {
		t.Fatalf("Verify = (%q, %v)", uid, ok)
	}
}
