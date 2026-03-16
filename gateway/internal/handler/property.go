package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	propertyID := chi.URLParam(r, "id")
	if propertyID == "" {
		writeError(w, http.StatusBadRequest, "property id required")
		return
	}

	var req updatePropertyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	propertyID := chi.URLParam(r, "id")
	if propertyID == "" {
		writeError(w, http.StatusBadRequest, "property id required")
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
