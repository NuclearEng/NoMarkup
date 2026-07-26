package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ProviderLicenseHandler serves the provider professional-license capture +
// verification endpoints backing the gated LEGAL services vertical
// (CLAUDE.md §15: gated verticals; §6: every data boundary authenticated +
// authorized; §5: parameterized SQL only). It is a gateway-level concern stored
// directly in PostgreSQL (the provider_licenses table from migration 062), not
// routed through a downstream gRPC service — mirroring FeatureFlagHandler.
//
// license_number is PII at rest as of migration 106: it is sealed with
// nacl/secretbox on write and opened on read. Migration 062 stored it in clear
// while its own inline comment called it "sensitive", and the identically-named
// provider_employees.license_number has been encrypted since migration 033.
type ProviderLicenseHandler struct {
	db     *pgxpool.Pool
	cipher *crypto.Cipher
}

// NewProviderLicenseHandler creates a new ProviderLicenseHandler.
// If db is nil (e.g. DATABASE_URL not set) the endpoints fail closed with 503
// for writes and return empty lists for reads, never panicking.
//
// cipher is variadic so the existing single-argument composition root keeps
// compiling; callers SHOULD pass the gateway's shared piiCipher (the same one
// handed to NewEmployeesHandler) so licences are sealed and opened under
// exactly the process-wide key. The fallback reads the same
// ENCRYPTION_KEY / ENCRYPTION_KEY_PREVIOUS pair and therefore yields an
// identical cipher everywhere but development, where FromEnv mints an
// ephemeral key — that divergence is dev-only and WARN-logged. Mirrors
// NewDataExportHandler.
func NewProviderLicenseHandler(db *pgxpool.Pool, cipher ...*crypto.Cipher) *ProviderLicenseHandler {
	h := &ProviderLicenseHandler{db: db}
	if len(cipher) > 0 && cipher[0] != nil {
		h.cipher = cipher[0]
		return h
	}
	c, err := crypto.FromEnv()
	if err != nil {
		// Outside development FromEnv fails closed on a missing key. Leaving the
		// cipher nil makes every licence write a 503 and every licence read a
		// 500 rather than persisting or emitting a plaintext licence number.
		slog.Error("provider licenses: no PII cipher; licence endpoints will fail closed", "error", err)
		return h
	}
	slog.Warn("provider licenses: constructed its own cipher from env; pass the shared piiCipher to NewProviderLicenseHandler for guaranteed key parity")
	h.cipher = c
	return h
}

const (
	licenseStatusPending  = "pending"
	licenseStatusVerified = "verified"
	licenseStatusRejected = "rejected"
)

// allowedLicenseTypes restricts the self-asserted license_type to a known set.
// `bar` is the only type the legal vertical needs today; the set is small and
// explicit so a typo or junk value is a 400, not a silently-stored row.
var allowedLicenseTypes = map[string]bool{
	"bar": true,
}

// licenseJSON is the provider-facing / admin-facing projection. It includes the
// full license_number (the owner and admins may see it).
func licenseJSON(id, providerID, licenseType, licenseNumber, jurisdiction, status string,
	verifiedBy *string, verifiedAt *time.Time, createdAt, updatedAt time.Time) map[string]interface{} {
	return map[string]interface{}{
		"id":             id,
		"provider_id":    providerID,
		"license_type":   licenseType,
		"license_number": licenseNumber,
		"jurisdiction":   jurisdiction,
		"status":         status,
		"verified_by":    verifiedBy,
		"verified_at":    verifiedAt,
		"created_at":     createdAt,
		"updated_at":     updatedAt,
	}
}

// maskLicenseNumber reduces a license number to a last-4 projection for the
// PUBLIC read path so the full number is never leaked to anonymous callers.
//
// MUST be applied to the PLAINTEXT, after decryption. Masking the stored
// ciphertext would publish the last four base64 characters of a random nonce —
// which mask nothing about the licence and are not even stable across a
// re-encrypt — while the caller believes they are seeing a real last-4.
func maskLicenseNumber(n string) string {
	n = strings.TrimSpace(n)
	if len(n) <= 4 {
		return n
	}
	return "••••" + n[len(n)-4:]
}

