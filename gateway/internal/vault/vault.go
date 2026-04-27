// Package vault provides a thin client wrapper for HashiCorp Vault with
// transparent fallback to environment variables for local development.
package vault

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	vaultapi "github.com/hashicorp/vault/api"
)

// Client is a Vault client with TTL-cached reads and env-var fallback.
type Client struct {
	api      *vaultapi.Client
	cacheTTL time.Duration

	mu    sync.RWMutex
	cache map[string]cacheEntry
}

type cacheEntry struct {
	value     map[string]any
	expiresAt time.Time
}

// New constructs a Vault client. If VAULT_ADDR is unset, returns a no-op
// client that falls through to environment variables on every read.
func New(ctx context.Context) (*Client, error) {
	addr := os.Getenv("VAULT_ADDR")
	if addr == "" {
		slog.Info("vault: VAULT_ADDR unset — using env-var fallback")
		return &Client{cache: map[string]cacheEntry{}, cacheTTL: 5 * time.Minute}, nil
	}

	cfg := vaultapi.DefaultConfig()
	cfg.Address = addr
	api, err := vaultapi.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("vault: new client: %w", err)
	}
	if ns := os.Getenv("VAULT_NAMESPACE"); ns != "" {
		api.SetNamespace(ns)
	}

	if tok := os.Getenv("VAULT_TOKEN"); tok != "" {
		api.SetToken(tok)
	} else if roleID, secretID := os.Getenv("VAULT_ROLE_ID"), os.Getenv("VAULT_SECRET_ID"); roleID != "" && secretID != "" {
		resp, err := api.Logical().WriteWithContext(ctx, "auth/approle/login", map[string]any{
			"role_id":   roleID,
			"secret_id": secretID,
		})
		if err != nil {
			return nil, fmt.Errorf("vault: approle login: %w", err)
		}
		if resp == nil || resp.Auth == nil {
			return nil, errors.New("vault: approle login returned no auth")
		}
		api.SetToken(resp.Auth.ClientToken)
	} else {
		return nil, errors.New("vault: VAULT_ADDR set but no auth method configured (VAULT_TOKEN or VAULT_ROLE_ID+VAULT_SECRET_ID)")
	}

	c := &Client{api: api, cacheTTL: 5 * time.Minute, cache: map[string]cacheEntry{}}
	slog.Info("vault: client ready", "addr", addr)
	return c, nil
}

// GetString reads a key from a Vault secret. Falls back to os.Getenv(envFallback)
// when Vault is not configured or the secret is absent.
func (c *Client) GetString(ctx context.Context, path, key, envFallback string) string {
	if c.api == nil {
		return os.Getenv(envFallback)
	}
	secret, err := c.read(ctx, path)
	if err != nil {
		slog.Warn("vault: read failed; falling back to env", "path", path, "key", key, "err", err)
		return os.Getenv(envFallback)
	}
	if v, ok := secret[key].(string); ok && v != "" {
		return v
	}
	return os.Getenv(envFallback)
}

// Healthy returns nil if Vault is reachable. Returns nil when not configured
// (env-fallback mode is always healthy).
func (c *Client) Healthy(ctx context.Context) error {
	if c.api == nil {
		return nil
	}
	hctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	_, err := c.api.Sys().HealthWithContext(hctx)
	if err != nil {
		return fmt.Errorf("vault: health check: %w", err)
	}
	return nil
}

func (c *Client) read(ctx context.Context, path string) (map[string]any, error) {
	c.mu.RLock()
	entry, ok := c.cache[path]
	c.mu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.value, nil
	}

	logical := path
	if !strings.Contains(logical, "/data/") {
		first, rest, found := strings.Cut(logical, "/")
		if found {
			logical = first + "/data/" + rest
		}
	}

	secret, err := c.api.Logical().ReadWithContext(ctx, logical)
	if err != nil {
		return nil, err
	}
	if secret == nil {
		return nil, fmt.Errorf("vault: no secret at %s (response was empty/404)", logical)
	}
	if len(secret.Data) == 0 {
		return nil, fmt.Errorf("vault: secret at %s had empty data", logical)
	}

	// KVv2 puts the actual data under secret.Data["data"]; KVv1 puts it directly.
	// Accept either.
	var data map[string]any
	if d, ok := secret.Data["data"].(map[string]any); ok {
		data = d
	} else {
		data = secret.Data
	}

	c.mu.Lock()
	c.cache[path] = cacheEntry{value: data, expiresAt: time.Now().Add(c.cacheTTL)}
	c.mu.Unlock()
	return data, nil
}
