package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	imagingv1 "github.com/nomarkup/nomarkup/proto/imaging/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// WorkspaceHandler handles provider workspace endpoints (check-in/out, completion photos).
//
// Check-in / check-out store client lat/lng and enforce a server-side geo-fence
// against the job's service location (exact point from
// jobs.service_location_encrypted when available; otherwise the PostGIS
// service_location geometry). Fail soft when the job has no usable location
// or the DB is unavailable so providers are never blocked from logging work.
type WorkspaceHandler struct {
	cache         *cache.Client
	imagingClient imagingv1.ImagingServiceClient
	db            *pgxpool.Pool
	cipher        *crypto.Cipher
	// maxDistanceMeters is the geo-fence radius for check-in/out (default 500).
	maxDistanceMeters float64
	// resolveJobSite is the production PostGIS + secretbox path; unit tests
	// override it to exercise fence accept/reject without a live database.
	resolveJobSite func(ctx context.Context, contractID string) (lat, lng float64, found bool, err error)
	// sessions is the durable check-in/out store (Postgres). nil when the
	// gateway runs without DATABASE_URL (development only).
	sessions workSessionStore
	// legacy reads pre-migration-138 Redis keys. See workspace_legacy_redis.go
	// for the removal note.
	legacy legacyWorkSessionCache
}

// defaultCheckInMaxDistanceMeters is the on-site proximity radius when
// CHECKIN_MAX_DISTANCE_METERS is unset or invalid.
const defaultCheckInMaxDistanceMeters = 500.0

// NewWorkspaceHandler creates a new WorkspaceHandler.
//
// db and cipher power the FE-13 geo-fence. Either may be nil — check-in then
// fails soft (no fence). cipher is variadic so existing two-arg composition
// roots still compile; pass the shared piiCipher for exact-point decrypt.
func NewWorkspaceHandler(
	cacheClient *cache.Client,
	imagingClient imagingv1.ImagingServiceClient,
	db *pgxpool.Pool,
	cipher ...*crypto.Cipher,
) *WorkspaceHandler {
	h := &WorkspaceHandler{
		cache:             cacheClient,
		imagingClient:     imagingClient,
		db:                db,
		maxDistanceMeters: checkInMaxDistanceMetersFromEnv(),
	}
	if len(cipher) > 0 && cipher[0] != nil {
		h.cipher = cipher[0]
	} else if db != nil {
		// Prefer the shared cipher from main; fall back to FromEnv so a
		// mis-wired composition root still opens service_location_encrypted
		// when ENCRYPTION_KEY is present.
		c, err := crypto.FromEnv()
		if err != nil {
			slog.Warn("workspace: no PII cipher; geo-fence will use coarse service_location only",
				"error", err)
		} else {
			h.cipher = c
		}
	}
	h.resolveJobSite = h.lookupJobSite
	h.legacy = legacyWorkSessionCache{cache: cacheClient}
	if db != nil {
		h.sessions = pgWorkSessionStore{db: db, cipher: h.cipher}
	}
	return h
}

func checkInMaxDistanceMetersFromEnv() float64 {
	raw := strings.TrimSpace(os.Getenv("CHECKIN_MAX_DISTANCE_METERS"))
	if raw == "" {
		return defaultCheckInMaxDistanceMeters
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || v <= 0 || math.IsNaN(v) || math.IsInf(v, 0) {
		slog.Warn("workspace: invalid CHECKIN_MAX_DISTANCE_METERS; using default",
			"value", raw,
			"default", defaultCheckInMaxDistanceMeters,
		)
		return defaultCheckInMaxDistanceMeters
	}
	return v
}

type locationRequest struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// earthRadiusMeters is the mean Earth radius used by haversineMeters.
const earthRadiusMeters = 6_371_000.0

// haversineMeters returns the great-circle distance between two WGS84 points.
func haversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	toRad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLng := toRad(lng2 - lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusMeters * c
}

// parseExactPoint reverses FormatExactPoint ("<lat>,<lng>" with 7 decimals).
// Mirrors services/job/internal/domain.ParseExactPoint — kept local so the
// gateway does not import the job service package.
func parseExactPoint(s string) (lat, lng float64, err error) {
	latStr, lngStr, ok := strings.Cut(s, ",")
	if !ok {
		return 0, 0, fmt.Errorf("parse exact point: want \"<lat>,<lng>\"")
	}
	lat, err = strconv.ParseFloat(strings.TrimSpace(latStr), 64)
	if err != nil {
		return 0, 0, fmt.Errorf("parse exact point latitude: %w", err)
	}
	lng, err = strconv.ParseFloat(strings.TrimSpace(lngStr), 64)
	if err != nil {
		return 0, 0, fmt.Errorf("parse exact point longitude: %w", err)
	}
	if math.IsNaN(lat) || math.IsNaN(lng) {
		return 0, 0, fmt.Errorf("parse exact point: coordinate is NaN")
	}
	if lat < -90 || lat > 90 {
		return 0, 0, fmt.Errorf("parse exact point: latitude %g outside [-90,90]", lat)
	}
	if lng < -180 || lng > 180 {
		return 0, 0, fmt.Errorf("parse exact point: longitude %g outside [-180,180]", lng)
	}
	return lat, lng, nil
}

// isUsableJobSite rejects the GDPR / empty sentinel (0,0) and non-finite coords.
func isUsableJobSite(lat, lng float64) bool {
	if math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) {
		return false
	}
	// (0,0) is the erasure / unset sentinel written by GDPR delete paths.
	if lat == 0 && lng == 0 {
		return false
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return false
	}
	return true
}

