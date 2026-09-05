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

// Default renewal cadence: sleep half the TTL, then renew.
const (
	renewalFractionNumerator   = 1
	renewalFractionDenominator = 2

	// Floor and ceiling on the computed sleep so a misconfigured (very
	// small) TTL doesn't pin a CPU and a very large TTL still wakes up
	// reasonably often.
	minRenewalSleep = 30 * time.Second
	maxRenewalSleep = 30 * time.Minute

	// Retry parameters used after a renewal failure.
	renewalRetryDelay = 30 * time.Second
)

// Client is a Vault client with TTL-cached reads and env-var fallback.
//
// When configured with VAULT_ADDR, the client also runs a background
// goroutine that periodically renews its auth token (AppRole or direct).
// Stop the goroutine by calling Close() — usually wired into the service's
// graceful-shutdown path.
type Client struct {
	api      *vaultapi.Client
	cacheTTL time.Duration

	mu    sync.RWMutex
	cache map[string]cacheEntry

	// Renewal lifecycle.
	renewalCancel context.CancelFunc
	renewalDone   chan struct{}

	// Hooks for tests — when nil, the real time.Sleep / time.AfterFunc are
	// used. Captured at struct level so tests can deterministically advance
	// time without reaching into globals.
	now   func() time.Time
	sleep func(context.Context, time.Duration) error
}

type cacheEntry struct {
	value     map[string]any
	expiresAt time.Time
}

// New constructs a Vault client. If VAULT_ADDR is unset, returns a no-op
// client that falls through to environment variables on every read.
//
// On success with VAULT_ADDR configured, a token-renewal goroutine is
// spawned. It uses ctx as its parent context, so cancelling ctx (or calling
// Close()) stops the goroutine.
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

	// Capture the auth response so we can pull the token TTL out for the
	// renewal scheduler. Direct VAULT_TOKEN auth provides no TTL hint, so
	// we look it up via lookup-self.
	var initialTTL time.Duration
	switch {
	case os.Getenv("VAULT_TOKEN") != "":
		api.SetToken(os.Getenv("VAULT_TOKEN"))
		initialTTL = lookupSelfTTL(ctx, api)
	case os.Getenv("VAULT_ROLE_ID") != "" && os.Getenv("VAULT_SECRET_ID") != "":
		resp, err := api.Logical().WriteWithContext(ctx, "auth/approle/login", map[string]any{
			"role_id":   os.Getenv("VAULT_ROLE_ID"),
			"secret_id": os.Getenv("VAULT_SECRET_ID"),
		})
		if err != nil {
			return nil, fmt.Errorf("vault: approle login: %w", err)
		}
		if resp == nil || resp.Auth == nil {
			return nil, errors.New("vault: approle login returned no auth")
		}
		api.SetToken(resp.Auth.ClientToken)
		initialTTL = time.Duration(resp.Auth.LeaseDuration) * time.Second
	default:
		return nil, errors.New("vault: VAULT_ADDR set but no auth method configured (VAULT_TOKEN or VAULT_ROLE_ID+VAULT_SECRET_ID)")
	}

	c := &Client{
		api:      api,
		cacheTTL: 5 * time.Minute,
		cache:    map[string]cacheEntry{},
	}

	if initialTTL > 0 {
		c.startRenewLoop(initialTTL)
	} else {
		slog.Warn("vault: token TTL is 0 or unknown; skipping renewal goroutine",
			"hint", "tokens with no TTL are root tokens or legacy direct tokens; rotate via env restart instead",
		)
	}

	slog.Info("vault: client ready", "addr", addr, "initial_ttl", initialTTL.String())
	return c, nil
}

// startRenewLoop spawns the background renewer. Exported only for tests via
// the package-internal helper (tests can manually invoke this after
// installing a sleep hook).
func (c *Client) startRenewLoop(initialTTL time.Duration) {
	renewCtx, cancel := context.WithCancel(context.Background())
	c.renewalCancel = cancel
	c.renewalDone = make(chan struct{})
	go c.renewLoop(renewCtx, initialTTL)
}

