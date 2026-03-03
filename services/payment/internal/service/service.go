package service

import "github.com/nomarkup/nomarkup/services/payment/internal/domain"

// Service implements payment business logic.
type Service struct {
	repo domain.PaymentRepository
}

// New creates a new payment service.
func New(repo domain.PaymentRepository) *Service {
	return &Service{repo: repo}
}
