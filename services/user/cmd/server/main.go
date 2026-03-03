package main

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"
	grpclib "google.golang.org/grpc"

	grpcserver "github.com/nomarkup/nomarkup/services/user/internal/grpc"
	"github.com/nomarkup/nomarkup/services/user/internal/repository"
	"github.com/nomarkup/nomarkup/services/user/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	port := os.Getenv("USER_SERVICE_PORT")
	if port == "" {
		port = "50051"
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	jwtPrivateKeyPath := os.Getenv("JWT_PRIVATE_KEY_PATH")
	if jwtPrivateKeyPath == "" {
		jwtPrivateKeyPath = "./keys/private.pem"
	}

	// Load RSA private key for JWT signing.
	privateKey, err := loadRSAPrivateKey(jwtPrivateKeyPath)
	if err != nil {
		slog.Error("failed to load JWT private key", "path", jwtPrivateKeyPath, "error", err)
		os.Exit(1)
	}

	// Connect to PostgreSQL.
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		slog.Error("failed to ping database", "error", err)
		os.Exit(1)
	}
	slog.Info("connected to database")

	// Wire up dependencies.
	repo := repository.NewPostgresRepository(pool)
	jwtManager := service.NewJWTManager(privateKey)
	authService := service.NewAuth(repo, jwtManager)
	srv := grpcserver.NewServer(authService)

	// Start gRPC server.
	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}

	s := grpclib.NewServer()
	grpcserver.Register(s, srv)

	sigCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("user service starting", "port", port)
		if err := s.Serve(lis); err != nil {
			slog.Error("grpc server error", "error", err)
			os.Exit(1)
		}
	}()

	<-sigCtx.Done()
	slog.Info("shutting down user service")
	s.GracefulStop()
	slog.Info("user service stopped")
}

// loadRSAPrivateKey reads and parses a PEM-encoded RSA private key from disk.
func loadRSAPrivateKey(path string) (*rsa.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read private key file: %w", err)
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("no PEM block found in %s", path)
	}

	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		// Try PKCS1 format as fallback.
		rsaKey, pkcs1Err := x509.ParsePKCS1PrivateKey(block.Bytes)
		if pkcs1Err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		return rsaKey, nil
	}

	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("private key is not RSA")
	}
	return rsaKey, nil
}
