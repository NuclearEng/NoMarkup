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
	"google.golang.org/grpc"

	notificationgrpc "github.com/nomarkup/nomarkup/services/notification/internal/grpc"
	"github.com/nomarkup/nomarkup/services/notification/internal/repository"
	"github.com/nomarkup/nomarkup/services/notification/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	port := os.Getenv("NOTIFICATION_SERVICE_PORT")
	if port == "" {
		port = "50059"
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://localhost:5433/nomarkup"
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Initialize PostgreSQL connection pool.
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		slog.Error("failed to create database pool", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		slog.Error("failed to ping database", "error", err)
		os.Exit(1)
	}
	slog.Info("connected to database")

	// Initialize dispatchers from environment variables.
	emailDispatcher := service.NewEmailDispatcher(
		os.Getenv("SENDGRID_API_KEY"),
		os.Getenv("SENDGRID_FROM_EMAIL"),
		os.Getenv("SENDGRID_FROM_NAME"),
	)

	pushDispatcher := service.NewPushDispatcher(
		os.Getenv("FCM_SERVER_KEY"),
		os.Getenv("FCM_PROJECT_ID"),
	)

	smsDispatcher := service.NewSMSDispatcher(
		os.Getenv("TWILIO_ACCOUNT_SID"),
		os.Getenv("TWILIO_AUTH_TOKEN"),
		os.Getenv("TWILIO_FROM_NUMBER"),
	)

	// Log dispatcher modes.
	if os.Getenv("SENDGRID_API_KEY") == "" {
		slog.Info("email dispatcher running in dev mode (SENDGRID_API_KEY not set)")
	}
	if os.Getenv("FCM_SERVER_KEY") == "" {
		slog.Info("push dispatcher running in dev mode (FCM_SERVER_KEY not set)")
	}
	if os.Getenv("TWILIO_ACCOUNT_SID") == "" {
		slog.Info("sms dispatcher running in dev mode (TWILIO_ACCOUNT_SID not set)")
	}

	// Wire up dependencies.
	repo := repository.New(pool)
	svc := service.New(repo, repo, emailDispatcher, pushDispatcher, smsDispatcher)
	srv := notificationgrpc.NewServer(svc)

	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}

	s := grpc.NewServer()
	notificationgrpc.Register(s, srv)

	go func() {
		slog.Info("notification service starting", "port", port)
		if err := s.Serve(lis); err != nil {
			slog.Error("grpc server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down notification service")
	s.GracefulStop()
	slog.Info("notification service stopped")
}
