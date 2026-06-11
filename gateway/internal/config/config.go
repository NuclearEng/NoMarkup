package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

// Config holds all gateway configuration loaded from environment variables.
type Config struct {
	Port               int
	Environment        string // "production", "staging", or "development" (default)
	DatabaseURL        string
	RedisURL           string
	JWTPublicKeyPath   string
	UserServiceAddr    string
	JobServiceAddr     string
	BidEngineAddr      string
	PaymentServiceAddr string
	ChatServiceAddr    string
	ChatWSAddr         string
	InternalWSSecret   string // shared secret presented to the chat WS backend
	FraudEngineAddr    string
	TrustEngineAddr    string
	ImagingServiceAddr      string
	NotificationServiceAddr string
	AllowedOrigins          []string
}

// IsProduction returns true when the gateway is running in a production environment.
func (c *Config) IsProduction() bool {
	return c.Environment == "production"
}

// Load reads configuration from environment variables.
// Returns an error if required variables are missing.
func Load() (*Config, error) {
	port, err := strconv.Atoi(getEnv("GATEWAY_PORT", "8080"))
	if err != nil {
		return nil, fmt.Errorf("invalid GATEWAY_PORT: %w", err)
	}

	origins := getEnv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3002")

	cfg := &Config{
		Port:               port,
		Environment:        getEnv("ENVIRONMENT", "development"),
		DatabaseURL:        getEnv("DATABASE_URL", ""),
		RedisURL:           getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTPublicKeyPath:   getEnv("JWT_PUBLIC_KEY_PATH", ""),
		UserServiceAddr:    getEnv("USER_SERVICE_ADDR", "localhost:50051"),
		JobServiceAddr:     getEnv("JOB_SERVICE_ADDR", "localhost:50052"),
		BidEngineAddr:      getEnv("BID_ENGINE_ADDR", "localhost:50053"),
		PaymentServiceAddr: getEnv("PAYMENT_SERVICE_ADDR", "localhost:50054"),
		ChatServiceAddr:    getEnv("CHAT_SERVICE_ADDR", "localhost:50055"),
		ChatWSAddr:         getEnv("CHAT_WS_ADDR", "localhost:50065"),
		InternalWSSecret:   getEnvFirst("", "INTERNAL_WS_SECRET", "GATEWAY_CHAT_SECRET"),
		FraudEngineAddr:    getEnv("FRAUD_ENGINE_ADDR", "localhost:50056"),
		TrustEngineAddr:    getEnv("TRUST_ENGINE_ADDR", "localhost:50057"),
		ImagingServiceAddr:      getEnv("IMAGING_SERVICE_ADDR", "localhost:50058"),
		NotificationServiceAddr: getEnv("NOTIFICATION_SERVICE_ADDR", "localhost:50059"),
		AllowedOrigins:          strings.Split(origins, ","),
	}

	return cfg, nil
}

// ResolveMeilisearchURL resolves the Meilisearch endpoint URL from the
// environment.
//
// MEILISEARCH_URL is the canonical variable (.env.example, CLAUDE.md §12, and
// the k8s configmaps all supply it). MEILISEARCH_HOST is honored as a
// deprecated fallback so older tooling keeps working, with a slog warning.
// The result is normalized to a full URL — a bare "host:port" gets an
// "http://" scheme prepended, since the meilisearch client requires a URL.
// Returns "" when neither variable is set (search disabled in dev).
func ResolveMeilisearchURL() string {
	url := strings.TrimSpace(os.Getenv("MEILISEARCH_URL"))
	if url == "" {
		if host := strings.TrimSpace(os.Getenv("MEILISEARCH_HOST")); host != "" {
			slog.Warn("MEILISEARCH_HOST is deprecated; set MEILISEARCH_URL instead", "host", host)
			url = host
		}
	}
	if url == "" {
		return ""
	}
	if !strings.Contains(url, "://") {
		url = "http://" + url
	}
	return url
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// getEnvFirst returns the first non-empty value among the given env keys, or the
// fallback if none are set. Used for vars with backwards-compatible aliases.
func getEnvFirst(fallback string, keys ...string) string {
	for _, k := range keys {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return fallback
}
