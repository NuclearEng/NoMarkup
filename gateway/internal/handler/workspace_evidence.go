package handler

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// Proof-of-work missing tokens — wire contract for GET work-evidence and
// POST /payments/{id}/release 409.
const (
	proofMissingCheckIn    = "check_in"
	proofMissingAfterPhoto = "after_photo"
)

// workEvidence is GET /api/v1/contracts/{id}/work-evidence. No lat/lng —
// those stay on the provider-only work-session GET.
type workEvidence struct {
	ReadyForRelease bool                  `json:"ready_for_release"`
	Missing         []string              `json:"missing"`
	Sessions        []workEvidenceSession `json:"sessions"`
	Photos          []workEvidencePhoto   `json:"photos"`
}

type workEvidenceSession struct {
	CheckedInAt     string  `json:"checked_in_at"`
	CheckedOutAt    *string `json:"checked_out_at"`
	DurationMinutes int     `json:"duration_minutes"`
}

type workEvidencePhoto struct {
	Phase      string `json:"phase"`
	URL        string `json:"url"`
	UploadedAt string `json:"uploaded_at"`
}

// proofOfWorkMissing lists unmet release requirements. Order is stable:
// check_in then after_photo (matches the F1 plan example).
func proofOfWorkMissing(hasCheckIn, hasAfterPhoto bool) []string {
	missing := make([]string, 0, 2)
	if !hasCheckIn {
		missing = append(missing, proofMissingCheckIn)
	}
	if !hasAfterPhoto {
		missing = append(missing, proofMissingAfterPhoto)
	}
	return missing
}

// proofOfWorkReady is at least one check-in session AND at least one after photo.
func proofOfWorkReady(hasCheckIn, hasAfterPhoto bool) bool {
	return hasCheckIn && hasAfterPhoto
}

func emptyWorkEvidence() workEvidence {
	return workEvidence{
		ReadyForRelease: false,
		Missing:         proofOfWorkMissing(false, false),
		Sessions:        []workEvidenceSession{},
		Photos:          []workEvidencePhoto{},
	}
}

func writeProofOfWorkRequired(w http.ResponseWriter, missing []string) {
	if missing == nil {
		missing = proofOfWorkMissing(false, false)
	}
	writeJSON(w, http.StatusConflict, map[string]interface{}{
		"error":   "proof of work required",
		"missing": missing,
	})
}

// evaluateProofOfWork is the release-gate query. A nil db cannot prove work
// (Redis TTL is not authority) — fail closed with both items missing.
// A missing session is not an error; query failures return err so the caller
// can fail closed without a 500.
func evaluateProofOfWork(ctx context.Context, db *pgxpool.Pool, contractID string) (ready bool, missing []string, err error) {
	if db == nil || contractID == "" {
		return false, proofOfWorkMissing(false, false), nil
	}

	var hasCheckIn, hasAfterPhoto bool
	err = db.QueryRow(ctx, `
		SELECT
			EXISTS (
				SELECT 1 FROM contract_work_sessions
				 WHERE contract_id = $1 AND checked_in_at IS NOT NULL
			),
			EXISTS (
				SELECT 1 FROM contract_completion_photos
				 WHERE contract_id = $1 AND phase = 'after'
			)`, contractID).Scan(&hasCheckIn, &hasAfterPhoto)
	if err != nil {
		return false, proofOfWorkMissing(false, false), err
	}
	return proofOfWorkReady(hasCheckIn, hasAfterPhoto), proofOfWorkMissing(hasCheckIn, hasAfterPhoto), nil
}

// loadWorkEvidence builds the customer/provider evidence pack. Never returns
// raw coordinates. A nil db or query error yields an empty not-ready pack
// (never 500 for a missing session).
func loadWorkEvidence(ctx context.Context, db *pgxpool.Pool, contractID string) (workEvidence, error) {
	out := emptyWorkEvidence()
	if db == nil || contractID == "" {
		return out, nil
	}

	sessRows, err := db.Query(ctx, `
		SELECT checked_in_at, checked_out_at, duration_minutes
		  FROM contract_work_sessions
		 WHERE contract_id = $1
		 ORDER BY checked_in_at ASC`, contractID)
	if err != nil {
		return out, err
	}
	defer sessRows.Close()

	sessions := make([]workEvidenceSession, 0)
	hasCheckIn := false
	for sessRows.Next() {
		var checkedIn time.Time
		var checkedOut *time.Time
		var duration *int
		if scanErr := sessRows.Scan(&checkedIn, &checkedOut, &duration); scanErr != nil {
			return out, scanErr
		}
		hasCheckIn = true
		item := workEvidenceSession{
			CheckedInAt: checkedIn.UTC().Format(time.RFC3339),
		}
		if checkedOut != nil {
			s := checkedOut.UTC().Format(time.RFC3339)
			item.CheckedOutAt = &s
		}
		if duration != nil {
			item.DurationMinutes = *duration
		}
		sessions = append(sessions, item)
	}
	if err = sessRows.Err(); err != nil {
		return out, err
	}

	photoRows, err := db.Query(ctx, `
		SELECT phase, url, created_at
		  FROM contract_completion_photos
		 WHERE contract_id = $1
		 ORDER BY created_at ASC`, contractID)
	if err != nil {
		return out, err
	}
	defer photoRows.Close()

	photos := make([]workEvidencePhoto, 0)
	hasAfter := false
	for photoRows.Next() {
		var phase, url string
		var uploaded time.Time
		if scanErr := photoRows.Scan(&phase, &url, &uploaded); scanErr != nil {
			return out, scanErr
		}
		if phase == "after" {
			hasAfter = true
		}
		photos = append(photos, workEvidencePhoto{
			Phase:      phase,
			URL:        url,
			UploadedAt: uploaded.UTC().Format(time.RFC3339),
		})
	}
	if err = photoRows.Err(); err != nil {
		return out, err
	}

	out.Sessions = sessions
	out.Photos = photos
	out.Missing = proofOfWorkMissing(hasCheckIn, hasAfter)
	out.ReadyForRelease = proofOfWorkReady(hasCheckIn, hasAfter)
	return out, nil
}

// GetWorkEvidence handles GET /api/v1/contracts/{id}/work-evidence.
// RequirePartyAccess is applied by the contract route group.
func (h *WorkspaceHandler) GetWorkEvidence(w http.ResponseWriter, r *http.Request) {
	if _, ok := middleware.GetClaims(r.Context()); !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	ev, err := loadWorkEvidence(r.Context(), h.db, contractID)
	if err != nil {
		// Missing rows are not an error (empty pack). A query failure must
		// not 500 the customer — fail closed as not-ready.
		slog.WarnContext(r.Context(), "work-evidence: load failed; returning not-ready pack",
			"contract_id", contractID,
			"error", err,
		)
		ev = emptyWorkEvidence()
	}
	writeJSON(w, http.StatusOK, ev)
}
