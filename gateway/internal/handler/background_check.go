package handler

// FR-2.9 Checkr scaffold — provider self-service background checks.
//
// Routes (RequireProvider + RequireFlag("background_checks")):
//
//	GET  /api/v1/providers/me/background-check  → latest row or not_started
//	POST /api/v1/providers/me/background-check  → start Checkr candidate (+ invitation/report)
//
// Public webhook (no JWT; HMAC required):
//
//	POST /api/v1/webhooks/checkr  → status updates after signature verify
//
// Fail-closed rules:
//   - CHECKR_API_KEY unset on POST → 503 with a clear message (never invent PASS).
//   - CHECKR_WEBHOOK_SECRET unset on webhook → 503 (never persist).
//   - Webhook signature missing/invalid → 401 (never persist).
//   - DB unavailable → 503.
//   - Checkr HTTP errors → 502; row is not written as clear/pass.
//
// Env (documented in .env.example):
//
//	CHECKR_API_KEY          required for POST (secret key; Basic auth username)
//	CHECKR_API_BASE_URL     default https://api.checkr.com/v1
//	                        staging: https://api.checkr-staging.com/v1
//	CHECKR_PACKAGE          package slug for invitation/report (required when key set)
//	CHECKR_WORK_STATE       optional ISO state for invitation work_locations (default CA)
//	CHECKR_WEBHOOK_SECRET   required for POST /webhooks/checkr (HMAC-SHA256)

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	"github.com/nomarkup/nomarkup/gateway/internal/observability"
)

const (
	checkrAPIKeyMissingMsg        = "Background checks are not configured (CHECKR_API_KEY missing). Contact support or set the Checkr secret key."
	checkrPackageMissingMsg       = "Background checks are misconfigured (CHECKR_PACKAGE missing). Set the Checkr package slug."
	checkrWebhookSecretMissingMsg = "Checkr webhooks are not configured (CHECKR_WEBHOOK_SECRET missing)."
	checkrWebhookSignatureInvalid = "invalid Checkr webhook signature"
	checkrUnavailableMsg          = "Background check provider is temporarily unavailable. Please try again shortly."
	checkrDefaultBaseURL          = "https://api.checkr.com/v1"
	checkrDefaultWorkState        = "CA"
	checkrHTTPTimeout             = 15 * time.Second
	checkrWebhookSignatureHeader  = "X-Checkr-Signature"
)

// BackgroundCheckHandler owns provider_background_checks + outbound Checkr calls.
type BackgroundCheckHandler struct {
	db     *pgxpool.Pool
	client *http.Client
	// apiKey / baseURL / packageSlug are resolved per-request from env so tests
	// can t.Setenv without reconstructing the handler. client is injectable for tests.
}

// NewBackgroundCheckHandler constructs a handler. A nil db short-circuits every
// endpoint to 503 (matches marketplace surface). HTTP client is traced + timed.
func NewBackgroundCheckHandler(db *pgxpool.Pool) *BackgroundCheckHandler {
	client := observability.NewTracedHTTPClient("checkr")
	// NewTracedHTTPClient defaults to 5s; Checkr candidate+invitation can be
	// slower on staging, so raise the bound for this dependency only.
	client.Timeout = checkrHTTPTimeout
	return &BackgroundCheckHandler{db: db, client: client}
}

// SetHTTPClient overrides the outbound client (unit tests with httptest.Server).
func (h *BackgroundCheckHandler) SetHTTPClient(c *http.Client) {
	if c != nil {
		h.client = c
	}
}

// backgroundCheckJSON is the public response shape for GET/POST.
// invitation_url is the Checkr hosted-invite link when the vendor returned one
// (persisted in report_url). Never invent status=clear / PASS here.
type backgroundCheckJSON struct {
	Status        string  `json:"status"`
	CheckrID      *string `json:"checkr_id,omitempty"`
	ReportURL     *string `json:"report_url,omitempty"`
	InvitationURL *string `json:"invitation_url,omitempty"`
	CreatedAt     *string `json:"created_at,omitempty"`
	UpdatedAt     *string `json:"updated_at,omitempty"`
}

