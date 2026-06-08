package handler

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"nhooyr.io/websocket"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// AuctionWSHandler proxies WebSocket connections for live auction streaming.
type AuctionWSHandler struct {
	chatServiceURL string
	authMW         *middleware.AuthMiddleware
	internalSecret string // shared secret presented to the chat WS backend
}

// NewAuctionWSHandler creates a new AuctionWSHandler. internalSecret is the
// shared secret presented to the chat WS backend on dial.
func NewAuctionWSHandler(authMW *middleware.AuthMiddleware, chatWSAddr, internalSecret string) *AuctionWSHandler {
	return &AuctionWSHandler{
		chatServiceURL: fmt.Sprintf("ws://%s", chatWSAddr),
		authMW:         authMW,
		internalSecret: internalSecret,
	}
}

// WebSocket handles the auction WebSocket proxy.
func (h *AuctionWSHandler) WebSocket(w http.ResponseWriter, r *http.Request) {
	// Check feature flag
	if os.Getenv("ENABLE_LIVE_AUCTION") != "true" {
		writeError(w, http.StatusNotFound, "live auctions not enabled")
		return
	}

	// Extract token from query param, Authorization header, or cookie.
	token := r.URL.Query().Get("token")
	if token == "" {
		authHeader := r.Header.Get("Authorization")
		if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			token = authHeader[7:]
		}
	}
	if token == "" {
		if cookie, err := r.Cookie("access_token"); err == nil {
			token = cookie.Value
		}
	}

	if token == "" {
		writeError(w, http.StatusUnauthorized, "missing authentication token")
		return
	}

	claims, err := h.authMW.ValidateToken(token)
	if err != nil {
		slog.Warn("auction ws auth failed", "error", err, "remote_addr", r.RemoteAddr)
		writeError(w, http.StatusUnauthorized, "invalid or expired token")
		return
	}

	jobID := chi.URLParam(r, "jobId")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job ID required")
		return
	}

	slog.Info("auction ws proxy connecting",
		"user_id", claims.UserID,
		"job_id", jobID,
	)

	// Accept client WebSocket. OriginPatterns enforces the Same-Origin policy
	// on the handshake, preventing CSWSH (cross-site WebSocket hijacking).
	clientConn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: wsOriginPatterns(),
	})
	if err != nil {
		slog.Error("auction ws accept failed", "error", err)
		return
	}
	defer clientConn.CloseNow()

	// Dial backend
	backendURL := fmt.Sprintf("%s/ws/auction?user_id=%s&job_id=%s", h.chatServiceURL, claims.UserID, jobID)

	backendCtx, backendCancel := context.WithTimeout(context.Background(), 10*time.Second)
	backendConn, _, err := websocket.Dial(backendCtx, backendURL, &websocket.DialOptions{
		HTTPHeader: internalWSDialHeader(h.internalSecret),
	})
	backendCancel()
	if err != nil {
		slog.Error("auction ws backend dial failed",
			"url", backendURL,
			"error", err,
		)
		clientConn.Close(websocket.StatusInternalError, "backend unavailable")
		return
	}
	defer backendConn.CloseNow()

	slog.Info("auction ws proxy established",
		"user_id", claims.UserID,
		"job_id", jobID,
	)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Bidirectional proxy
	errc := make(chan error, 2)

	// Client -> Backend
	go func() {
		errc <- proxyWebSocket(ctx, clientConn, backendConn)
	}()

	// Backend -> Client
	go func() {
		errc <- proxyWebSocket(ctx, backendConn, clientConn)
	}()

	// Wait for first error
	proxyErr := <-errc
	cancel()

	closeStatus := websocket.StatusNormalClosure
	closeReason := "connection closed"
	if proxyErr != nil {
		closeStatus = websocket.StatusInternalError
		closeReason = "proxy error"
		slog.Warn("auction ws proxy error",
			"user_id", claims.UserID,
			"job_id", jobID,
			"error", proxyErr,
		)
	}

	clientConn.Close(closeStatus, closeReason)
	backendConn.Close(closeStatus, closeReason)
}
