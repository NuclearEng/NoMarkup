package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// SEC-GATE-03 / R6.2: admin cannot enable fee_config.lead_gen_enabled while the
// lead_gen product flag is disabled (production fail-closed on nil DB).
func TestAdminPaymentsHandler_UpdateFeeConfig_leadGenBlockedWhenFlagOff(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")

	h := NewAdminPaymentsHandler(nil, nil, nil)

	body := map[string]interface{}{
		"fee_percentage":         0.08,
		"guarantee_percentage":   0.02,
		"min_fee_cents":          100,
		"lead_gen_enabled":       true,
		"lead_gen_percentage":    0.10,
		"lead_gen_min_fee_cents": 0,
	}
	raw, err := json.Marshal(body)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/fees", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), middleware.ClaimsContextKey, &middleware.Claims{
		UserID: "admin-1",
		Roles:  []string{"admin"},
	}))

	rec := httptest.NewRecorder()
	h.UpdateFeeConfig(rec, req)

	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.Contains(t, rec.Body.String(), "lead_gen")
}

func TestAdminPaymentsHandler_allowLeadGenFeeConfig_disableAlwaysAllowed(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	h := NewAdminPaymentsHandler(nil, nil, nil)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/fees", nil)
	ok := h.allowLeadGenFeeConfig(rec, req, false)
	assert.True(t, ok)
}

func TestAdminPaymentsHandler_allowLeadGenFeeConfig_enableBlockedInProd(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	h := NewAdminPaymentsHandler(nil, nil, nil)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/", nil)
	ok := h.allowLeadGenFeeConfig(rec, req, true)
	assert.False(t, ok)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
}