// SubmitLicense handles POST /api/v1/providers/me/licenses (provider, authed).
// A provider self-asserts a license; it lands in `pending` for admin review.
func (h *ProviderLicenseHandler) SubmitLicense(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}

	var req struct {
		LicenseType   string `json:"license_type"`
		LicenseNumber string `json:"license_number"`
		Jurisdiction  string `json:"jurisdiction"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	req.LicenseType = strings.ToLower(strings.TrimSpace(req.LicenseType))
	req.LicenseNumber = strings.TrimSpace(req.LicenseNumber)
	req.Jurisdiction = strings.ToUpper(strings.TrimSpace(req.Jurisdiction))

	if req.LicenseType == "" || !allowedLicenseTypes[req.LicenseType] {
		writeError(w, http.StatusBadRequest, "license_type must be one of: bar")
		return
	}
	if req.LicenseNumber == "" || len(req.LicenseNumber) > 100 {
		writeError(w, http.StatusBadRequest, "license_number is required (max 100 chars)")
		return
	}
	// Jurisdiction is a US state for a bar license: 2-letter code.
	if len(req.Jurisdiction) != 2 {
		writeError(w, http.StatusBadRequest, "jurisdiction must be a 2-letter state code")
		return
	}

	// PII at rest (migration 106): the licence number is sealed before it ever
	// reaches Postgres. Fail closed when no key is configured rather than
	// silently persisting a plaintext licence number.
	if h.cipher == nil {
		slog.Error("provider license submit blocked: no PII cipher configured", "provider_id", claims.UserID)
		writeError(w, http.StatusServiceUnavailable, "license submission is temporarily unavailable")
		return
	}
	encLicenseNumber, err := h.cipher.EncryptString(req.LicenseNumber)
	if err != nil {
		slog.Error("failed to encrypt provider license number", "error", err, "provider_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to submit license")
		return
	}

	var (
		id                   string
		createdAt, updatedAt time.Time
	)
	err = h.db.QueryRow(r.Context(),
		`INSERT INTO provider_licenses (provider_id, license_type, license_number, jurisdiction, status)
		 VALUES ($1, $2, $3, $4, 'pending')
		 RETURNING id, created_at, updated_at`,
		claims.UserID, req.LicenseType, encLicenseNumber, req.Jurisdiction,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		slog.Error("failed to insert provider license", "error", err, "provider_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to submit license")
		return
	}

	slog.Info("provider license submitted",
		"provider_id", claims.UserID, "license_id", id, "type", req.LicenseType, "jurisdiction", req.Jurisdiction)
	writeJSON(w, http.StatusCreated, licenseJSON(
		id, claims.UserID, req.LicenseType, req.LicenseNumber, req.Jurisdiction,
		licenseStatusPending, nil, nil, createdAt, updatedAt))
}

// ListMyLicenses handles GET /api/v1/providers/me/licenses (provider, authed).
// Returns ALL of the caller's licenses (any status), with full numbers — the
// owner may see their own pending/rejected rows.
func (h *ProviderLicenseHandler) ListMyLicenses(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"licenses": []interface{}{}})
		return
	}

	rows, err := h.db.Query(r.Context(),
		`SELECT id, provider_id, license_type, license_number, jurisdiction, status,
		        verified_by, verified_at, created_at, updated_at
		   FROM provider_licenses
		  WHERE provider_id = $1
		  ORDER BY created_at DESC`, claims.UserID)
	if err != nil {
		slog.Error("failed to list provider licenses", "error", err, "provider_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to list licenses")
		return
	}
	defer rows.Close()

	licenses, err := scanLicenseRows(r.Context(), h.cipher, rows, false)
	if err != nil {
		slog.Error("failed to scan provider licenses", "error", err, "provider_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to list licenses")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"licenses": licenses})
}

// ListProviderVerifiedLicenses handles GET /api/v1/providers/{id}/licenses (public-ish).
// Returns ONLY the provider's VERIFIED licenses, with the number MASKED to
// last-4 — this powers the "verified lawyer" badge without leaking pending or
// rejected rows or the full license number.
func (h *ProviderLicenseHandler) ListProviderVerifiedLicenses(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	if providerID == "" {
		writeError(w, http.StatusBadRequest, "provider id is required")
		return
	}
	if !isValidUUID(providerID) {
		writeError(w, http.StatusBadRequest, "invalid provider id")
		return
	}
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"licenses": []interface{}{}})
		return
	}

	rows, err := h.db.Query(r.Context(),
		`SELECT id, provider_id, license_type, license_number, jurisdiction, status,
		        verified_by, verified_at, created_at, updated_at
		   FROM provider_licenses
		  WHERE provider_id = $1 AND status = 'verified'
		  ORDER BY created_at DESC`, providerID)
	if err != nil {
		slog.Error("failed to list verified licenses", "error", err, "provider_id", providerID)
		writeError(w, http.StatusInternalServerError, "failed to list licenses")
		return
	}
	defer rows.Close()

	licenses, err := scanLicenseRows(r.Context(), h.cipher, rows, true)
	if err != nil {
		slog.Error("failed to scan verified licenses", "error", err, "provider_id", providerID)
		writeError(w, http.StatusInternalServerError, "failed to list licenses")
		return
	}
	// Public SEO read (anonymous-reachable provider profile data), no per-caller
	// variance — edge-cacheable per §14. Verified licenses change rarely.
	writeCachedJSON(w, r, http.StatusOK, map[string]interface{}{"licenses": licenses}, 300, 600)
}

// ListPendingLicenses handles GET /api/v1/admin/licenses?status=pending (admin).
// The review queue. `status` defaults to `pending`; pass any valid status to
// filter, or `all` for every row.
func (h *ProviderLicenseHandler) ListPendingLicenses(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"licenses": []interface{}{}})
		return
	}

	status := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
	if status == "" {
		status = licenseStatusPending
	}
	if status != "all" && status != licenseStatusPending && status != licenseStatusVerified && status != licenseStatusRejected {
		writeError(w, http.StatusBadRequest, "status must be one of: pending, verified, rejected, all")
		return
	}

	page, pageSize := parseDirectPagination(r.URL.Query(), 1, 50, 100)

	// Build the WHERE clause + arg list shared by the count and page queries so a
	// large (or `status=all`) review queue can't fan out an unbounded scan.
	where := "1=1"
	args := []interface{}{}
	if status != "all" {
		args = append(args, status)
		where += " AND status = $1"
	}

	var total int
	if err := h.db.QueryRow(r.Context(),
		"SELECT COUNT(*) FROM provider_licenses WHERE "+where, args...).Scan(&total); err != nil {
		slog.Error("failed to count licenses for admin", "error", err, "status", status)
		writeError(w, http.StatusInternalServerError, "failed to list licenses")
		return
	}

	args = append(args, pageSize, (page-1)*pageSize)
	limitArg := strconv.Itoa(len(args) - 1)
	offsetArg := strconv.Itoa(len(args))

	rows, err := h.db.Query(r.Context(),
		`SELECT id, provider_id, license_type, license_number, jurisdiction, status,
		        verified_by, verified_at, created_at, updated_at
		   FROM provider_licenses
		  WHERE `+where+`
		  ORDER BY created_at ASC
		  LIMIT $`+limitArg+` OFFSET $`+offsetArg, args...)
	if err != nil {
		slog.Error("failed to list licenses for admin", "error", err, "status", status)
		writeError(w, http.StatusInternalServerError, "failed to list licenses")
		return
	}
	defer rows.Close()

	licenses, err := scanLicenseRows(r.Context(), h.cipher, rows, false)
	if err != nil {
		slog.Error("failed to scan admin licenses", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list licenses")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"licenses": licenses,
		"pagination": map[string]interface{}{
			"page":      page,
			"page_size": pageSize,
			"total":     total,
		},
	})
}

// ReviewLicense handles PUT /api/v1/admin/licenses/{id} (admin).
// Verify or reject a submitted license. Setting status=verified stamps the
// reviewing admin + timestamp (DB CHECK enforces the audit trail); moving away
// from verified clears them.
func (h *ProviderLicenseHandler) ReviewLicense(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}

	licenseID := chi.URLParam(r, "id")
	if licenseID == "" {
		writeError(w, http.StatusBadRequest, "license id is required")
		return
	}
	if !isValidUUID(licenseID) {
		writeError(w, http.StatusBadRequest, "invalid license id")
		return
	}

	var req struct {
		Status string `json:"status"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Status = strings.ToLower(strings.TrimSpace(req.Status))
	if req.Status != licenseStatusVerified && req.Status != licenseStatusRejected && req.Status != licenseStatusPending {
		writeError(w, http.StatusBadRequest, "status must be one of: pending, verified, rejected")
		return
	}

	// verified_by / verified_at are stamped only when moving TO verified, and
	// cleared otherwise, so the audit trail always matches the status.
	var (
		id                   string
		providerID           string
		licenseType          string
		licenseNumber        string
		jurisdiction         string
		newStatus            string
		verifiedBy           *string
		verifiedAt           *time.Time
		createdAt, updatedAt time.Time
	)
	err := h.db.QueryRow(r.Context(),
		`UPDATE provider_licenses
		    SET status      = $2,
		        verified_by = CASE WHEN $2 = 'verified' THEN $3::uuid ELSE NULL END,
		        verified_at = CASE WHEN $2 = 'verified' THEN now()    ELSE NULL END,
		        updated_at  = now()
		  WHERE id = $1
		  RETURNING id, provider_id, license_type, license_number, jurisdiction, status,
		            verified_by, verified_at, created_at, updated_at`,
		licenseID, req.Status, claims.UserID,
	).Scan(&id, &providerID, &licenseType, &licenseNumber, &jurisdiction, &newStatus,
		&verifiedBy, &verifiedAt, &createdAt, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "license not found")
		return
	}
	if err != nil {
		slog.Error("failed to review license", "error", err, "license_id", licenseID)
		writeError(w, http.StatusInternalServerError, "failed to review license")
		return
	}

	// This RETURNING clause is the one licence read that does NOT go through
	// scanLicenseRows, so it needs its own decrypt. Admin projection → unmasked.
	plainLicenseNumber, err := openLicenseNumber(r.Context(), h.cipher, licenseNumber)
	if err != nil {
		slog.Error("failed to decrypt reviewed license number", "error", err, "license_id", licenseID)
		writeError(w, http.StatusInternalServerError, "failed to review license")
		return
	}

	slog.Info("provider license reviewed",
		"license_id", id, "provider_id", providerID, "status", newStatus, "reviewer", claims.UserID)
	writeJSON(w, http.StatusOK, licenseJSON(
		id, providerID, licenseType, plainLicenseNumber, jurisdiction, newStatus,
		verifiedBy, verifiedAt, createdAt, updatedAt))
}

