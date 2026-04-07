package handler

import (
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	imagingv1 "github.com/nomarkup/nomarkup/proto/imaging/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// WorkspaceHandler handles provider workspace endpoints (check-in/out, completion photos).
type WorkspaceHandler struct {
	cache         *cache.Client
	imagingClient imagingv1.ImagingServiceClient
}

// NewWorkspaceHandler creates a new WorkspaceHandler.
func NewWorkspaceHandler(cacheClient *cache.Client, imagingClient imagingv1.ImagingServiceClient) *WorkspaceHandler {
	return &WorkspaceHandler{
		cache:         cacheClient,
		imagingClient: imagingClient,
	}
}

// checkInData is the Redis-stored check-in record.
type checkInData struct {
	Lat       float64   `json:"lat"`
	Lng       float64   `json:"lng"`
	Timestamp time.Time `json:"timestamp"`
}

// checkOutData is the Redis-stored check-out record.
type checkOutData struct {
	Lat             float64   `json:"lat"`
	Lng             float64   `json:"lng"`
	Timestamp       time.Time `json:"timestamp"`
	DurationMinutes int       `json:"duration_minutes"`
}

type locationRequest struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

const workSessionTTL = 24 * time.Hour

// CheckIn handles POST /api/v1/contracts/{id}/checkin.
func (h *WorkspaceHandler) CheckIn(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	var req locationRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	now := time.Now().UTC()

	data := checkInData{
		Lat:       req.Lat,
		Lng:       req.Lng,
		Timestamp: now,
	}

	key := fmt.Sprintf("contract:checkin:%s:%s", contractID, claims.UserID)
	h.cache.SetJSON(r.Context(), key, data, workSessionTTL)

	slog.Info("provider checked in",
		"contract_id", contractID,
		"user_id", claims.UserID,
		"lat", req.Lat,
		"lng", req.Lng,
	)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"checked_in_at": now.Format(time.RFC3339),
	})
}

// CheckOut handles POST /api/v1/contracts/{id}/checkout.
func (h *WorkspaceHandler) CheckOut(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	var req locationRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Read the check-in record to compute duration.
	checkinKey := fmt.Sprintf("contract:checkin:%s:%s", contractID, claims.UserID)
	var checkin checkInData
	if !h.cache.GetJSON(r.Context(), checkinKey, &checkin) {
		writeError(w, http.StatusBadRequest, "no active check-in found for this contract")
		return
	}

	now := time.Now().UTC()
	durationMinutes := int(math.Round(now.Sub(checkin.Timestamp).Minutes()))
	if durationMinutes < 0 {
		durationMinutes = 0
	}

	data := checkOutData{
		Lat:             req.Lat,
		Lng:             req.Lng,
		Timestamp:       now,
		DurationMinutes: durationMinutes,
	}

	checkoutKey := fmt.Sprintf("contract:checkout:%s:%s", contractID, claims.UserID)
	h.cache.SetJSON(r.Context(), checkoutKey, data, workSessionTTL)

	slog.Info("provider checked out",
		"contract_id", contractID,
		"user_id", claims.UserID,
		"duration_minutes", durationMinutes,
	)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"checked_out_at":   now.Format(time.RFC3339),
		"duration_minutes": durationMinutes,
	})
}

// GetWorkSession handles GET /api/v1/contracts/{id}/work-session.
func (h *WorkspaceHandler) GetWorkSession(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	checkinKey := fmt.Sprintf("contract:checkin:%s:%s", contractID, claims.UserID)
	checkoutKey := fmt.Sprintf("contract:checkout:%s:%s", contractID, claims.UserID)

	var checkin checkInData
	hasCheckin := h.cache.GetJSON(r.Context(), checkinKey, &checkin)

	var checkout checkOutData
	hasCheckout := h.cache.GetJSON(r.Context(), checkoutKey, &checkout)

	result := map[string]interface{}{
		"status":           "not_started",
		"checked_in_at":    nil,
		"checked_out_at":   nil,
		"duration_minutes": nil,
	}

	if hasCheckin {
		result["checked_in_at"] = checkin.Timestamp.Format(time.RFC3339)
		result["status"] = "checked_in"
	}

	if hasCheckout {
		result["checked_out_at"] = checkout.Timestamp.Format(time.RFC3339)
		result["duration_minutes"] = checkout.DurationMinutes
		result["status"] = "checked_out"
	}

	writeJSON(w, http.StatusOK, result)
}

