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

	analyticsv1 "github.com/nomarkup/nomarkup/proto/analytics/v1"
	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
	chatv1 "github.com/nomarkup/nomarkup/proto/chat/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	fraudv1 "github.com/nomarkup/nomarkup/proto/fraud/v1"
	imagingv1 "github.com/nomarkup/nomarkup/proto/imaging/v1"
	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	reviewv1 "github.com/nomarkup/nomarkup/proto/review/v1"
	subscriptionv1 "github.com/nomarkup/nomarkup/proto/subscription/v1"
	trustv1 "github.com/nomarkup/nomarkup/proto/trust/v1"
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

	// Connect to Job Service via gRPC.
	jobConn, err := grpc.NewClient(cfg.JobServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		slog.Error("failed to connect to job service", "addr", cfg.JobServiceAddr, "error", err)
		os.Exit(1)
	}
	defer jobConn.Close()

	jobClient := jobv1.NewJobServiceClient(jobConn)

	// Contract service lives on the same gRPC server as the job service.
	contractClient := contractv1.NewContractServiceClient(jobConn)

	// Connect to Bid Engine via gRPC.
	bidConn, err := grpc.NewClient(cfg.BidEngineAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		slog.Error("failed to connect to bid engine", "addr", cfg.BidEngineAddr, "error", err)
		os.Exit(1)
	}
	defer bidConn.Close()

	bidClient := bidv1.NewBidServiceClient(bidConn)

	// Connect to Payment Service via gRPC.
	paymentConn, err := grpc.NewClient(cfg.PaymentServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		slog.Error("failed to connect to payment service", "addr", cfg.PaymentServiceAddr, "error", err)
		os.Exit(1)
	}
	defer paymentConn.Close()

	paymentClient := paymentv1.NewPaymentServiceClient(paymentConn)

	// Connect to Chat Service via gRPC.
	chatConn, err := grpc.NewClient(cfg.ChatServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		slog.Error("failed to connect to chat service", "addr", cfg.ChatServiceAddr, "error", err)
		os.Exit(1)
	}
	defer chatConn.Close()

	chatClient := chatv1.NewChatServiceClient(chatConn)

	// Connect to Trust Engine via gRPC.
	trustConn, err := grpc.NewClient(cfg.TrustEngineAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		slog.Error("failed to connect to trust engine", "addr", cfg.TrustEngineAddr, "error", err)
		os.Exit(1)
	}
	defer trustConn.Close()

	trustClient := trustv1.NewTrustServiceClient(trustConn)

	// Connect to Fraud Engine via gRPC.
	fraudConn, err := grpc.NewClient(cfg.FraudEngineAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		slog.Error("failed to connect to fraud engine", "addr", cfg.FraudEngineAddr, "error", err)
		os.Exit(1)
	}
	defer fraudConn.Close()

	fraudClient := fraudv1.NewFraudServiceClient(fraudConn)

	// Connect to Notification Service via gRPC.
	notifConn, err := grpc.NewClient(cfg.NotificationServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		slog.Error("failed to connect to notification service", "addr", cfg.NotificationServiceAddr, "error", err)
		os.Exit(1)
	}
	defer notifConn.Close()

	notifClient := notificationv1.NewNotificationServiceClient(notifConn)

	// Connect to Imaging Service via gRPC.
	imagingConn, err := grpc.NewClient(cfg.ImagingServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		slog.Error("failed to connect to imaging service", "addr", cfg.ImagingServiceAddr, "error", err)
		os.Exit(1)
	}
	defer imagingConn.Close()

	imagingClient := imagingv1.NewImagingServiceClient(imagingConn)

	// Determine if we should use secure cookies (production).
	secureCookie := os.Getenv("SECURE_COOKIES") != "false"

	// Wire up handlers and middleware.
	authMW := middleware.NewAuthMiddleware(publicKey)
	authHandler := handler.NewAuthHandler(userClient, secureCookie)
	userHandler := handler.NewUserHandler(userClient)
	providerHandler := handler.NewProviderHandler(userClient)
	categoriesHandler := handler.NewCategoriesHandler(userClient)
	jobHandler := handler.NewJobHandler(jobClient)
	bidHandler := handler.NewBidHandler(bidClient)
	contractHandler := handler.NewContractHandler(contractClient)

	// Review service lives on the same gRPC server as the job service.
	reviewClient := reviewv1.NewReviewServiceClient(jobConn)
	reviewHandler := handler.NewReviewHandler(reviewClient)

	// Subscription service lives on the same gRPC server as the payment service.
	subscriptionClient := subscriptionv1.NewSubscriptionServiceClient(paymentConn)
	subscriptionHandler := handler.NewSubscriptionHandler(subscriptionClient)

	// Analytics service lives on the same gRPC server as the job service.
	analyticsClient := analyticsv1.NewAnalyticsServiceClient(jobConn)
	analyticsHandler := handler.NewAnalyticsHandler(analyticsClient)

	paymentHandler := handler.NewPaymentHandler(paymentClient)
	webhookHandler := handler.NewWebhookHandler(paymentClient)
	chatHandler := handler.NewChatHandler(chatClient, authMW, cfg.ChatWSAddr)
	trustHandler := handler.NewTrustHandler(trustClient)
	fraudHandler := handler.NewFraudHandler(fraudClient)
	notificationHandler := handler.NewNotificationHandler(notifClient)
	imageHandler := handler.NewImageHandler(imagingClient)

	// Admin handlers — use existing gRPC clients.
	adminUsersHandler := handler.NewAdminUsersHandler(userClient)
	adminVerificationHandler := handler.NewAdminVerificationHandler(userClient)
	adminJobsHandler := handler.NewAdminJobsHandler(jobClient)
	adminDisputesHandler := handler.NewAdminDisputesHandler(contractClient)
	adminReviewsHandler := handler.NewAdminReviewsHandler(reviewClient)
	adminPaymentsHandler := handler.NewAdminPaymentsHandler(paymentClient)
	adminPlatformHandler := handler.NewAdminPlatformHandler(analyticsClient, subscriptionClient)

	r := router.New(cfg.AllowedOrigins, cfg.IsProduction(), authMW, authHandler, userHandler, providerHandler, categoriesHandler, jobHandler, bidHandler, contractHandler, paymentHandler, webhookHandler, chatHandler, reviewHandler, trustHandler, fraudHandler, notificationHandler, imageHandler, subscriptionHandler, analyticsHandler, adminUsersHandler, adminVerificationHandler, adminJobsHandler, adminDisputesHandler, adminReviewsHandler, adminPaymentsHandler, adminPlatformHandler)

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