// validateClientLocation rejects missing/out-of-range GPS from the client.
func validateClientLocation(lat, lng float64) error {
	if math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) {
		return errors.New("lat and lng must be finite numbers")
	}
	if lat < -90 || lat > 90 {
		return fmt.Errorf("latitude %g outside [-90,90]", lat)
	}
	if lng < -180 || lng > 180 {
		return fmt.Errorf("longitude %g outside [-180,180]", lng)
	}
	return nil
}

// enforceGeofence loads the job site for contractID and rejects when the
// provider is farther than maxDistanceMeters. Fail soft (return nil) when
// there is no usable job location or the lookup cannot complete.
func (h *WorkspaceHandler) enforceGeofence(ctx context.Context, contractID string, lat, lng float64) error {
	if h == nil {
		return nil
	}
	resolve := h.resolveJobSite
	if resolve == nil {
		resolve = h.lookupJobSite
	}
	siteLat, siteLng, found, err := resolve(ctx, contractID)
	if err != nil {
		// Fail soft: DB blips must not strand a provider mid-job.
		slog.WarnContext(ctx, "workspace geo-fence: job site lookup failed; allowing check-in/out",
			"contract_id", contractID,
			"error", err,
		)
		return nil
	}
	if !found || !isUsableJobSite(siteLat, siteLng) {
		slog.InfoContext(ctx, "workspace geo-fence: no usable job location; allowing check-in/out",
			"contract_id", contractID,
		)
		return nil
	}

	maxM := h.maxDistanceMeters
	if maxM <= 0 {
		maxM = defaultCheckInMaxDistanceMeters
	}
	dist := haversineMeters(lat, lng, siteLat, siteLng)
	if dist > maxM {
		return fmt.Errorf(
			"you are too far from the job site to check in/out (%.0f m away; must be within %.0f m)",
			dist, maxM,
		)
	}
	return nil
}

