package grpc

import (
	"context"
	"errors"
	"time"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Server) CreateExpense(ctx context.Context, req *paymentv1.CreateExpenseRequest) (*paymentv1.CreateExpenseResponse, error) {
	if req.GetProviderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_id is required")
	}
	if req.GetCategory() == "" {
		return nil, status.Error(codes.InvalidArgument, "category is required")
	}
	if req.GetDescription() == "" {
		return nil, status.Error(codes.InvalidArgument, "description is required")
	}
	if req.GetAmountCents() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "amount_cents must be positive")
	}
	if req.GetExpenseDate() == "" {
		return nil, status.Error(codes.InvalidArgument, "expense_date is required")
	}

	expenseDate, err := time.Parse("2006-01-02", req.GetExpenseDate())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "expense_date must be YYYY-MM-DD format")
	}

	expense, err := s.svc.CreateExpense(
		ctx,
		req.GetProviderId(),
		req.GetCategory(),
		req.GetDescription(),
		req.GetAmountCents(),
		req.GetReceiptUrl(),
		expenseDate,
	)
	if err != nil {
		return nil, mapExpenseError(err)
	}

	return &paymentv1.CreateExpenseResponse{
		Expense: domainExpenseToProto(expense),
	}, nil
}

func (s *Server) ListExpenses(ctx context.Context, req *paymentv1.ListExpensesRequest) (*paymentv1.ListExpensesResponse, error) {
	if req.GetProviderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_id is required")
	}

	var startDate, endDate *time.Time
	if req.GetStartDate() != "" {
		t, err := time.Parse("2006-01-02", req.GetStartDate())
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "start_date must be YYYY-MM-DD format")
		}
		startDate = &t
	}
	if req.GetEndDate() != "" {
		t, err := time.Parse("2006-01-02", req.GetEndDate())
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "end_date must be YYYY-MM-DD format")
		}
		endDate = &t
	}

	page := int32(1)
	pageSize := int32(20)
	if pg := req.GetPagination(); pg != nil {
		if pg.GetPage() > 0 {
			page = pg.GetPage()
		}
		if pg.GetPageSize() > 0 {
			pageSize = pg.GetPageSize()
		}
	}

	expenses, totalCents, totalCount, err := s.svc.ListExpenses(ctx, req.GetProviderId(), startDate, endDate, int(page), int(pageSize))
	if err != nil {
		return nil, mapExpenseError(err)
	}

	protoExpenses := make([]*paymentv1.Expense, 0, len(expenses))
	for _, e := range expenses {
		protoExpenses = append(protoExpenses, domainExpenseToProto(e))
	}

	totalPages := int32(0)
	if totalCount > 0 {
		totalPages = (int32(totalCount) + pageSize - 1) / pageSize
	}

	return &paymentv1.ListExpensesResponse{
		Expenses:   protoExpenses,
		TotalCents: totalCents,
		Pagination: &commonv1.PaginationResponse{
			TotalCount: int32(totalCount),
			Page:       page,
			PageSize:   pageSize,
			TotalPages: totalPages,
			HasNext:    page < totalPages,
		},
	}, nil
}

func (s *Server) DeleteExpense(ctx context.Context, req *paymentv1.DeleteExpenseRequest) (*paymentv1.DeleteExpenseResponse, error) {
	if req.GetExpenseId() == "" {
		return nil, status.Error(codes.InvalidArgument, "expense_id is required")
	}
	if req.GetProviderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_id is required")
	}

	if err := s.svc.DeleteExpense(ctx, req.GetExpenseId(), req.GetProviderId()); err != nil {
		return nil, mapExpenseError(err)
	}

	return &paymentv1.DeleteExpenseResponse{}, nil
}

// --- Conversion helpers ---

func domainExpenseToProto(e *domain.Expense) *paymentv1.Expense {
	if e == nil {
		return nil
	}

	pb := &paymentv1.Expense{
		Id:          e.ID,
		ProviderId:  e.ProviderID,
		Category:    e.Category,
		Description: e.Description,
		AmountCents: e.AmountCents,
		ExpenseDate: e.ExpenseDate.Format("2006-01-02"),
		CreatedAt:   timestamppb.New(e.CreatedAt),
		UpdatedAt:   timestamppb.New(e.UpdatedAt),
	}
	if e.ReceiptURL != nil {
		pb.ReceiptUrl = *e.ReceiptURL
	}
	return pb
}

func mapExpenseError(err error) error {
	switch {
	case errors.Is(err, domain.ErrExpenseNotFound):
		return status.Error(codes.NotFound, "expense not found")
	case errors.Is(err, domain.ErrInvalidAmount):
		return status.Error(codes.InvalidArgument, "invalid amount")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
