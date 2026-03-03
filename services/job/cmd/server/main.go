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
	grpclib "google.golang.org/grpc"

	grpcserver "github.com/nomarkup/nomarkup/services/job/internal/grpc"
	"github.com/nomarkup/nomarkup/services/job/internal/repository"
	"github.com/nomarkup/nomarkup/services/job/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	port := os.Getenv("JOB_SERVICE_PORT")
	if port == "" {
		port = "50052"
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		slog.Error("DATABASE_URL is required")
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

	// Optional Meilisearch integration.
	meiliHost := os.Getenv("MEILISEARCH_HOST")
	meiliKey := os.Getenv("MEILISEARCH_API_KEY")

	var searchEngine *service.SearchEngine
	if meiliHost != "" {
		se, err := service.NewSearchEngine(meiliHost, meiliKey)
		if err != nil {
			slog.Warn("failed to initialize search engine, continuing without search", "error", err)
		} else {
			searchEngine = se
			slog.Info("connected to meilisearch", "host", meiliHost)
		}
	}

	// Wire up dependencies.
	repo := repository.NewPostgresRepository(pool)
	jobService := service.NewJobService(repo, searchEngine)
	srv := grpcserver.NewServer(jobService)

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
		slog.Info("job service starting", "port", port)
		if err := s.Serve(lis); err != nil {
			slog.Error("grpc server error", "error", err)
			os.Exit(1)
		}
	}()

	<-sigCtx.Done()
	slog.Info("shutting down job service")
	s.GracefulStop()
	slog.Info("job service stopped")
}
