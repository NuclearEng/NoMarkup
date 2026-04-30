package handler

// CSV export — power-seller download of completed listing_orders
// (Wave 5).
//
// Route: GET /api/v1/me/sales.csv
//
// Streams CSV directly to the response writer (no full-buffer in memory
// even for sellers with thousands of rows). Authentication is handled by
// the auth middleware; ownership comes from claims.UserID.
//
// Columns:
//   order_id, listing_title, sold_at, gross_cents, fee_cents, net_cents,
//   buyer_anonymized
//
// "buyer_anonymized" is the buyer's display name truncated to first
// initial + last initial (e.g. "Tanner Coker" → "T.C.") so the export
// is privacy-respecting. Full buyer identity is only available through
// the order detail endpoint with idempotency-keyed mutations.

import (
	"encoding/csv"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// CSVExportHandler streams completed orders as CSV.
type CSVExportHandler struct {
	db *pgxpool.Pool
}

// NewCSVExportHandler creates a new handler.
func NewCSVExportHandler(db *pgxpool.Pool) *CSVExportHandler {
	return &CSVExportHandler{db: db}
}

// ExportSales handles GET /api/v1/me/sales.csv.
func (h *CSVExportHandler) ExportSales(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT lo.id::text,
		       l.title,
		       lo.created_at,
		       lo.amount_cents,
		       lo.fee_cents,
		       (lo.amount_cents - lo.fee_cents)::bigint AS net_cents,
		       COALESCE(u.display_name, ''),
		       lo.escrow_status
		  FROM listing_orders lo
		  JOIN listings l        ON l.id = lo.listing_id
		  LEFT JOIN users u      ON u.id = lo.buyer_id
		 WHERE lo.seller_id = $1
		   AND lo.escrow_status IN ('held', 'pickup_confirmed', 'released')
		 ORDER BY lo.created_at DESC`,
		claims.UserID,
	)
	if err != nil {
		slog.Error("csv export: query", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load sales")
		return
	}
	defer rows.Close()

	// Use a filename with a timestamp so repeated exports don't collide
	// in the user's Downloads folder.
	filename := fmt.Sprintf("nomarkup-sales-%s.csv", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Cache-Control", "no-store")

	cw := csv.NewWriter(w)
	defer cw.Flush()

	// Header row.
	if err := cw.Write([]string{
		"order_id",
		"listing_title",
		"sold_at",
		"gross_cents",
		"fee_cents",
		"net_cents",
		"buyer_anonymized",
		"escrow_status",
	}); err != nil {
		slog.Error("csv export: write header", "error", err)
		return
	}

	for rows.Next() {
		var (
			orderID, title, buyerName, status string
			soldAt                             time.Time
			gross, fee, net                    int64
		)
		if err := rows.Scan(&orderID, &title, &soldAt, &gross, &fee, &net, &buyerName, &status); err != nil {
			slog.Warn("csv export: scan row", "error", err)
			continue
		}
		if err := cw.Write([]string{
			orderID,
			title,
			soldAt.UTC().Format(time.RFC3339),
			fmt.Sprintf("%d", gross),
			fmt.Sprintf("%d", fee),
			fmt.Sprintf("%d", net),
			anonymizeName(buyerName),
			status,
		}); err != nil {
			slog.Warn("csv export: write row", "error", err)
			return
		}
	}
}

// anonymizeName collapses a display name to first-initial / last-initial
// pair. "Tanner Coker" → "T.C.", "madonna" → "M.", "" → "—".
func anonymizeName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "—"
	}
	parts := strings.Fields(name)
	if len(parts) == 1 {
		return strings.ToUpper(parts[0][:1]) + "."
	}
	first := strings.ToUpper(parts[0][:1])
	last := strings.ToUpper(parts[len(parts)-1][:1])
	return first + "." + last + "."
}
