package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AuctionReplayHandler handles public auction replay endpoints.
// Reads directly from the auction_bid_events and jobs tables in PostgreSQL.
type AuctionReplayHandler struct {
	db *pgxpool.Pool
}

// NewAuctionReplayHandler creates a new AuctionReplayHandler.
// If db is nil (e.g. DATABASE_URL not set), endpoints return empty responses.
func NewAuctionReplayHandler(db *pgxpool.Pool) *AuctionReplayHandler {
	return &AuctionReplayHandler{db: db}
}

// replayEvent represents a single bid event in the replay timeline.
type replayEvent struct {
	ID          string    `json:"id"`
	JobID       string    `json:"job_id"`
	EventType   string    `json:"event_type"`
	AmountCents int64     `json:"amount_cents"`
	CreatedAt   time.Time `json:"created_at"`
}

// GetAuctionReplay returns the complete bid event timeline for a completed auction.
// Public endpoint — anyone can view replays of completed auctions.
// GET /api/v1/auctions/{jobId}/replay
func (h *AuctionReplayHandler) GetAuctionReplay(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"events": []interface{}{},
		})
		return
	}

	jobID := chi.URLParam(r, "jobId")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job ID is required")
		return
	}

	// First, verify the job exists and fetch metadata.
	// Only allow replay for completed/awarded jobs (status = 'completed' or 'awarded').
	var jobTitle string
	var categoryName string
	var startingBidCents *int64
	var auctionType string
	var jobStatus string
	err := h.db.QueryRow(r.Context(), `
		SELECT j.title, COALESCE(sc.name, ''), j.starting_bid_cents, j.auction_type, j.status
		FROM jobs j
		LEFT JOIN service_categories sc ON sc.id = j.category_id
		WHERE j.id = $1 AND j.deleted_at IS NULL
	`, jobID).Scan(&jobTitle, &categoryName, &startingBidCents, &auctionType, &jobStatus)
	if err != nil {
		slog.Error("failed to query job for replay", "job_id", jobID, "error", err)
		writeError(w, http.StatusNotFound, "auction not found")
		return
	}

	// Only allow replay for completed or awarded jobs.
	if jobStatus != "completed" && jobStatus != "awarded" {
		writeError(w, http.StatusForbidden, "replay is only available for completed auctions")
		return
	}

	// Query all bid events for this job, ordered by timestamp.
	rows, err := h.db.Query(r.Context(), `
		SELECT id, job_id, event_type, amount_cents, created_at
		FROM auction_bid_events
		WHERE job_id = $1
		ORDER BY created_at ASC
	`, jobID)
	if err != nil {
		slog.Error("failed to query auction bid events", "job_id", jobID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load replay data")
		return
	}
	defer rows.Close()

	events := make([]map[string]interface{}, 0)
	var winningBidCents int64
	bidCount := 0

	for rows.Next() {
		var ev replayEvent
		if err := rows.Scan(&ev.ID, &ev.JobID, &ev.EventType, &ev.AmountCents, &ev.CreatedAt); err != nil {
			slog.Error("failed to scan bid event row", "error", err)
			continue
		}

		events = append(events, map[string]interface{}{
			"id":           ev.ID,
			"job_id":       ev.JobID,
			"event_type":   ev.EventType,
			"amount_cents": ev.AmountCents,
			"created_at":   ev.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})

		// Track the lowest bid as the winning bid.
		if ev.EventType == "bid_placed" || ev.EventType == "bid_updated" {
			bidCount++
			if winningBidCents == 0 || ev.AmountCents < winningBidCents {
				winningBidCents = ev.AmountCents
			}
		}
	}

	if err := rows.Err(); err != nil {
		slog.Error("error iterating bid event rows", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load replay data")
		return
	}

	// Compute duration and savings.
	var durationSeconds float64
	if len(events) >= 2 {
		firstTime, ok := events[0]["created_at"].(string)
		if !ok {
			firstTime = ""
		}
		lastTime, ok := events[len(events)-1]["created_at"].(string)
		if !ok {
			lastTime = ""
		}
		first, err1 := time.Parse("2006-01-02T15:04:05Z", firstTime)
		last, err2 := time.Parse("2006-01-02T15:04:05Z", lastTime)
		if err1 == nil && err2 == nil {
			durationSeconds = last.Sub(first).Seconds()
		}
	}

	var startingCents int64
	if startingBidCents != nil {
		startingCents = *startingBidCents
	}

	var totalSavingsCents int64
	if startingCents > 0 && winningBidCents > 0 {
		totalSavingsCents = startingCents - winningBidCents
		if totalSavingsCents < 0 {
			totalSavingsCents = 0
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"events":              events,
		"job_title":           jobTitle,
		"category":            categoryName,
		"starting_bid_cents":  startingCents,
		"winning_bid_cents":   winningBidCents,
		"total_savings_cents": totalSavingsCents,
		"duration_seconds":    durationSeconds,
		"bid_count":           bidCount,
	})
}
