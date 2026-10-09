package handler

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// PreferredProviderMinCompletions is the PRD FR-19.2 threshold for the
// "preferred" badge (3+ completed jobs with the same provider).
const PreferredProviderMinCompletions = 3

// PropertyHandler handles HTTP endpoints for customer properties.
type PropertyHandler struct {
	userClient userv1.UserServiceClient
	// db backs FR-19.2 preferred-providers aggregation (contracts ⋈ jobs).
	// May be nil in unit tests that never hit that route.
	db *pgxpool.Pool
}

// NewPropertyHandler creates a new PropertyHandler.
// db may be nil; ListPreferredProviders* then return 503.
func NewPropertyHandler(userClient userv1.UserServiceClient, db *pgxpool.Pool) *PropertyHandler {
	return &PropertyHandler{userClient: userClient, db: db}
}

type createPropertyRequest struct {
	Nickname  string         `json:"nickname"`
	Address   addressRequest `json:"address"`
	Notes     string         `json:"notes"`
	IsPrimary bool           `json:"is_primary"`
	// PhotoURLs: 0–5 public CDN URLs from the imaging pipeline (10MB each).
	PhotoURLs []string `json:"photo_urls,omitempty"`
}

type addressRequest struct {
	Street    string   `json:"street"`
	City      string   `json:"city"`
	State     string   `json:"state"`
	ZipCode   string   `json:"zip_code"`
	Latitude  *float64 `json:"latitude,omitempty"`
	Longitude *float64 `json:"longitude,omitempty"`
}

type updatePropertyRequest struct {
	Nickname  *string `json:"nickname,omitempty"`
	Notes     *string `json:"notes,omitempty"`
	IsPrimary *bool   `json:"is_primary,omitempty"`
	// PhotoURLs when non-nil replaces the full list (empty array clears). Max 5.
	PhotoURLs *[]string `json:"photo_urls,omitempty"`
}

// List handles GET /api/v1/properties.
func (h *PropertyHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.userClient.ListProperties(r.Context(), &userv1.ListPropertiesRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	properties := make([]map[string]interface{}, 0, len(resp.GetProperties()))
	for _, p := range resp.GetProperties() {
		properties = append(properties, protoPropertyToJSON(p))
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"properties": properties,
	})
}

