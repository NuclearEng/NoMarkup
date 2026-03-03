package service

import "github.com/nomarkup/nomarkup/services/user/internal/domain"

// Service implements user business logic.
type Service struct {
	repo domain.UserRepository
}

// New creates a new user service.
func New(repo domain.UserRepository) *Service {
	return &Service{repo: repo}
}
