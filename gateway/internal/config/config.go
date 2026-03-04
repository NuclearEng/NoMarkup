package config

import (
	"fmt"
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

	origins := getEnv("ALLOWED_ORIGINS", "http://localhost:3000")

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
		FraudEngineAddr:    getEnv("FRAUD_ENGINE_ADDR", "localhost:50056"),
		TrustEngineAddr:    getEnv("TRUST_ENGINE_ADDR", "localhost:50057"),
		ImagingServiceAddr:      getEnv("IMAGING_SERVICE_ADDR", "localhost:50058"),
		NotificationServiceAddr: getEnv("NOTIFICATION_SERVICE_ADDR", "localhost:50059"),
		AllowedOrigins:          strings.Split(origins, ","),
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
