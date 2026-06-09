package handler

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// PropertyHandler handles HTTP endpoints for customer properties.
type PropertyHandler struct {
	userClient userv1.UserServiceClient
}

// NewPropertyHandler creates a new PropertyHandler.
func NewPropertyHandler(userClient userv1.UserServiceClient) *PropertyHandler {
	return &PropertyHandler{userClient: userClient}
}

type createPropertyRequest struct {
	Nickname  string         `json:"nickname"`
	Address   addressRequest `json:"address"`
	Notes     string         `json:"notes"`
	IsPrimary bool           `json:"is_primary"`
}

type addressRequest struct {
	Street   string   `json:"street"`
	City     string   `json:"city"`
	State    string   `json:"state"`
	ZipCode  string   `json:"zip_code"`
	Latitude  *float64 `json:"latitude,omitempty"`
	Longitude *float64 `json:"longitude,omitempty"`
}

type updatePropertyRequest struct {
	Nickname  *string `json:"nickname,omitempty"`
	Notes     *string `json:"notes,omitempty"`
	IsPrimary *bool   `json:"is_primary,omitempty"`
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

	addr := &commonv1.Address{
		Street:  req.Address.Street,
		City:    req.Address.City,
		State:   req.Address.State,
		ZipCode: req.Address.ZipCode,
	}
	if req.Address.Latitude != nil && req.Address.Longitude != nil {
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

	result := map[string]interface{}{
		"id":         p.GetId(),
		"user_id":    p.GetUserId(),
		"nickname":   p.GetNickname(),
		"notes":      p.GetNotes(),
		"is_primary": p.GetIsPrimary(),
		"created_at": formatTimestamp(p.GetCreatedAt()),
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
