package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ExpenseHandler handles HTTP endpoints for provider expenses.
// Since the gRPC service does not exist yet, handlers return structured mock
// responses so the frontend can render realistic UI.
type ExpenseHandler struct{}

// NewExpenseHandler creates a new ExpenseHandler.
func NewExpenseHandler() *ExpenseHandler {
	return &ExpenseHandler{}
}

type createExpenseRequest struct {
	Category    string `json:"category"`
	Description string `json:"description"`
	AmountCents int64  `json:"amount_cents"`
	ReceiptURL  string `json:"receipt_url"`
	ExpenseDate string `json:"expense_date"`
}

// CreateExpense handles POST /api/v1/providers/me/expenses.
func (h *ExpenseHandler) CreateExpense(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req createExpenseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Category == "" {
		writeError(w, http.StatusBadRequest, "category is required")
		return
	}

	validCategories := map[string]bool{
		"materials":      true,
		"tools":          true,
		"transportation": true,
		"insurance":      true,
		"licensing":      true,
		"marketing":      true,
		"subcontractor":  true,
		"office":         true,
		"other":          true,
	}
	if !validCategories[req.Category] {
		writeError(w, http.StatusBadRequest, "invalid category")
		return
	}

	if req.Description == "" {
		writeError(w, http.StatusBadRequest, "description is required")
		return
	}
	if req.AmountCents <= 0 {
		writeError(w, http.StatusBadRequest, "amount_cents must be positive")
		return
	}
	if req.ExpenseDate == "" {
		writeError(w, http.StatusBadRequest, "expense_date is required")
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)

	expense := map[string]interface{}{
		"id":           uuid.New().String(),
		"provider_id":  claims.UserID,
		"category":     req.Category,
		"description":  req.Description,
		"amount_cents": req.AmountCents,
		"receipt_url":  nil,
		"expense_date": req.ExpenseDate,
		"created_at":   now,
		"updated_at":   now,
	}

	if req.ReceiptURL != "" {
		expense["receipt_url"] = req.ReceiptURL
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"expense": expense,
	})
}

// ListExpenses handles GET /api/v1/providers/me/expenses.
func (h *ExpenseHandler) ListExpenses(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	// Accept query params for filtering but return empty mock data.
	_ = r.URL.Query().Get("start_date")
	_ = r.URL.Query().Get("end_date")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"expenses":    []interface{}{},
		"total_cents": 0,
	})
}

// DeleteExpense handles DELETE /api/v1/providers/me/expenses/{id}.
func (h *ExpenseHandler) DeleteExpense(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	expenseID := chi.URLParam(r, "id")
	if expenseID == "" {
		writeError(w, http.StatusBadRequest, "expense id required")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
