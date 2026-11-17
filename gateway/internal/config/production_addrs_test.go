package config

import (
	"strings"
	"testing"
)

func TestLoadProductionRequiresServiceAddrs(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	for _, k := range productionRequiredAddrVars {
		t.Setenv(k, "")
	}
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "USER_SERVICE_ADDR") || !strings.Contains(err.Error(), "ALLOWED_ORIGINS") {
		t.Fatalf("expected missing-addr error, got %v", err)
	}
}

func TestLoadProductionWithAddrs(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	for _, k := range productionRequiredAddrVars {
		t.Setenv(k, "svc:50051")
	}
	t.Setenv("ALLOWED_ORIGINS", "https://no-markup.com")
	if _, err := Load(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadDevelopmentKeepsLocalhostDefaults(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("USER_SERVICE_ADDR", "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.UserServiceAddr != "localhost:50051" {
		t.Fatalf("got %q", cfg.UserServiceAddr)
	}
}
