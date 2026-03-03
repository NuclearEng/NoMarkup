package service

import "github.com/nomarkup/nomarkup/services/chat/internal/domain"

// Service implements chat business logic.
type Service struct {
	repo domain.ChannelRepository
}

// New creates a new chat service.
func New(repo domain.ChannelRepository) *Service {
	return &Service{repo: repo}
}
