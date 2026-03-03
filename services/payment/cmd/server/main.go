package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	grpclib "google.golang.org/grpc"

	paymentgrpc "github.com/nomarkup/nomarkup/services/payment/internal/grpc"
	"github.com/nomarkup/nomarkup/services/payment/internal/repository"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	port := os.Getenv("PAYMENT_SERVICE_PORT")
	if port == "" {
		port = "50054"
	}

	// Database connection.
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(context.Background()); err != nil {
		slog.Error("failed to ping database", "error", err)
		os.Exit(1)
	}
	slog.Info("connected to database")

	// Initialize Stripe key.
	stripeKey := os.Getenv("STRIPE_SECRET_KEY")
	if stripeKey != "" {
		stripe.Key = stripeKey
		slog.Info("stripe key configured")
	} else {
		slog.Warn("STRIPE_SECRET_KEY not set, Stripe operations will return stubs")
	}

	// Wire up services.
	repo := repository.NewPostgresRepository(pool)
	stripeSvc := service.NewStripeService()
	paymentSvc := service.NewPaymentService(repo, stripeSvc)
	grpcServer := paymentgrpc.NewServer(paymentSvc)

	// Create and register gRPC server.
	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}

	s := grpclib.NewServer()
	paymentgrpc.Register(s, grpcServer)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("payment service starting", "port", port)
		if err := s.Serve(lis); err != nil {
			slog.Error("grpc server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down payment service")
	s.GracefulStop()
	slog.Info("payment service stopped")
}