// Close stops the renewal goroutine and waits for it to exit. Safe to call
// multiple times.
func (c *Client) Close() {
	if c.renewalCancel != nil {
		c.renewalCancel()
		c.renewalCancel = nil
	}
	if c.renewalDone != nil {
		<-c.renewalDone
		c.renewalDone = nil
	}
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

// renewLoop sleeps for half the current TTL, calls RenewSelf, and repeats.
// On failure it retries once after renewalRetryDelay; a second consecutive
// failure logs ERROR but the loop continues so a transient outage doesn't
// silently leave the service without renewal forever (it will keep trying
// every TTL/2 of the *last known* TTL until ctx is cancelled).
//
// The goroutine never crashes the service: env-var fallback is always
// available via GetString when Vault is unreachable.
func (c *Client) renewLoop(ctx context.Context, initialTTL time.Duration) {
	defer close(c.renewalDone)

	currentTTL := initialTTL
	for {
		sleep := renewalSleep(currentTTL)
		if err := c.waitFor(ctx, sleep); err != nil {
			slog.Info("vault: renewal goroutine stopping", "reason", err)
			return
		}

		newTTL, err := c.renewOnce(ctx)
		if err != nil {
			slog.Warn("vault: token renewal failed; retrying once", "error", err, "retry_delay", renewalRetryDelay.String())
			if werr := c.waitFor(ctx, renewalRetryDelay); werr != nil {
				slog.Info("vault: renewal goroutine stopping during retry backoff", "reason", werr)
				return
			}
			newTTL, err = c.renewOnce(ctx)
			if err != nil {
				// Operator alert. Service keeps running on the now-stale
				// token (or env fallback once it expires) — see
				// docs/operations/vault-client.md.
				slog.Error("vault: token renewal failed twice; service will fall back to env vars when token expires",
					"error", err,
					"current_ttl", currentTTL.String(),
				)
				// Keep currentTTL so we still wake up periodically and try again.
				continue
			}
		}

		if newTTL > 0 {
			currentTTL = newTTL
		}
		slog.Debug("vault: token renewed", "new_ttl", currentTTL.String())
	}
}

// renewOnce calls renew-self and returns the fresh lease duration. Returns 0
// for the duration if Vault returns no auth block (treat as "TTL unknown,
// use previous").
func (c *Client) renewOnce(ctx context.Context) (time.Duration, error) {
	resp, err := c.api.Auth().Token().RenewSelfWithContext(ctx, 0)
	if err != nil {
		return 0, fmt.Errorf("renew-self: %w", err)
	}
	if resp == nil || resp.Auth == nil {
		return 0, errors.New("renew-self returned no auth block")
	}
	return time.Duration(resp.Auth.LeaseDuration) * time.Second, nil
}

// waitFor blocks until either ctx is done (returns ctx.Err()) or the
// duration elapses (returns nil). If c.sleep is set (test hook), it is used
// instead of the default time.NewTimer path.
func (c *Client) waitFor(ctx context.Context, d time.Duration) error {
	if c.sleep != nil {
		return c.sleep(ctx, d)
	}
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// renewalSleep returns the duration to sleep before the next renewal
// (TTL/2, clamped to [minRenewalSleep, maxRenewalSleep]).
func renewalSleep(ttl time.Duration) time.Duration {
	if ttl <= 0 {
		return minRenewalSleep
	}
	half := ttl * renewalFractionNumerator / renewalFractionDenominator
	if half < minRenewalSleep {
		return minRenewalSleep
	}
	if half > maxRenewalSleep {
		return maxRenewalSleep
	}
	return half
}

// lookupSelfTTL reads the current token's TTL via /auth/token/lookup-self.
// Returns 0 on any error so the caller logs and skips renewal scheduling.
func lookupSelfTTL(ctx context.Context, api *vaultapi.Client) time.Duration {
	hctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	secret, err := api.Auth().Token().LookupSelfWithContext(hctx)
	if err != nil || secret == nil || secret.Data == nil {
		return 0
	}
	// "ttl" comes back as json.Number in seconds. Be defensive.
	switch v := secret.Data["ttl"].(type) {
	case float64:
		return time.Duration(v) * time.Second
	case int:
		return time.Duration(v) * time.Second
	case int64:
		return time.Duration(v) * time.Second
	default:
		// Try the json.Number path the SDK normally uses.
		if n, ok := secret.Data["ttl"].(interface{ Int64() (int64, error) }); ok {
			if i, err := n.Int64(); err == nil {
				return time.Duration(i) * time.Second
			}
		}
		return 0
	}
}
