package main

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/nomarkup/nomarkup/gateway/internal/config"
	"github.com/nomarkup/nomarkup/gateway/internal/handler"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	"github.com/nomarkup/nomarkup/gateway/internal/router"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Load JWT public key for token verification.
	publicKey, err := loadRSAPublicKey(cfg.JWTPublicKeyPath)
	if err != nil {
		slog.Error("failed to load JWT public key", "path", cfg.JWTPublicKeyPath, "error", err)
		os.Exit(1)
	}

	// Connect to User Service via gRPC.
	userConn, err := grpc.NewClient(cfg.UserServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		slog.Error("failed to connect to user service", "addr", cfg.UserServiceAddr, "error", err)
		os.Exit(1)
	}
	defer userConn.Close()

	userClient := userv1.NewUserServiceClient(userConn)

	// Determine if we should use secure cookies (production).
	secureCookie := os.Getenv("SECURE_COOKIES") != "false"

	// Wire up handlers and middleware.
	authMW := middleware.NewAuthMiddleware(publicKey)
	authHandler := handler.NewAuthHandler(userClient, secureCookie)
	userHandler := handler.NewUserHandler(userClient)
	providerHandler := handler.NewProviderHandler(userClient)
	categoriesHandler := handler.NewCategoriesHandler(userClient)

	r := router.New(cfg.AllowedOrigins, authMW, authHandler, userHandler, providerHandler, categoriesHandler)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("gateway starting", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down gracefully")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("forced shutdown", "error", err)
	}
	slog.Info("gateway stopped")
}

// loadRSAPublicKey reads and parses a PEM-encoded RSA public key from disk.
func loadRSAPublicKey(path string) (*rsa.PublicKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read public key file: %w", err)
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("no PEM block found in %s", path)
	}

	key, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse public key: %w", err)
	}

	rsaKey, ok := key.(*rsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("public key is not RSA")
	}
	return rsaKey, nil
}