// Get handles GET /api/v1/providers/me/background-check.
// Returns the latest row for the caller, or {status: "not_started"} when none.
// Read path does not require CHECKR_API_KEY (status is local DB state only).
func (h *BackgroundCheckHandler) Get(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	row, err := h.latest(r.Context(), claims.UserID)
	if err != nil {
		if errorsIsNoRows(err) {
			writeJSON(w, http.StatusOK, backgroundCheckJSON{Status: "not_started"})
			return
		}
		slog.ErrorContext(r.Context(), "background_check: get failed",
			"user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load background check status")
		return
	}
	writeJSON(w, http.StatusOK, hydrateBackgroundCheckJSON(row))
}

// Create handles POST /api/v1/providers/me/background-check.
// Fail-closed without CHECKR_API_KEY. When configured, creates a Checkr
// candidate (+ invitation when CHECKR_PACKAGE is set) and persists a pending row.
// Never writes status=clear / invents a pass without a vendor response that says so.
func (h *BackgroundCheckHandler) Create(w http.ResponseWriter, r *http.Request) {
	// Order: claims → Checkr config (fail-closed) → db → vendor HTTP.
	// Config is checked before DB so missing CHECKR_API_KEY never depends on
	// pool availability and unit tests can assert 503 without Postgres.
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	apiKey := strings.TrimSpace(os.Getenv("CHECKR_API_KEY"))
	if apiKey == "" {
		writeError(w, http.StatusServiceUnavailable, checkrAPIKeyMissingMsg)
		return
	}
	packageSlug := strings.TrimSpace(os.Getenv("CHECKR_PACKAGE"))
	if packageSlug == "" {
		writeError(w, http.StatusServiceUnavailable, checkrPackageMissingMsg)
		return
	}

	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	// Idempotent soft-guard: if a non-terminal check is already in flight, return it.
	if existing, err := h.latest(r.Context(), claims.UserID); err == nil {
		switch existing.Status {
		case "pending", "complete":
			// "complete" without clear/consider still means in-progress adjudication.
			// Return existing pending; do not open a second Checkr order blindly.
			if existing.Status == "pending" {
				writeJSON(w, http.StatusOK, hydrateBackgroundCheckJSON(existing))
				return
			}
		}
	}

	email, first, last, err := h.loadUserIdentity(r.Context(), claims.UserID)
	if err != nil {
		slog.ErrorContext(r.Context(), "background_check: load user",
			"user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load provider profile for background check")
		return
	}
	if email == "" {
		writeError(w, http.StatusBadRequest, "email is required to start a background check")
		return
	}

	baseURL := checkrBaseURL()
	client := h.client
	if client == nil {
		client = &http.Client{Timeout: checkrHTTPTimeout}
	}

	candidateID, err := checkrCreateCandidate(r.Context(), client, baseURL, apiKey, email, first, last)
	if err != nil {
		slog.ErrorContext(r.Context(), "background_check: checkr candidate",
			"user_id", claims.UserID, "error", err)
		writeError(w, http.StatusBadGateway, checkrUnavailableMsg)
		return
	}

	reportURL, reportOrInviteID, err := checkrCreateInvitation(
		r.Context(), client, baseURL, apiKey, candidateID, packageSlug, checkrWorkState(),
	)
	if err != nil {
		// Candidate was created; still record pending with candidate id so support
		// can recover. Invitation failure is a 502 but we keep the row.
		slog.ErrorContext(r.Context(), "background_check: checkr invitation",
			"user_id", claims.UserID, "candidate_id", candidateID, "error", err)
		// Prefer candidate id as checkr_id when invitation fails.
		if _, insertErr := h.insert(r.Context(), claims.UserID, "pending", candidateID, ""); insertErr != nil {
			slog.ErrorContext(r.Context(), "background_check: insert after invite fail",
				"user_id", claims.UserID, "error", insertErr)
		}
		writeError(w, http.StatusBadGateway, checkrUnavailableMsg)
		return
	}

	// Prefer report/invitation id when present; fall back to candidate id.
	checkrID := candidateID
	if reportOrInviteID != "" {
		checkrID = reportOrInviteID
	}

	row, err := h.insert(r.Context(), claims.UserID, "pending", checkrID, reportURL)
	if err != nil {
		slog.ErrorContext(r.Context(), "background_check: insert",
			"user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save background check")
		return
	}

	slog.InfoContext(r.Context(), "background_check: started",
		"user_id", claims.UserID,
		"checkr_id", checkrID,
		"candidate_id", candidateID,
	)
	writeJSON(w, http.StatusCreated, hydrateBackgroundCheckJSON(row))
}

