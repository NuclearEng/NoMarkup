package service

import "github.com/nomarkup/nomarkup/services/job/internal/domain"

// Service implements job business logic.
type Service struct {
	repo domain.JobRepository
}

// New creates a new job service.
func New(repo domain.JobRepository) *Service {
	return &Service{repo: repo}
}
