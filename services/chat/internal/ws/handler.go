package ws

import (
	"log/slog"
	"net/http"
)

// Handler manages WebSocket connections for real-time chat messaging.
type Handler struct {
	// TODO: connection registry, message broadcasting, presence tracking
}

// NewHandler creates a new WebSocket handler.
func NewHandler() *Handler {
	return &Handler{}
}

// ServeHTTP upgrades HTTP connections to WebSocket for real-time messaging.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	slog.Info("websocket connection attempt", "remote_addr", r.RemoteAddr)
	// TODO: Upgrade connection using nhooyr.io/websocket
	// TODO: Authenticate via token query param or cookie
	// TODO: Register connection in hub, listen for messages
	http.Error(w, "websocket not yet implemented", http.StatusNotImplemented)
}
