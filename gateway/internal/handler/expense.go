package handler

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ExpenseHandler handles HTTP endpoints for provider expenses.
type ExpenseHandler struct {
	paymentClient paymentv1.PaymentServiceClient
}

// NewExpenseHandler creates a new ExpenseHandler.
func NewExpenseHandler(paymentClient paymentv1.PaymentServiceClient) *ExpenseHandler {
	return &ExpenseHandler{paymentClient: paymentClient}
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
	if !decodeJSON(w, r, &req) {
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
	// Bound the amount to the platform cap. Without an upper bound, a handful of
	// near-int64-max expenses overflow the BIGINT SUM in ListExpenses and 500 the
	// provider's entire expense list until the poisoned rows are deleted.
	if msg := validateMoneyCents("amount_cents", req.AmountCents); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if req.ExpenseDate == "" {
		writeError(w, http.StatusBadRequest, "expense_date is required")
		return
	}

	resp, err := h.paymentClient.CreateExpense(r.Context(), &paymentv1.CreateExpenseRequest{
		ProviderId:  claims.UserID,
		Category:    req.Category,
		Description: req.Description,
		AmountCents: req.AmountCents,
		ReceiptUrl:  req.ReceiptURL,
		ExpenseDate: req.ExpenseDate,
	})
	if err != nil {
		slog.Error("create expense gRPC call failed", "error", err, "provider_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"expense": protoExpenseToJSON(resp.GetExpense()),
	})
}

// ListExpenses handles GET /api/v1/providers/me/expenses.
func (h *ExpenseHandler) ListExpenses(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()

	grpcReq := &paymentv1.ListExpensesRequest{
		ProviderId: claims.UserID,
		StartDate:  q.Get("start_date"),
		EndDate:    q.Get("end_date"),
	}

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
	grpcReq.Pagination = &commonv1.PaginationRequest{
		Page:     page,
		PageSize: pageSize,
	}

	resp, err := h.paymentClient.ListExpenses(r.Context(), grpcReq)
	if err != nil {
		slog.Error("list expenses gRPC call failed", "error", err, "provider_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	expenses := make([]map[string]interface{}, 0, len(resp.GetExpenses()))
	for _, e := range resp.GetExpenses() {
		expenses = append(expenses, protoExpenseToJSON(e))
	}

	result := map[string]interface{}{
		"expenses":    expenses,
		"total_cents": resp.GetTotalCents(),
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

// DeleteExpense handles DELETE /api/v1/providers/me/expenses/{id}.
func (h *ExpenseHandler) DeleteExpense(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	expenseID := chi.URLParam(r, "id")
	if expenseID == "" {
		writeError(w, http.StatusBadRequest, "expense id required")
		return
	}
	if !isValidUUID(expenseID) {
		writeError(w, http.StatusBadRequest, "invalid expense id")
		return
	}

	_, err := h.paymentClient.DeleteExpense(r.Context(), &paymentv1.DeleteExpenseRequest{
		ExpenseId:  expenseID,
		ProviderId: claims.UserID,
	})
	if err != nil {
		slog.Error("delete expense gRPC call failed", "error", err, "expense_id", expenseID, "provider_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --- Proto to JSON helper ---

func protoExpenseToJSON(e *paymentv1.Expense) map[string]interface{} {
	if e == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":           e.GetId(),
		"provider_id":  e.GetProviderId(),
		"category":     e.GetCategory(),
		"description":  e.GetDescription(),
		"amount_cents": e.GetAmountCents(),
		"receipt_url":  nil,
		"expense_date": e.GetExpenseDate(),
		"created_at":   formatTimestamp(e.GetCreatedAt()),
		"updated_at":   formatTimestamp(e.GetUpdatedAt()),
	}
	if e.GetReceiptUrl() != "" {
		result["receipt_url"] = e.GetReceiptUrl()
	}
	return result
}