// lookupJobSite resolves the service location for the contract's job.
// Prefers jobs.service_location_encrypted (exact); falls back to
// ST_Y/ST_X(service_location) for legacy/coarse rows.
func (h *WorkspaceHandler) lookupJobSite(ctx context.Context, contractID string) (lat, lng float64, found bool, err error) {
	if h.db == nil {
		return 0, 0, false, nil
	}

	var geomLat, geomLng *float64
	var encrypted *string
	qErr := h.db.QueryRow(ctx, `
		SELECT ST_Y(j.service_location), ST_X(j.service_location),
		       j.service_location_encrypted
		  FROM contracts c
		  JOIN jobs j ON j.id = c.job_id
		 WHERE c.id = $1
		   AND c.deleted_at IS NULL
		   AND j.deleted_at IS NULL`, contractID).Scan(&geomLat, &geomLng, &encrypted)
	if qErr != nil {
		if errors.Is(qErr, pgx.ErrNoRows) {
			return 0, 0, false, nil
		}
		return 0, 0, false, fmt.Errorf("lookup job site: %w", qErr)
	}

	if encrypted != nil && *encrypted != "" && h.cipher != nil {
		plain, derr := h.cipher.DecryptStringOrPassthrough(*encrypted)
		if derr != nil {
			// Key misconfig: fall back to coarse geometry rather than hard-fail.
			slog.WarnContext(ctx, "workspace geo-fence: service_location_encrypted decrypt failed; using coarse geometry",
				"contract_id", contractID,
				"error", derr,
			)
		} else {
			exactLat, exactLng, perr := parseExactPoint(plain)
			if perr != nil {
				slog.WarnContext(ctx, "workspace geo-fence: encrypted point malformed; using coarse geometry",
					"contract_id", contractID,
					"error", perr,
				)
			} else if isUsableJobSite(exactLat, exactLng) {
				return exactLat, exactLng, true, nil
			}
		}
	} else if encrypted != nil && *encrypted != "" && h.cipher == nil {
		slog.WarnContext(ctx, "workspace geo-fence: encrypted point present but no cipher; using coarse geometry",
			"contract_id", contractID,
		)
	}

	if geomLat == nil || geomLng == nil {
		return 0, 0, false, nil
	}
	if !isUsableJobSite(*geomLat, *geomLng) {
		return 0, 0, false, nil
	}
	return *geomLat, *geomLng, true, nil
}

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
	if err := validateClientLocation(req.Lat, req.Lng); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.enforceGeofence(r.Context(), contractID, req.Lat, req.Lng); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	now := time.Now().UTC()

	// Postgres is the only store (migration 138): Redis is volatile-lru and a
	// check-in is dispute evidence.
	if err := h.persistCheckIn(r.Context(), contractID, claims.UserID, req.Lat, req.Lng, now); err != nil {
		slog.ErrorContext(r.Context(), "workspace: persist check-in failed",
			"contract_id", contractID,
			"user_id", claims.UserID,
			"error", err,
		)
		writeError(w, http.StatusServiceUnavailable, "failed to save check-in")
		return
	}

	// A fresh check-in supersedes any pre-138 Redis copy (LEGACY — see
	// workspace_legacy_redis.go), so the read fallback can never report a
	// stale "checked_out" over the new open session.
	h.legacy.forget(r.Context(), contractID, claims.UserID)

	// Coordinates are PII (migration 138) and are not logged.
	slog.InfoContext(r.Context(), "provider checked in",
		"contract_id", contractID,
		"user_id", claims.UserID,
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
	if err := validateClientLocation(req.Lat, req.Lng); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.enforceGeofence(r.Context(), contractID, req.Lat, req.Lng); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Resolve the open check-in from Postgres. LEGACY: a check-in that exists
	// only as a pre-138 Redis key is still honoured (and made durable by the
	// check-out write below); see workspace_legacy_redis.go for removal.
	checkedInAt, found, err := h.openSessionCheckInAt(r.Context(), contractID, claims.UserID)
	if err != nil {
		slog.WarnContext(r.Context(), "workspace: open session lookup failed",
			"contract_id", contractID,
			"error", err,
		)
	}
	if !found {
		legacyIn, ok := h.legacy.checkIn(r.Context(), contractID, claims.UserID)
		if !ok {
			writeError(w, http.StatusBadRequest, "no active check-in found for this contract")
			return
		}
		checkedInAt = legacyIn.Timestamp
	}

	now := time.Now().UTC()
	durationMinutes := int(math.Round(now.Sub(checkedInAt).Minutes()))
	if durationMinutes < 0 {
		durationMinutes = 0
	}

	if err := h.persistCheckOut(r.Context(), contractID, claims.UserID, req.Lat, req.Lng, now, durationMinutes, checkedInAt); err != nil {
		slog.ErrorContext(r.Context(), "workspace: persist check-out failed",
			"contract_id", contractID,
			"user_id", claims.UserID,
			"error", err,
		)
		writeError(w, http.StatusServiceUnavailable, "failed to save check-out")
		return
	}

	h.legacy.forget(r.Context(), contractID, claims.UserID)

	slog.InfoContext(r.Context(), "provider checked out",
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

	// Postgres is the authority (migration 138).
	sess, ok, err := h.latestWorkSession(r.Context(), contractID, claims.UserID)
	if err != nil {
		slog.WarnContext(r.Context(), "workspace: latest session lookup failed; trying legacy cache",
			"contract_id", contractID,
			"error", err,
		)
	} else if ok {
		result := map[string]interface{}{
			"status":           "checked_in",
			"checked_in_at":    sess.checkedInAt.UTC().Format(time.RFC3339),
			"checked_out_at":   nil,
			"duration_minutes": nil,
		}
		if sess.checkedOutAt != nil {
			result["checked_out_at"] = sess.checkedOutAt.UTC().Format(time.RFC3339)
			result["duration_minutes"] = sess.durationMinutes
			result["status"] = "checked_out"
		}
		writeJSON(w, http.StatusOK, result)
		return
	}

	// LEGACY: pre-138 Redis keys (read-only; removal note in
	// workspace_legacy_redis.go). Renders "not_started" when neither exists.
	in, hasIn := h.legacy.checkIn(r.Context(), contractID, claims.UserID)
	out, hasOut := h.legacy.checkOut(r.Context(), contractID, claims.UserID)
	result, _ := legacyWorkSessionResult(in, hasIn, out, hasOut)
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

	// Limit to 10MB per the security rules (CLAUDE.md §6).
	//
	// ParseMultipartForm's argument is maxMEMORY, not a request-size cap: Go
	// spools anything larger to a temp file and returns no error, so on its
	// own it enforced nothing and the "bounded by maxUploadSize" claim below
	// was false. http.MaxBytesReader is the actual cap — it makes the read
	// fail once the body exceeds the limit, and closes the connection so the
	// client cannot keep streaming.
	const maxUploadSize = 10 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "invalid multipart form or file too large (max 10MB)")
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
		UserId:   claims.UserID,
		Filename: filename,
		MimeType: detectedMIME,
		// Safe conversion: MaxBytesReader above caps the body at 10MB, so
		// header.Size cannot exceed that and cannot overflow int32.
		FileSizeBytes: int32(header.Size), //nolint:gosec // bounded by MaxBytesReader(maxUploadSize)
		// Completion (before/after) photos are job evidence; the imaging service
		// only accepts a fixed set of contexts (avatar, portfolio, job_photo,
		// document, review_photo, listing). "completion_photo" is not one of them
		// and was rejected with a 400, which silently blocked the entire
		// before/after upload — and therefore "Mark Complete", which is gated on
		// an after-photo. job_photo is the correct, already-supported context.
		Context: "job_photo",
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
		Context:   "job_photo",
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

	if err := h.persistCompletionPhoto(r.Context(), contractID, claims.UserID, phase, confirmResp.GetSourceUrl()); err != nil {
		slog.ErrorContext(r.Context(), "workspace: persist completion photo failed",
			"contract_id", contractID,
			"user_id", claims.UserID,
			"phase", phase,
			"error", err,
		)
		writeError(w, http.StatusServiceUnavailable, "failed to save completion photo")
		return
	}

	// contract_completion_photos is the only store (migration 138 dropped the
	// write-only Redis copy under contract:photo:*).

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"url":   confirmResp.GetSourceUrl(),
		"phase": phase,
	})
}