// Create handles POST /api/v1/properties.
func (h *PropertyHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req createPropertyRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if strings.TrimSpace(req.Nickname) == "" {
		writeError(w, http.StatusBadRequest, "nickname is required")
		return
	}
	if strings.TrimSpace(req.Address.Street) == "" {
		writeError(w, http.StatusBadRequest, "address.street is required")
		return
	}
	if strings.TrimSpace(req.Address.City) == "" {
		writeError(w, http.StatusBadRequest, "address.city is required")
		return
	}
	if strings.TrimSpace(req.Address.State) == "" {
		writeError(w, http.StatusBadRequest, "address.state is required")
		return
	}
	if strings.TrimSpace(req.Address.ZipCode) == "" {
		writeError(w, http.StatusBadRequest, "address.zip_code is required")
		return
	}

	photoURLs, ok := normalizeGatewayPropertyPhotos(w, req.PhotoURLs)
	if !ok {
		return
	}

	addr := &commonv1.Address{
		Street:  req.Address.Street,
		City:    req.Address.City,
		State:   req.Address.State,
		ZipCode: req.Address.ZipCode,
	}
	if req.Address.Latitude != nil && req.Address.Longitude != nil {
		// Bound coordinates before they flow into ST_MakePoint — out-of-range
		// values silently corrupt every PostGIS proximity query (25mi pickup
		// radius, provider distance) that later reads this column.
		if *req.Address.Latitude < -90 || *req.Address.Latitude > 90 ||
			*req.Address.Longitude < -180 || *req.Address.Longitude > 180 {
			writeError(w, http.StatusBadRequest, "latitude must be within [-90,90] and longitude within [-180,180]")
			return
		}
		addr.Location = &commonv1.Location{
			Latitude:  *req.Address.Latitude,
			Longitude: *req.Address.Longitude,
		}
	}

	resp, err := h.userClient.CreateProperty(r.Context(), &userv1.CreatePropertyRequest{
		UserId:    claims.UserID,
		Nickname:  req.Nickname,
		Address:   addr,
		Notes:     req.Notes,
		IsPrimary: req.IsPrimary,
		PhotoUrls: photoURLs,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	slog.Info("property created",
		"user_id", claims.UserID,
		"property_id", resp.GetProperty().GetId(),
	)

	writeJSON(w, http.StatusCreated, protoPropertyToJSON(resp.GetProperty()))
}

// Update handles PUT /api/v1/properties/{id}.
func (h *PropertyHandler) Update(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	propertyID := chi.URLParam(r, "id")
	if propertyID == "" {
		writeError(w, http.StatusBadRequest, "property id required")
		return
	}

	// Ownership check: the UpdateProperty/DeleteProperty gRPC contracts scope
	// only by property_id (no user_id), so without this gate any authenticated
	// user could mutate another user's property by id (IDOR). ListProperties is
	// already scoped to the caller, so membership there proves ownership.
	if !h.ownsProperty(w, r, claims.UserID, propertyID) {
		return
	}

	var req updatePropertyRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	grpcReq := &userv1.UpdatePropertyRequest{
		PropertyId: propertyID,
		Nickname:   req.Nickname,
		Notes:      req.Notes,
		IsPrimary:  req.IsPrimary,
	}
	if req.PhotoURLs != nil {
		urls, ok := normalizeGatewayPropertyPhotos(w, *req.PhotoURLs)
		if !ok {
			return
		}
		update := true
		grpcReq.UpdatePhotoUrls = &update
		grpcReq.PhotoUrls = urls
	}

	resp, err := h.userClient.UpdateProperty(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoPropertyToJSON(resp.GetProperty()))
}

// Delete handles DELETE /api/v1/properties/{id}.
func (h *PropertyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	propertyID := chi.URLParam(r, "id")
	if propertyID == "" {
		writeError(w, http.StatusBadRequest, "property id required")
		return
	}

	// Ownership check — see Update. Prevents cross-user delete (IDOR).
	if !h.ownsProperty(w, r, claims.UserID, propertyID) {
		return
	}

	_, err := h.userClient.DeleteProperty(r.Context(), &userv1.DeletePropertyRequest{
		PropertyId: propertyID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ListPreferredProviders handles GET /api/v1/me/preferred-providers.
//
// FR-19.2 — aggregates completed contracts joined to jobs for the authenticated
// customer. Optional query `property_id` scopes to one owned property.
//
// Response: { "providers": [ { provider_id, display_name, completed_count,
// last_completed_at, is_preferred } ], "preferred_threshold": 3 }
func (h *PropertyHandler) ListPreferredProviders(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var propertyID string
	if prop := strings.TrimSpace(r.URL.Query().Get("property_id")); prop != "" {
		if !isValidUUID(prop) {
			writeError(w, http.StatusBadRequest, "property_id must be a valid UUID")
			return
		}
		if !h.ownsProperty(w, r, claims.UserID, prop) {
			return
		}
		propertyID = prop
	}

	h.writePreferredProviders(w, r, claims.UserID, propertyID)
}

// ListPreferredProvidersForProperty handles
// GET /api/v1/properties/{id}/preferred-providers (FR-19.2 property scope).
func (h *PropertyHandler) ListPreferredProvidersForProperty(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	propertyID := strings.TrimSpace(chi.URLParam(r, "id"))
	if propertyID == "" || !isValidUUID(propertyID) {
		writeError(w, http.StatusBadRequest, "property id required")
		return
	}
	if !h.ownsProperty(w, r, claims.UserID, propertyID) {
		return
	}

	h.writePreferredProviders(w, r, claims.UserID, propertyID)
}

// writePreferredProviders runs the aggregation query and writes JSON.
// propertyID empty = account-wide; non-empty = jobs.property_id filter.
func (h *PropertyHandler) writePreferredProviders(w http.ResponseWriter, r *http.Request, customerID, propertyID string) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "preferred providers unavailable")
		return
	}

	// Aggregate completed contracts ⋈ jobs. Prefer completed_at; fall back to
	// updated_at when completed_at is null (legacy rows). Display name is
	// public-safe only (users.display_name) — never email/phone.
	const baseSQL = `
		SELECT c.provider_id::text,
		       COALESCE(NULLIF(TRIM(u.display_name), ''), '') AS display_name,
		       COUNT(*)::int AS completed_count,
		       MAX(COALESCE(c.completed_at, c.updated_at)) AS last_completed_at
		  FROM contracts c
		  JOIN jobs j ON j.id = c.job_id
		  LEFT JOIN users u ON u.id = c.provider_id AND u.deleted_at IS NULL
		 WHERE c.customer_id = $1
		   AND c.status = 'completed'
		   AND j.deleted_at IS NULL`

	var (
		query string
		args  []interface{}
	)
	if propertyID != "" {
		query = baseSQL + `
		   AND j.property_id = $2
		 GROUP BY c.provider_id, u.display_name
		 ORDER BY completed_count DESC, last_completed_at DESC NULLS LAST
		 LIMIT 50`
		args = []interface{}{customerID, propertyID}
	} else {
		query = baseSQL + `
		 GROUP BY c.provider_id, u.display_name
		 ORDER BY completed_count DESC, last_completed_at DESC NULLS LAST
		 LIMIT 50`
		args = []interface{}{customerID}
	}

	rows, err := h.db.Query(r.Context(), query, args...)
	if err != nil {
		slog.ErrorContext(r.Context(), "preferred providers query failed",
			"error", err,
			"customer_id", customerID,
			"property_id", propertyID,
		)
		writeError(w, http.StatusInternalServerError, "failed to load preferred providers")
		return
	}
	defer rows.Close()

	providers := make([]map[string]interface{}, 0, 16)
	for rows.Next() {
		var (
			providerID      string
			displayName     string
			completedCount  int
			lastCompletedAt *time.Time
		)
		if err := rows.Scan(&providerID, &displayName, &completedCount, &lastCompletedAt); err != nil {
			slog.ErrorContext(r.Context(), "preferred providers scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to load preferred providers")
			return
		}
		if displayName == "" {
			// Stable fallback when display_name is empty (mirrors iOS roll-up).
			if len(providerID) >= 8 {
				displayName = "Provider " + providerID[:8]
			} else {
				displayName = "Provider"
			}
		}
		row := map[string]interface{}{
			"provider_id":     providerID,
			"display_name":    displayName,
			"completed_count": completedCount,
			"is_preferred":    completedCount >= PreferredProviderMinCompletions,
		}
		if lastCompletedAt != nil {
			row["last_completed_at"] = lastCompletedAt.UTC().Format(time.RFC3339)
		} else {
			row["last_completed_at"] = nil
		}
		providers = append(providers, row)
	}
	if err := rows.Err(); err != nil {
		slog.ErrorContext(r.Context(), "preferred providers rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load preferred providers")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"providers":           providers,
		"preferred_threshold": PreferredProviderMinCompletions,
	})
}

// ownsProperty verifies that propertyID belongs to userID by listing the
// caller's own properties (the ListProperties RPC is scoped by user_id) and
// checking membership. It writes the appropriate error response and returns
// false when the caller does not own the property (404, not 403, so existence
// of another user's property id is not leaked). On a downstream gRPC failure
// it writes the mapped error and returns false.
func (h *PropertyHandler) ownsProperty(w http.ResponseWriter, r *http.Request, userID, propertyID string) bool {
	resp, err := h.userClient.ListProperties(r.Context(), &userv1.ListPropertiesRequest{
		UserId: userID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return false
	}
	for _, p := range resp.GetProperties() {
		if p.GetId() == propertyID {
			return true
		}
	}
	writeError(w, http.StatusNotFound, "property not found")
	return false
}

// protoPropertyToJSON converts a proto Property to a JSON-friendly map.
func protoPropertyToJSON(p *userv1.Property) map[string]interface{} {
	if p == nil {
		return map[string]interface{}{}
	}

	photoURLs := p.GetPhotoUrls()
	if photoURLs == nil {
		photoURLs = []string{}
	}
	result := map[string]interface{}{
		"id":         p.GetId(),
		"user_id":    p.GetUserId(),
		"nickname":   p.GetNickname(),
		"notes":      p.GetNotes(),
		"is_primary": p.GetIsPrimary(),
		"created_at": formatTimestamp(p.GetCreatedAt()),
		"photo_urls": photoURLs,
	}

	if addr := p.GetAddress(); addr != nil {
		addrJSON := map[string]interface{}{
			"street":   addr.GetStreet(),
			"city":     addr.GetCity(),
			"state":    addr.GetState(),
			"zip_code": addr.GetZipCode(),
		}
		if loc := addr.GetLocation(); loc != nil {
			addrJSON["latitude"] = loc.GetLatitude()
			addrJSON["longitude"] = loc.GetLongitude()
		}
		result["address"] = addrJSON
	}

	return result
}

// maxPropertyPhotos matches user service MaxPropertyPhotos / DB CHECK.
const maxPropertyPhotos = 5

// normalizeGatewayPropertyPhotos trims, dedupes, enforces max 5, and requires
// http(s) CDN URLs. Writes 400 and returns ok=false on violation.
func normalizeGatewayPropertyPhotos(w http.ResponseWriter, in []string) ([]string, bool) {
	if len(in) == 0 {
		return []string{}, true
	}
	out := make([]string, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, u := range in {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		if !strings.HasPrefix(u, "https://") && !strings.HasPrefix(u, "http://") {
			writeError(w, http.StatusBadRequest, "photo_urls must be http(s) URLs")
			return nil, false
		}
		if _, ok := seen[u]; ok {
			continue
		}
		seen[u] = struct{}{}
		out = append(out, u)
		if len(out) > maxPropertyPhotos {
			writeError(w, http.StatusBadRequest, "at most 5 property photos")
			return nil, false
		}
	}
	return out, true
}