// HandleWebhook handles POST /api/v1/webhooks/checkr.
// No JWT. Fail-closed without CHECKR_WEBHOOK_SECRET. Persists status
// updates only after HMAC-SHA256 verification of X-Checkr-Signature.
// Never invents PASS / clear from an unverified or unmapped payload.
func (h *BackgroundCheckHandler) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	secret := strings.TrimSpace(os.Getenv("CHECKR_WEBHOOK_SECRET"))
	if secret == "" {
		writeError(w, http.StatusServiceUnavailable, checkrWebhookSecretMissingMsg)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxJSONBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	defer r.Body.Close()

	sig := r.Header.Get(checkrWebhookSignatureHeader)
	if !checkrWebhookSignatureValid(secret, body, sig) {
		slog.WarnContext(r.Context(), "checkr webhook: signature rejected",
			"signature_present", strings.TrimSpace(sig) != "",
			"payload_bytes", len(body),
		)
		writeError(w, http.StatusUnauthorized, checkrWebhookSignatureInvalid)
		return
	}

	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	event, ids, reportURL, ok := parseCheckrWebhook(body)
	if !ok {
		// Verified but unusable — ack so Checkr does not retry; do not persist.
		slog.InfoContext(r.Context(), "checkr webhook: ignored unusable payload",
			"payload_bytes", len(body),
		)
		writeJSON(w, http.StatusOK, map[string]bool{"received": true})
		return
	}

	status, mapped := mapCheckrWebhookStatus(event.Type, event.Data.Object.Status, event.Data.Object.Result)
	if !mapped {
		slog.InfoContext(r.Context(), "checkr webhook: no persist for unmapped status",
			"type", event.Type,
			"object_status", event.Data.Object.Status,
			"result", event.Data.Object.Result,
		)
		writeJSON(w, http.StatusOK, map[string]bool{"received": true})
		return
	}

	n, err := h.updateStatusByCheckrIDs(r.Context(), status, reportURL, ids)
	if err != nil {
		slog.ErrorContext(r.Context(), "checkr webhook: persist failed",
			"type", event.Type, "status", status, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to persist background check update")
		return
	}

	slog.InfoContext(r.Context(), "checkr webhook: processed",
		"type", event.Type,
		"status", status,
		"rows", n,
	)
	writeJSON(w, http.StatusOK, map[string]bool{"received": true})
}

type checkrWebhookEnvelope struct {
	Type string `json:"type"`
	Data struct {
		Object struct {
			ID            string `json:"id"`
			Object        string `json:"object"`
			Status        string `json:"status"`
			Result        string `json:"result"`
			CandidateID   string `json:"candidate_id"`
			ReportID      string `json:"report_id"`
			InvitationURL string `json:"invitation_url"`
			DocumentURL   string `json:"document_url"`
		} `json:"object"`
	} `json:"data"`
}

func parseCheckrWebhook(body []byte) (checkrWebhookEnvelope, []string, string, bool) {
	var event checkrWebhookEnvelope
	if err := json.Unmarshal(body, &event); err != nil {
		return checkrWebhookEnvelope{}, nil, "", false
	}
	obj := event.Data.Object
	seen := map[string]struct{}{}
	var ids []string
	for _, id := range []string{obj.ID, obj.CandidateID, obj.ReportID} {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return event, nil, "", false
	}
	reportURL := strings.TrimSpace(obj.InvitationURL)
	if reportURL == "" {
		reportURL = strings.TrimSpace(obj.DocumentURL)
	}
	return event, ids, reportURL, true
}

// mapCheckrWebhookStatus maps a verified Checkr event to a row status.
// Never maps vendor-unknown or invented synonyms (pass/passed/fail) to clear.
func mapCheckrWebhookStatus(eventType, objectStatus, result string) (string, bool) {
	result = strings.ToLower(strings.TrimSpace(result))
	objectStatus = strings.ToLower(strings.TrimSpace(objectStatus))
	eventType = strings.ToLower(strings.TrimSpace(eventType))

	switch result {
	case "clear":
		return "clear", true
	case "consider":
		return "consider", true
	case "pass", "passed", "fail", "failed", "success":
		return "", false
	}

	switch objectStatus {
	case "pending", "clear", "consider", "suspended", "dispute", "complete":
		return objectStatus, true
	case "canceled", "cancelled":
		return "canceled", true
	}

	switch eventType {
	case "report.completed":
		// Completed without a vendor result is not a PASS.
		return "complete", true
	case "report.created", "invitation.created", "invitation.completed":
		return "pending", true
	}
	return "", false
}

func checkrWebhookSignatureValid(secret string, body []byte, header string) bool {
	header = strings.TrimSpace(header)
	if secret == "" || header == "" {
		return false
	}
	header = strings.TrimPrefix(header, "sha256=")

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	expected := mac.Sum(nil)

	if got, err := hex.DecodeString(header); err == nil {
		return hmac.Equal(expected, got)
	}
	return hmac.Equal([]byte(hex.EncodeToString(expected)), []byte(strings.ToLower(header)))
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

func (h *BackgroundCheckHandler) latest(ctx context.Context, userID string) (backgroundCheckJSON, error) {
	var (
		status    string
		checkrID  *string
		reportURL *string
		createdAt time.Time
		updatedAt time.Time
	)
	err := h.db.QueryRow(ctx, `
		SELECT status, checkr_id, report_url, created_at, updated_at
		FROM provider_background_checks
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, userID).Scan(&status, &checkrID, &reportURL, &createdAt, &updatedAt)
	if err != nil {
		return backgroundCheckJSON{}, err
	}
	ca := createdAt.UTC().Format(time.RFC3339)
	ua := updatedAt.UTC().Format(time.RFC3339)
	return backgroundCheckJSON{
		Status:    status,
		CheckrID:  checkrID,
		ReportURL: reportURL,
		CreatedAt: &ca,
		UpdatedAt: &ua,
	}, nil
}

func (h *BackgroundCheckHandler) insert(
	ctx context.Context,
	userID, status, checkrID, reportURL string,
) (backgroundCheckJSON, error) {
	var (
		outStatus string
		outCID    *string
		outURL    *string
		createdAt time.Time
		updatedAt time.Time
	)
	var cidArg any
	if checkrID != "" {
		cidArg = checkrID
	}
	var urlArg any
	if reportURL != "" {
		urlArg = reportURL
	}
	err := h.db.QueryRow(ctx, `
		INSERT INTO provider_background_checks (user_id, status, checkr_id, report_url)
		VALUES ($1, $2, $3, $4)
		RETURNING status, checkr_id, report_url, created_at, updated_at
	`, userID, status, cidArg, urlArg).Scan(&outStatus, &outCID, &outURL, &createdAt, &updatedAt)
	if err != nil {
		return backgroundCheckJSON{}, err
	}
	ca := createdAt.UTC().Format(time.RFC3339)
	ua := updatedAt.UTC().Format(time.RFC3339)
	return backgroundCheckJSON{
		Status:    outStatus,
		CheckrID:  outCID,
		ReportURL: outURL,
		CreatedAt: &ca,
		UpdatedAt: &ua,
	}, nil
}

func (h *BackgroundCheckHandler) updateStatusByCheckrIDs(
	ctx context.Context,
	status, reportURL string,
	ids []string,
) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tag, err := h.db.Exec(ctx, `
		UPDATE provider_background_checks
		SET status = $1,
		    report_url = COALESCE(NULLIF($2, ''), report_url)
		WHERE checkr_id = ANY($3)
	`, status, reportURL, ids)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (h *BackgroundCheckHandler) loadUserIdentity(ctx context.Context, userID string) (email, first, last string, err error) {
	var displayName string
	err = h.db.QueryRow(ctx, `
		SELECT email, display_name
		FROM users
		WHERE id = $1 AND deleted_at IS NULL
	`, userID).Scan(&email, &displayName)
	if err != nil {
		return "", "", "", err
	}
	email = strings.TrimSpace(email)
	first, last = splitDisplayName(displayName)
	return email, first, last, nil
}

func splitDisplayName(display string) (first, last string) {
	display = strings.TrimSpace(display)
	if display == "" {
		return "Provider", "User"
	}
	parts := strings.Fields(display)
	if len(parts) == 1 {
		return parts[0], "User"
	}
	return parts[0], strings.Join(parts[1:], " ")
}

func errorsIsNoRows(err error) bool {
	return err != nil && (err == pgx.ErrNoRows || strings.Contains(err.Error(), "no rows"))
}

// hydrateBackgroundCheckJSON copies a persisted invitation/report http(s) URL
// onto invitation_url so GET/POST clients can open the Checkr invite.
func hydrateBackgroundCheckJSON(row backgroundCheckJSON) backgroundCheckJSON {
	if row.InvitationURL != nil && strings.TrimSpace(*row.InvitationURL) != "" {
		return row
	}
	if row.ReportURL == nil {
		return row
	}
	u := strings.TrimSpace(*row.ReportURL)
	if !isHTTPURL(u) {
		return row
	}
	row.InvitationURL = &u
	return row
}

func isHTTPURL(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	return strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://")
}

// ─── Checkr HTTP client (real endpoints; scaffold) ───────────────────────────

func checkrBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("CHECKR_API_BASE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return checkrDefaultBaseURL
}

func checkrWorkState() string {
	if v := strings.TrimSpace(os.Getenv("CHECKR_WORK_STATE")); v != "" {
		return strings.ToUpper(v)
	}
	return checkrDefaultWorkState
}

func checkrDo(
	ctx context.Context,
	client *http.Client,
	method, endpoint, apiKey string,
	form url.Values,
) (status int, body []byte, err error) {
	var bodyReader io.Reader
	if form != nil {
		bodyReader = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bodyReader)
	if err != nil {
		return 0, nil, fmt.Errorf("build request: %w", err)
	}
	req.SetBasicAuth(apiKey, "")
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("checkr request: %w", err)
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return resp.StatusCode, nil, fmt.Errorf("read body: %w", readErr)
	}
	return resp.StatusCode, raw, nil
}

func checkrCreateCandidate(
	ctx context.Context,
	client *http.Client,
	baseURL, apiKey, email, first, last string,
) (string, error) {
	form := url.Values{}
	form.Set("email", email)
	form.Set("first_name", first)
	form.Set("last_name", last)
	// Invitation-hosted flow only strictly needs email; names improve dashboard UX.

	status, raw, err := checkrDo(ctx, client, http.MethodPost, baseURL+"/candidates", apiKey, form)
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", fmt.Errorf("checkr candidates HTTP %d: %s", status, truncateForLog(raw, 200))
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("decode candidate: %w", err)
	}
	if out.ID == "" {
		return "", fmt.Errorf("checkr candidate response missing id")
	}
	return out.ID, nil
}

func checkrCreateInvitation(
	ctx context.Context,
	client *http.Client,
	baseURL, apiKey, candidateID, packageSlug, workState string,
) (invitationURL, invitationID string, err error) {
	form := url.Values{}
	form.Set("candidate_id", candidateID)
	form.Set("package", packageSlug)
	form.Set("work_locations[][country]", "US")
	form.Set("work_locations[][state]", workState)

	status, raw, err := checkrDo(ctx, client, http.MethodPost, baseURL+"/invitations", apiKey, form)
	if err != nil {
		return "", "", err
	}
	if status < 200 || status >= 300 {
		// Fall back to direct report create (self-hosted packages sometimes prefer this).
		reportID, reportErr := checkrCreateReport(ctx, client, baseURL, apiKey, candidateID, packageSlug)
		if reportErr != nil {
			return "", "", fmt.Errorf("invitation HTTP %d (%s); report fallback: %w",
				status, truncateForLog(raw, 120), reportErr)
		}
		return "", reportID, nil
	}
	var out struct {
		ID            string  `json:"id"`
		InvitationURL string  `json:"invitation_url"`
		ReportID      *string `json:"report_id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", "", fmt.Errorf("decode invitation: %w", err)
	}
	id := out.ID
	if id == "" && out.ReportID != nil {
		id = *out.ReportID
	}
	return out.InvitationURL, id, nil
}

func checkrCreateReport(
	ctx context.Context,
	client *http.Client,
	baseURL, apiKey, candidateID, packageSlug string,
) (string, error) {
	form := url.Values{}
	form.Set("candidate_id", candidateID)
	form.Set("package", packageSlug)

	status, raw, err := checkrDo(ctx, client, http.MethodPost, baseURL+"/reports", apiKey, form)
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", fmt.Errorf("checkr reports HTTP %d: %s", status, truncateForLog(raw, 200))
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("decode report: %w", err)
	}
	if out.ID == "" {
		return "", fmt.Errorf("checkr report response missing id")
	}
	return out.ID, nil
}

func truncateForLog(b []byte, n int) string {
	s := string(bytes.TrimSpace(b))
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