// persistCheckIn writes a durable session (see workSessionStore). A nil
// store — a development gateway without DATABASE_URL — is a no-op.
func (h *WorkspaceHandler) persistCheckIn(ctx context.Context, contractID, providerID string, lat, lng float64, at time.Time) error {
	if h.sessions == nil {
		return nil
	}
	return h.sessions.RecordCheckIn(ctx, contractID, providerID, lat, lng, at)
}

// persistCheckOut closes the open session, or inserts a closed one from
// checkedInAt when none is open (a legacy Redis-only check-in) so release
// still has durable evidence.
func (h *WorkspaceHandler) persistCheckOut(
	ctx context.Context,
	contractID, providerID string,
	lat, lng float64,
	at time.Time,
	durationMinutes int,
	checkedInAt time.Time,
) error {
	if h.sessions == nil {
		return nil
	}
	return h.sessions.RecordCheckOut(ctx, contractID, providerID, lat, lng, at, durationMinutes, checkedInAt)
}

func (h *WorkspaceHandler) persistCompletionPhoto(ctx context.Context, contractID, uploadedBy, phase, url string) error {
	if h.db == nil {
		return nil
	}
	_, err := h.db.Exec(ctx, `
		INSERT INTO contract_completion_photos (contract_id, uploaded_by, phase, url)
		VALUES ($1, $2, $3, $4)`,
		contractID, uploadedBy, phase, url)
	if err != nil {
		return fmt.Errorf("persist completion photo: %w", err)
	}
	return nil
}

func (h *WorkspaceHandler) openSessionCheckInAt(ctx context.Context, contractID, providerID string) (time.Time, bool, error) {
	if h.sessions == nil {
		return time.Time{}, false, nil
	}
	return h.sessions.OpenCheckIn(ctx, contractID, providerID)
}

func (h *WorkspaceHandler) latestWorkSession(ctx context.Context, contractID, providerID string) (persistedWorkSession, bool, error) {
	if h.sessions == nil {
		return persistedWorkSession{}, false, nil
	}
	return h.sessions.Latest(ctx, contractID, providerID)
}
