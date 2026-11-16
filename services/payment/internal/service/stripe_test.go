package service

import (
	"testing"
)

// Test fixtures for "valid-format" Stripe keys are constructed by concatenation
// so the literal in source never matches GitHub's secret-scanning regex for
// real Stripe keys (which would block this test file from being pushed). The
// runtime value still satisfies IsPlaceholderStripeKey's prefix+length checks.
const (
	fakeTestKeyValid = "sk_" + "test_" + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	fakeLiveKeyValid = "sk_" + "live_" + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
)

func TestIsPlaceholderStripeKey(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		key  string
		want bool
	}{
		{"empty", "", true},
		{"committed-template-literal", "sk_test_...", true},
		{"prefix-only-too-short", "sk_test_short", true},
		{"wrong-prefix", "pk_test_1234567890123456789012345678", true},
		{"contains-ellipsis", "sk_test_1234567890abcdefghij...XYZ", true},
		{"valid-test-key", fakeTestKeyValid, false},
		{"valid-live-key", fakeLiveKeyValid, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := IsPlaceholderStripeKey(tc.key); got != tc.want {
				t.Errorf("IsPlaceholderStripeKey(%q) = %v, want %v", tc.key, got, tc.want)
			}
		})
	}
}

func TestNewStripeService_DevModeOnlyInDevelopment(t *testing.T) {
	// t.Setenv prohibits t.Parallel; run sequentially.
	t.Run("development-allows-placeholder-and-enables-devmode", func(t *testing.T) {
		t.Setenv("STRIPE_SECRET_KEY", "")
		svc := NewStripeService("development")
		if !svc.IsDevMode() {
			t.Fatal("expected dev mode in development with empty key")
		}
	})

	t.Run("development-with-real-key-disables-devmode", func(t *testing.T) {
		t.Setenv("STRIPE_SECRET_KEY", fakeTestKeyValid)
		svc := NewStripeService("development")
		if svc.IsDevMode() {
			t.Fatal("expected dev mode OFF in development with valid key")
		}
	})

	t.Run("staging-with-placeholder-panics", func(t *testing.T) {
		t.Setenv("STRIPE_SECRET_KEY", "sk_test_...")
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("expected panic in staging with placeholder key")
			}
		}()
		_ = NewStripeService("staging")
	})

	t.Run("production-with-empty-key-panics", func(t *testing.T) {
		t.Setenv("STRIPE_SECRET_KEY", "")
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("expected panic in production with empty key")
			}
		}()
		_ = NewStripeService("production")
	})

	t.Run("production-with-real-key-no-devmode", func(t *testing.T) {
		t.Setenv("STRIPE_SECRET_KEY", fakeLiveKeyValid)
		svc := NewStripeService("production")
		if svc.IsDevMode() {
			t.Fatal("expected dev mode OFF in production with valid key")
		}
	})
}
