package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	fraudv1 "github.com/nomarkup/nomarkup/proto/fraud/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// FraudHandler handles HTTP endpoints for fraud detection administration.
type FraudHandler struct {
	fraudClient fraudv1.FraudServiceClient
}

// NewFraudHandler creates a new FraudHandler.
func NewFraudHandler(fraudClient fraudv1.FraudServiceClient) *FraudHandler {
	return &FraudHandler{fraudClient: fraudClient}
}

// ListAlerts handles GET /api/v1/admin/fraud/alerts.
// Query params: status, risk_level, page, page_size.
func (h *FraudHandler) ListAlerts(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &fraudv1.AdminListFraudAlertsRequest{}

	// Parse optional status filter.
	if s := q.Get("status"); s != "" {
		status := parseAlertStatus(s)
		if status != fraudv1.AlertStatus_ALERT_STATUS_UNSPECIFIED {
			grpcReq.StatusFilter = &status
		}
	}

	// Parse optional risk level filter.
	if rl := q.Get("risk_level"); rl != "" {
		risk := parseRiskLevel(rl)
		if risk != fraudv1.RiskLevel_RISK_LEVEL_UNSPECIFIED {
			grpcReq.RiskFilter = &risk
		}
	}

	// Parse pagination.
	page := int32(1)
	pageSize := int32(20)
	if p := q.Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = int32(v)
		}
	}
	if ps := q.Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil && v > 0 {
			pageSize = int32(v)
		}
	}
	grpcReq.Pagination = &commonv1.PaginationRequest{
		Page:     page,
		PageSize: pageSize,
	}

	resp, err := h.fraudClient.AdminListFraudAlerts(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	alerts := make([]map[string]interface{}, 0, len(resp.GetAlerts()))
	for _, a := range resp.GetAlerts() {
		alerts = append(alerts, fraudAlertToJSON(a))
	}

	result := map[string]interface{}{
		"alerts": alerts,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = map[string]interface{}{
			"total_count": pg.GetTotalCount(),
			"page":        pg.GetPage(),
			"page_size":   pg.GetPageSize(),
			"total_pages": pg.GetTotalPages(),
			"has_next":    pg.GetHasNext(),
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// ReviewAlert handles POST /api/v1/admin/fraud/alerts/{id}/review.
func (h *FraudHandler) ReviewAlert(w http.ResponseWriter, r *http.Request) {
	alertID := chi.URLParam(r, "id")
	if alertID == "" {
		writeError(w, http.StatusBadRequest, "alert id required")
		return
	}

	// Get the admin user ID from auth context.
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Status          string `json:"status"`
		ResolutionNotes string `json:"resolution_notes"`
		RestrictUser    bool   `json:"restrict_user"`
		BanUser         bool   `json:"ban_user"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	newStatus := parseAlertStatus(body.Status)
	if newStatus == fraudv1.AlertStatus_ALERT_STATUS_UNSPECIFIED {
		writeError(w, http.StatusBadRequest, "invalid status")
		return
	}

	resp, err := h.fraudClient.AdminReviewFraudAlert(r.Context(), &fraudv1.AdminReviewFraudAlertRequest{
		AlertId:         alertID,
		AdminId:         claims.UserID,
		NewStatus:       newStatus,
		ResolutionNotes: body.ResolutionNotes,
		RestrictUser:    body.RestrictUser,
		BanUser:         body.BanUser,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"alert": fraudAlertToJSON(resp.GetAlert()),
	})
}

// GetUserRiskProfile handles GET /api/v1/admin/fraud/users/{id}/risk.
func (h *FraudHandler) GetUserRiskProfile(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	resp, err := h.fraudClient.GetUserRiskProfile(r.Context(), &fraudv1.GetUserRiskProfileRequest{
		UserId: userID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, riskProfileToJSON(resp.GetProfile()))
}

// ---------------------------------------------------------------------------
// Proto to JSON conversion helpers
// ---------------------------------------------------------------------------

func fraudAlertToJSON(a *fraudv1.FraudAlert) map[string]interface{} {
	if a == nil {
		return map[string]interface{}{}
	}

	signals := make([]map[string]interface{}, 0, len(a.GetSignals()))
	for _, s := range a.GetSignals() {
		signals = append(signals, fraudSignalToJSON(s))
	}

	result := map[string]interface{}{
		"id":               a.GetId(),
		"user_id":          a.GetUserId(),
		"signals":          signals,
		"aggregate_risk":   riskLevelToString(a.GetAggregateRisk()),
		"status":           alertStatusToString(a.GetStatus()),
		"assigned_to":      a.GetAssignedTo(),
		"resolution_notes": a.GetResolutionNotes(),
		"created_at":       formatTimestamp(a.GetCreatedAt()),
	}
	if a.GetResolvedAt() != nil {
		result["resolved_at"] = formatTimestamp(a.GetResolvedAt())
	}
	return result
}

func fraudSignalToJSON(s *fraudv1.FraudSignal) map[string]interface{} {
	if s == nil {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"id":                 s.GetId(),
		"user_id":            s.GetUserId(),
		"signal_type":        fraudSignalTypeToString(s.GetSignalType()),
		"confidence":         s.GetConfidence(),
		"risk_level":         riskLevelToString(s.GetRiskLevel()),
		"details":            s.GetDetails(),
		"ip_address":         s.GetIpAddress(),
		"device_fingerprint": s.GetDeviceFingerprint(),
		"reference_type":     s.GetReferenceType(),
		"reference_id":       s.GetReferenceId(),
		"detected_at":        formatTimestamp(s.GetDetectedAt()),
	}
}

func riskProfileToJSON(p *fraudv1.UserRiskProfile) map[string]interface{} {
	if p == nil {
		return map[string]interface{}{}
	}

	signalTypes := make([]string, 0, len(p.GetRecentSignalTypes()))
	for _, st := range p.GetRecentSignalTypes() {
		signalTypes = append(signalTypes, fraudSignalTypeToString(st))
	}

	result := map[string]interface{}{
		"user_id":             p.GetUserId(),
		"risk_score":          p.GetRiskScore(),
		"risk_level":          riskLevelToString(p.GetRiskLevel()),
		"total_signals":       p.GetTotalSignals(),
		"active_alerts":       p.GetActiveAlerts(),
		"recent_signal_types": signalTypes,
		"is_restricted":       p.GetIsRestricted(),
	}
	if p.GetLastSignalAt() != nil {
		result["last_signal_at"] = formatTimestamp(p.GetLastSignalAt())
	}
	if p.GetLastReviewedAt() != nil {
		result["last_reviewed_at"] = formatTimestamp(p.GetLastReviewedAt())
	}
	return result
}

// ---------------------------------------------------------------------------
// Enum conversions
// ---------------------------------------------------------------------------

func riskLevelToString(rl fraudv1.RiskLevel) string {
	switch rl {
	case fraudv1.RiskLevel_RISK_LEVEL_LOW:
		return "low"
	case fraudv1.RiskLevel_RISK_LEVEL_MEDIUM:
		return "medium"
	case fraudv1.RiskLevel_RISK_LEVEL_HIGH:
		return "high"
	case fraudv1.RiskLevel_RISK_LEVEL_CRITICAL:
		return "critical"
	default:
		return "unspecified"
	}
}

func parseRiskLevel(s string) fraudv1.RiskLevel {
	switch s {
	case "low":
		return fraudv1.RiskLevel_RISK_LEVEL_LOW
	case "medium":
		return fraudv1.RiskLevel_RISK_LEVEL_MEDIUM
	case "high":
		return fraudv1.RiskLevel_RISK_LEVEL_HIGH
	case "critical":
		return fraudv1.RiskLevel_RISK_LEVEL_CRITICAL
	default:
		return fraudv1.RiskLevel_RISK_LEVEL_UNSPECIFIED
	}
}

func alertStatusToString(s fraudv1.AlertStatus) string {
	switch s {
	case fraudv1.AlertStatus_ALERT_STATUS_OPEN:
		return "open"
	case fraudv1.AlertStatus_ALERT_STATUS_INVESTIGATING:
		return "investigating"
	case fraudv1.AlertStatus_ALERT_STATUS_RESOLVED_FRAUD:
		return "resolved_fraud"
	case fraudv1.AlertStatus_ALERT_STATUS_RESOLVED_LEGITIMATE:
		return "resolved_legitimate"
	case fraudv1.AlertStatus_ALERT_STATUS_DISMISSED:
		return "dismissed"
	default:
		return "unspecified"
	}
}

func parseAlertStatus(s string) fraudv1.AlertStatus {
	switch s {
	case "open":
		return fraudv1.AlertStatus_ALERT_STATUS_OPEN
	case "investigating":
		return fraudv1.AlertStatus_ALERT_STATUS_INVESTIGATING
	case "resolved_fraud":
		return fraudv1.AlertStatus_ALERT_STATUS_RESOLVED_FRAUD
	case "resolved_legitimate":
		return fraudv1.AlertStatus_ALERT_STATUS_RESOLVED_LEGITIMATE
	case "dismissed":
		return fraudv1.AlertStatus_ALERT_STATUS_DISMISSED
	default:
		return fraudv1.AlertStatus_ALERT_STATUS_UNSPECIFIED
	}
}

func fraudSignalTypeToString(st fraudv1.FraudSignalType) string {
	switch st {
	case fraudv1.FraudSignalType_FRAUD_SIGNAL_TYPE_VELOCITY:
		return "velocity"
	case fraudv1.FraudSignalType_FRAUD_SIGNAL_TYPE_GEO_MISMATCH:
		return "geo_mismatch"
	case fraudv1.FraudSignalType_FRAUD_SIGNAL_TYPE_DEVICE_FINGERPRINT:
		return "device_fingerprint"
	case fraudv1.FraudSignalType_FRAUD_SIGNAL_TYPE_SHILL_BID:
		return "shill_bid"
	case fraudv1.FraudSignalType_FRAUD_SIGNAL_TYPE_ACCOUNT_TAKEOVER:
		return "account_takeover"
	case fraudv1.FraudSignalType_FRAUD_SIGNAL_TYPE_PAYMENT_FRAUD:
		return "payment_fraud"
	case fraudv1.FraudSignalType_FRAUD_SIGNAL_TYPE_FAKE_REVIEW:
		return "fake_review"
	case fraudv1.FraudSignalType_FRAUD_SIGNAL_TYPE_MULTI_ACCOUNT:
		return "multi_account"
	case fraudv1.FraudSignalType_FRAUD_SIGNAL_TYPE_BOT_BEHAVIOR:
		return "bot_behavior"
	default:
		return "unspecified"
	}
}
