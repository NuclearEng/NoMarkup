package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// NotificationHandler handles HTTP endpoints for notifications.
type NotificationHandler struct {
	notifClient notificationv1.NotificationServiceClient
}

// NewNotificationHandler creates a new NotificationHandler.
func NewNotificationHandler(client notificationv1.NotificationServiceClient) *NotificationHandler {
	return &NotificationHandler{notifClient: client}
}

// ListNotifications handles GET /api/v1/notifications.
func (h *NotificationHandler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()

	page := int32(1)
	pageSize := int32(20)
	if p := q.Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil {
			page = int32(v)
		}
	}
	if ps := q.Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil {
			pageSize = int32(v)
		}
	}

	var unreadOnly *bool
	if uo := q.Get("unread_only"); uo == "true" {
		t := true
		unreadOnly = &t
	}

	req := &notificationv1.ListNotificationsRequest{
		UserId:     claims.UserID,
		UnreadOnly: unreadOnly,
		Pagination: &commonv1.PaginationRequest{
			Page:     page,
			PageSize: pageSize,
		},
	}

	resp, err := h.notifClient.ListNotifications(r.Context(), req)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	notifications := make([]map[string]interface{}, 0, len(resp.GetNotifications()))
	for _, n := range resp.GetNotifications() {
		notifications = append(notifications, protoNotificationToJSON(n))
	}

	result := map[string]interface{}{
		"notifications": notifications,
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

// MarkAsRead handles POST /api/v1/notifications/{id}/read.
func (h *NotificationHandler) MarkAsRead(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	notificationID := chi.URLParam(r, "id")
	if notificationID == "" {
		writeError(w, http.StatusBadRequest, "notification id required")
		return
	}

	_, err := h.notifClient.MarkAsRead(r.Context(), &notificationv1.MarkAsReadRequest{
		NotificationId: notificationID,
		UserId:         claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// MarkAllAsRead handles POST /api/v1/notifications/read-all.
func (h *NotificationHandler) MarkAllAsRead(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.notifClient.MarkAllAsRead(r.Context(), &notificationv1.MarkAllAsReadRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"marked_count": resp.GetMarkedCount(),
	})
}

// GetUnreadCount handles GET /api/v1/notifications/unread-count.
func (h *NotificationHandler) GetUnreadCount(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.notifClient.GetUnreadCount(r.Context(), &notificationv1.GetUnreadCountRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"count": resp.GetCount(),
	})
}

// GetPreferences handles GET /api/v1/notifications/preferences.
func (h *NotificationHandler) GetPreferences(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.notifClient.GetPreferences(r.Context(), &notificationv1.GetPreferencesRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	prefs := make([]map[string]interface{}, 0, len(resp.GetPreferences()))
	for _, p := range resp.GetPreferences() {
		prefs = append(prefs, map[string]interface{}{
			"notification_type": notificationTypeToString(p.GetNotificationType()),
			"push_enabled":      p.GetPushEnabled(),
			"email_enabled":     p.GetEmailEnabled(),
			"sms_enabled":       p.GetSmsEnabled(),
			"in_app_enabled":    p.GetInAppEnabled(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"preferences":          prefs,
		"global_push_enabled":  resp.GetGlobalPushEnabled(),
		"global_email_enabled": resp.GetGlobalEmailEnabled(),
		"global_sms_enabled":   resp.GetGlobalSmsEnabled(),
	})
}

type updatePreferencesRequest struct {
	Preferences []struct {
		NotificationType string `json:"notification_type"`
		PushEnabled      bool   `json:"push_enabled"`
		EmailEnabled     bool   `json:"email_enabled"`
		SmsEnabled       bool   `json:"sms_enabled"`
		InAppEnabled     bool   `json:"in_app_enabled"`
	} `json:"preferences"`
}

// UpdatePreferences handles PUT /api/v1/notifications/preferences.
func (h *NotificationHandler) UpdatePreferences(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req updatePreferencesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	protoPrefs := make([]*notificationv1.NotificationPreference, 0, len(req.Preferences))
	for _, p := range req.Preferences {
		protoPrefs = append(protoPrefs, &notificationv1.NotificationPreference{
			NotificationType: stringToNotificationType(p.NotificationType),
			PushEnabled:      p.PushEnabled,
			EmailEnabled:     p.EmailEnabled,
			SmsEnabled:       p.SmsEnabled,
			InAppEnabled:     p.InAppEnabled,
		})
	}

	resp, err := h.notifClient.UpdatePreferences(r.Context(), &notificationv1.UpdatePreferencesRequest{
		UserId:      claims.UserID,
		Preferences: protoPrefs,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	prefs := make([]map[string]interface{}, 0, len(resp.GetPreferences()))
	for _, p := range resp.GetPreferences() {
		prefs = append(prefs, map[string]interface{}{
			"notification_type": notificationTypeToString(p.GetNotificationType()),
			"push_enabled":      p.GetPushEnabled(),
			"email_enabled":     p.GetEmailEnabled(),
			"sms_enabled":       p.GetSmsEnabled(),
			"in_app_enabled":    p.GetInAppEnabled(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"preferences": prefs,
	})
}

// --- Proto to JSON conversion helpers ---

func protoNotificationToJSON(n *notificationv1.Notification) map[string]interface{} {
	if n == nil {
		return map[string]interface{}{}
	}

	channelsSent := make([]string, 0, len(n.GetChannelsSent()))
	for _, ch := range n.GetChannelsSent() {
		channelsSent = append(channelsSent, notificationChannelToString(ch))
	}

	result := map[string]interface{}{
		"id":                n.GetId(),
		"user_id":           n.GetUserId(),
		"notification_type": notificationTypeToString(n.GetNotificationType()),
		"title":             n.GetTitle(),
		"body":              n.GetBody(),
		"action_url":        n.GetActionUrl(),
		"is_read":           n.GetIsRead(),
		"channels_sent":     channelsSent,
		"created_at":        formatTimestamp(n.GetCreatedAt()),
	}

	if n.GetReadAt() != nil {
		result["read_at"] = formatTimestamp(n.GetReadAt())
	}

	if n.GetData() != nil && len(n.GetData()) > 0 {
		result["data"] = n.GetData()
	}

	return result
}

// --- Enum conversions ---

func notificationTypeToString(nt notificationv1.NotificationType) string {
	switch nt {
	case notificationv1.NotificationType_NOTIFICATION_TYPE_NEW_BID:
		return "new_bid"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_BID_AWARDED:
		return "bid_awarded"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_BID_NOT_SELECTED:
		return "bid_not_selected"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_AUCTION_CLOSING_SOON:
		return "auction_closing_soon"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_AUCTION_CLOSED:
		return "auction_closed"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_OFFER_ACCEPTED:
		return "offer_accepted"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_CONTRACT_CREATED:
		return "contract_created"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_CONTRACT_ACCEPTED:
		return "contract_accepted"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_WORK_STARTED:
		return "work_started"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_MILESTONE_SUBMITTED:
		return "milestone_submitted"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_MILESTONE_APPROVED:
		return "milestone_approved"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_REVISION_REQUESTED:
		return "revision_requested"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_WORK_COMPLETED:
		return "work_completed"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_COMPLETION_APPROVED:
		return "completion_approved"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_RECEIVED:
		return "payment_received"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_RELEASED:
		return "payment_released"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_FAILED:
		return "payment_failed"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_PAYOUT_SENT:
		return "payout_sent"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_NEW_MESSAGE:
		return "new_message"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_REVIEW_RECEIVED:
		return "review_received"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_REVIEW_REMINDER:
		return "review_reminder"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_DISPUTE_OPENED:
		return "dispute_opened"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_DISPUTE_RESOLVED:
		return "dispute_resolved"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_TIER_UPGRADE:
		return "tier_upgrade"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_TIER_DOWNGRADE:
		return "tier_downgrade"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_DOCUMENT_APPROVED:
		return "document_approved"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_DOCUMENT_REJECTED:
		return "document_rejected"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_DOCUMENT_EXPIRING:
		return "document_expiring"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_CHANGE_ORDER_PROPOSED:
		return "change_order_proposed"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_CHANGE_ORDER_RESPONDED:
		return "change_order_responded"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_RECURRING_UPCOMING:
		return "recurring_upcoming"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_RECURRING_INSTANCE_READY:
		return "recurring_instance_ready"
	default:
		return "unspecified"
	}
}

func stringToNotificationType(s string) notificationv1.NotificationType {
	switch s {
	case "new_bid":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_NEW_BID
	case "bid_awarded":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_BID_AWARDED
	case "bid_not_selected":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_BID_NOT_SELECTED
	case "auction_closing_soon":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_AUCTION_CLOSING_SOON
	case "auction_closed":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_AUCTION_CLOSED
	case "offer_accepted":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_OFFER_ACCEPTED
	case "contract_created":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_CONTRACT_CREATED
	case "contract_accepted":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_CONTRACT_ACCEPTED
	case "work_started":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_WORK_STARTED
	case "milestone_submitted":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_MILESTONE_SUBMITTED
	case "milestone_approved":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_MILESTONE_APPROVED
	case "revision_requested":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_REVISION_REQUESTED
	case "work_completed":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_WORK_COMPLETED
	case "completion_approved":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_COMPLETION_APPROVED
	case "payment_received":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_RECEIVED
	case "payment_released":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_RELEASED
	case "payment_failed":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_FAILED
	case "payout_sent":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_PAYOUT_SENT
	case "new_message":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_NEW_MESSAGE
	case "review_received":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_REVIEW_RECEIVED
	case "review_reminder":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_REVIEW_REMINDER
	case "dispute_opened":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_DISPUTE_OPENED
	case "dispute_resolved":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_DISPUTE_RESOLVED
	case "tier_upgrade":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_TIER_UPGRADE
	case "tier_downgrade":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_TIER_DOWNGRADE
	case "document_approved":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_DOCUMENT_APPROVED
	case "document_rejected":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_DOCUMENT_REJECTED
	case "document_expiring":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_DOCUMENT_EXPIRING
	case "change_order_proposed":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_CHANGE_ORDER_PROPOSED
	case "change_order_responded":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_CHANGE_ORDER_RESPONDED
	case "recurring_upcoming":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_RECURRING_UPCOMING
	case "recurring_instance_ready":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_RECURRING_INSTANCE_READY
	default:
		return notificationv1.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED
	}
}

func notificationChannelToString(ch notificationv1.NotificationChannel) string {
	switch ch {
	case notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_PUSH:
		return "push"
	case notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_EMAIL:
		return "email"
	case notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_SMS:
		return "sms"
	case notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_IN_APP:
		return "in_app"
	default:
		return "unspecified"
	}
}
