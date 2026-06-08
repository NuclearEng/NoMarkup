package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ProviderLicenseHandler serves the provider professional-license capture +
// verification endpoints backing the gated LEGAL services vertical
// (CLAUDE.md §15: gated verticals; §6: every data boundary authenticated +
// authorized; §5: parameterized SQL only). It is a gateway-level concern stored
// directly in PostgreSQL (the provider_licenses table from migration 062), not
// routed through a downstream gRPC service — mirroring FeatureFlagHandler.
type ProviderLicenseHandler struct {
	db *pgxpool.Pool
}

// NewProviderLicenseHandler creates a new ProviderLicenseHandler.
// If db is nil (e.g. DATABASE_URL not set) the endpoints fail closed with 503
// for writes and return empty lists for reads, never panicking.
func NewProviderLicenseHandler(db *pgxpool.Pool) *ProviderLicenseHandler {
	return &ProviderLicenseHandler{db: db}
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

	var (
		id                   string
		createdAt, updatedAt time.Time
	)
	err := h.db.QueryRow(r.Context(),
		`INSERT INTO provider_licenses (provider_id, license_type, license_number, jurisdiction, status)
		 VALUES ($1, $2, $3, $4, 'pending')
		 RETURNING id, created_at, updated_at`,
		claims.UserID, req.LicenseType, req.LicenseNumber, req.Jurisdiction,
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

	licenses, err := scanLicenseRows(rows, false)
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

	licenses, err := scanLicenseRows(rows, true)
	if err != nil {
		slog.Error("failed to scan verified licenses", "error", err, "provider_id", providerID)
		writeError(w, http.StatusInternalServerError, "failed to list licenses")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"licenses": licenses})
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

	var (
		rows pgx.Rows
		err  error
	)
	if status == "all" {
		rows, err = h.db.Query(r.Context(),
			`SELECT id, provider_id, license_type, license_number, jurisdiction, status,
			        verified_by, verified_at, created_at, updated_at
			   FROM provider_licenses
			  ORDER BY created_at ASC`)
	} else {
		if status != licenseStatusPending && status != licenseStatusVerified && status != licenseStatusRejected {
			writeError(w, http.StatusBadRequest, "status must be one of: pending, verified, rejected, all")
			return
		}
		rows, err = h.db.Query(r.Context(),
			`SELECT id, provider_id, license_type, license_number, jurisdiction, status,
			        verified_by, verified_at, created_at, updated_at
			   FROM provider_licenses
			  WHERE status = $1
			  ORDER BY created_at ASC`, status)
	}
	if err != nil {
		slog.Error("failed to list licenses for admin", "error", err, "status", status)
		writeError(w, http.StatusInternalServerError, "failed to list licenses")
		return
	}
	defer rows.Close()

	licenses, err := scanLicenseRows(rows, false)
	if err != nil {
		slog.Error("failed to scan admin licenses", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list licenses")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"licenses": licenses})
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

	slog.Info("provider license reviewed",
		"license_id", id, "provider_id", providerID, "status", newStatus, "reviewer", claims.UserID)
	writeJSON(w, http.StatusOK, licenseJSON(
		id, providerID, licenseType, licenseNumber, jurisdiction, newStatus,
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

// scanLicenseRows materializes rows into JSON projections. When mask is true,
// license_number is reduced to a last-4 projection (public read path).
func scanLicenseRows(rows pgx.Rows, mask bool) ([]map[string]interface{}, error) {
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
		number := licenseNumber
		if mask {
			number = maskLicenseNumber(licenseNumber)
		}
		licenses = append(licenses, licenseJSON(
			id, providerID, licenseType, number, jurisdiction, status,
			verifiedBy, verifiedAt, createdAt, updatedAt))
	}
	return licenses, rows.Err()
}