// UploadCompletionPhoto handles POST /api/v1/contracts/{id}/completion-photos.
// Accepts multipart/form-data with fields: photo (file), phase ("before"|"after").
func (h *WorkspaceHandler) UploadCompletionPhoto(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	// Limit to 10MB per the security rules.
	const maxUploadSize = 10 << 20
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form or file too large (max 10MB)")
		return
	}

	phase := r.FormValue("phase")
	if phase != "before" && phase != "after" {
		writeError(w, http.StatusBadRequest, "phase must be 'before' or 'after'")
		return
	}

	file, header, err := r.FormFile("photo")
	if err != nil {
		writeError(w, http.StatusBadRequest, "photo field required")
		return
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			slog.Warn("failed to close upload file", "error", closeErr)
		}
	}()

	// Read the file content for MIME type sniffing (server-side, don't trust Content-Type header).
	buf := make([]byte, 512)
	n, readErr := file.Read(buf)
	if readErr != nil && readErr != io.EOF {
		writeError(w, http.StatusBadRequest, "failed to read file")
		return
	}
	detectedMIME := http.DetectContentType(buf[:n])
	if !strings.HasPrefix(detectedMIME, "image/") {
		writeError(w, http.StatusBadRequest, "file must be an image")
		return
	}

	// Get a pre-signed upload URL from the imaging service.
	filename := header.Filename
	if filename == "" {
		filename = fmt.Sprintf("completion-%s-%s.jpg", contractID, phase)
	}

	uploadResp, err := h.imagingClient.GetUploadURL(r.Context(), &imagingv1.GetUploadURLRequest{
		UserId:        claims.UserID,
		Filename:      filename,
		MimeType:      detectedMIME,
		FileSizeBytes: int32(header.Size), //nolint:gosec // file size bounded by maxUploadSize
		Context:       "completion_photo",
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	// Upload the file to the pre-signed URL.
	// Re-read from the beginning (we read 512 bytes for sniffing).
	if _, seekErr := file.Seek(0, io.SeekStart); seekErr != nil {
		writeError(w, http.StatusInternalServerError, "failed to process file")
		return
	}

	uploadReq, err := http.NewRequestWithContext(r.Context(), http.MethodPut, uploadResp.GetUploadUrl(), file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create upload request")
		return
	}
	uploadReq.Header.Set("Content-Type", detectedMIME)
	uploadReq.ContentLength = header.Size

	httpClient := &http.Client{}
	uploadHTTPResp, err := httpClient.Do(uploadReq)
	if err != nil {
		slog.Error("completion photo upload to storage failed",
			"contract_id", contractID,
			"error", err,
		)
		writeError(w, http.StatusBadGateway, "failed to upload file to storage")
		return
	}
	defer func() {
		_ = uploadHTTPResp.Body.Close()
	}()

	if uploadHTTPResp.StatusCode >= 300 {
		writeError(w, http.StatusBadGateway, "storage upload rejected")
		return
	}

	// Confirm the upload with the imaging service and get the processed URL.
	confirmResp, err := h.imagingClient.ConfirmUpload(r.Context(), &imagingv1.ConfirmUploadRequest{
		ObjectKey: uploadResp.GetObjectKey(),
		UserId:    claims.UserID,
		Context:   "completion_photo",
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	// Log the event for observability.
	slog.Info("completion photo uploaded",
		"contract_id", contractID,
		"user_id", claims.UserID,
		"phase", phase,
		"url", confirmResp.GetSourceUrl(),
	)

	// Store photo metadata in Redis so the work session knows about it.
	photoKey := fmt.Sprintf("contract:photo:%s:%s:%s", contractID, claims.UserID, phase)
	photoMeta := map[string]interface{}{
		"url":         confirmResp.GetSourceUrl(),
		"phase":       phase,
		"uploaded_at": time.Now().UTC().Format(time.RFC3339),
	}
	h.cache.SetJSON(r.Context(), photoKey, photoMeta, workSessionTTL)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"url":   confirmResp.GetSourceUrl(),
		"phase": phase,
	})
}