// ListLegalCategories handles GET /api/v1/legal/categories (gated public).
// Returns the LEGAL subtree of the service-category taxonomy (the `legal`
// root + every descendant), so the legal vertical's browse surface can render
// its own category picker without pulling the full tree and filtering client
// side. This route is gated behind the `legal_services` flag in the router, so
// hitting it at all means the vertical is live. Public/no-PII → CDN-cacheable.
func (h *ProviderLicenseHandler) ListLegalCategories(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"categories": []interface{}{}})
		return
	}

	// Recursive walk of the taxonomy from the `legal` root downward. The
	// taxonomy is small + near-static (data-migration only), so a recursive CTE
	// is cheap and avoids N round-trips.
	rows, err := h.db.Query(r.Context(),
		`WITH RECURSIVE legal_tree AS (
		    SELECT id, parent_id, name, slug, level, sort_order
		      FROM service_categories
		     WHERE slug = 'legal'
		    UNION ALL
		    SELECT c.id, c.parent_id, c.name, c.slug, c.level, c.sort_order
		      FROM service_categories c
		      JOIN legal_tree t ON c.parent_id = t.id
		 )
		 SELECT id, parent_id, name, slug, level, sort_order
		   FROM legal_tree
		  ORDER BY level, sort_order`)
	if err != nil {
		slog.Error("failed to query legal categories", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get legal categories")
		return
	}
	defer rows.Close()

	cats := make([]map[string]interface{}, 0)
	for rows.Next() {
		var (
			id        string
			parentID  *string
			name      string
			slug      string
			level     int32
			sortOrder int32
		)
		if err := rows.Scan(&id, &parentID, &name, &slug, &level, &sortOrder); err != nil {
			slog.Error("failed to scan legal category", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to get legal categories")
			return
		}
		cats = append(cats, map[string]interface{}{
			"id":         id,
			"parent_id":  parentID,
			"name":       name,
			"slug":       slug,
			"level":      level,
			"sort_order": sortOrder,
		})
	}
	if err := rows.Err(); err != nil {
		slog.Error("error iterating legal categories", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get legal categories")
		return
	}

	// Public taxonomy subtree, identical for every caller → CDN-cacheable
	// (5m s-maxage + 1h stale-while-revalidate), same policy as /categories.
	writeCachedJSON(w, r, http.StatusOK, map[string]interface{}{"categories": cats}, 300, 3600)
}

// openLicenseNumber turns the stored license_number column into plaintext.
//
// Detection is per VALUE, by AUTHENTICATION — never by a per-row flag.
// provider_licenses deliberately has no pii_encrypted_v1 column and must not
// gain one: a flag is per ROW while encryption is per COLUMN, so a flag can
// read TRUE over a column the backfill never reached (migration 098).
// DecryptStringOrPassthrough gives the three outcomes this needs:
//
//	opens under a configured key → the plaintext
//	not our wire format at all   → legacy plaintext (migration 062 seeds, and
//	                               any row written before 106), passed through
//	our wire format, unopenable  → an error; the raw base64 is NEVER emitted
//
// The last case is a KEY problem, so it is escalated to the caller rather than
// degraded: license_number is NOT NULL and load-bearing in every projection,
// and returning a "licence" that is actually a nonce is worse than a 500.
func openLicenseNumber(ctx context.Context, cipher *crypto.Cipher, stored string) (string, error) {
	if cipher == nil {
		// No key at all: we cannot distinguish ciphertext from plaintext, and
		// emitting a possible ciphertext is exactly the bug being fixed.
		return "", fmt.Errorf("%w: no PII cipher configured for provider_licenses.license_number", crypto.ErrKeyMissing)
	}
	plain, err := cipher.DecryptStringOrPassthrough(stored)
	if err != nil {
		slog.ErrorContext(ctx, "provider license number is secretbox-shaped but no configured key opens it", "error", err)
		return "", fmt.Errorf("decrypt provider license number: %w", err)
	}
	return plain, nil
}

// scanLicenseRows materializes rows into JSON projections. When mask is true,
// license_number is reduced to a last-4 projection (public read path).
//
// Decryption happens BEFORE masking — see maskLicenseNumber.
func scanLicenseRows(ctx context.Context, cipher *crypto.Cipher, rows pgx.Rows, mask bool) ([]map[string]interface{}, error) {
	licenses := make([]map[string]interface{}, 0)
	for rows.Next() {
		var (
			id, providerID, licenseType, licenseNumber, jurisdiction, status string
			verifiedBy                                                       *string
			verifiedAt                                                       *time.Time
			createdAt, updatedAt                                             time.Time
		)
		if err := rows.Scan(&id, &providerID, &licenseType, &licenseNumber, &jurisdiction, &status,
			&verifiedBy, &verifiedAt, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		number, err := openLicenseNumber(ctx, cipher, licenseNumber)
		if err != nil {
			return nil, err
		}
		if mask {
			number = maskLicenseNumber(number)
		}
		licenses = append(licenses, licenseJSON(
			id, providerID, licenseType, number, jurisdiction, status,
			verifiedBy, verifiedAt, createdAt, updatedAt))
	}
	return licenses, rows.Err()
}
