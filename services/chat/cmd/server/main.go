package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc"

	chatgrpc "github.com/nomarkup/nomarkup/services/chat/internal/grpc"
	"github.com/nomarkup/nomarkup/services/chat/internal/repository"
	"github.com/nomarkup/nomarkup/services/chat/internal/service"
	"github.com/nomarkup/nomarkup/services/chat/internal/ws"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	port := os.Getenv("CHAT_SERVICE_PORT")
	if port == "" {
		port = "50055"
	}

	wsPort := os.Getenv("CHAT_WS_PORT")
	if wsPort == "" {
		wsPort = "50065"
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
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

	// Initialize Redis client.
	redisOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		slog.Error("failed to parse REDIS_URL", "error", err)
		os.Exit(1)
	}
	rdb := redis.NewClient(redisOpts)
	defer rdb.Close()

	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Warn("failed to ping redis, pub/sub disabled", "error", err)
	} else {
		slog.Info("connected to redis")
	}

	// Wire up dependencies.
	repo := repository.NewPostgresRepository(pool)
	pubsub := service.NewPubSub(rdb)
	svc := service.New(repo, pubsub)
	srv := chatgrpc.NewServer(svc)

	// Create WebSocket hub and handler.
	hub := ws.NewHub()
	wsHandler := ws.NewHandler(hub, pubsub)

	// Start gRPC server.
	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}

	s := grpc.NewServer()
	chatgrpc.Register(s, srv)

	go func() {
		slog.Info("chat gRPC service starting", "port", port)
		if err := s.Serve(lis); err != nil {
			slog.Error("grpc server error", "error", err)
			os.Exit(1)
		}
	}()

	// Start HTTP server for WebSocket connections.
	mux := http.NewServeMux()
	mux.Handle("/ws", wsHandler)

	httpSrv := &http.Server{
		Addr:         fmt.Sprintf(":%s", wsPort),
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // No write timeout for WebSocket connections.
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		slog.Info("chat WebSocket server starting", "port", wsPort)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("websocket server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down chat service")

	// Close all WebSocket connections gracefully.
	hub.CloseAll()

	// Shut down HTTP server.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		slog.Error("failed to shutdown websocket server", "error", err)
	}

	// Stop gRPC server.
	s.GracefulStop()
	slog.Info("chat service stopped")
}
