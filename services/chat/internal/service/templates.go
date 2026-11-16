package service

// Quick-reply templates — service-layer CRUD for per-user message
// templates. The gateway side (gateway/internal/handler/chat_templates.go)
// is the HTTP surface; this file holds the (small) reusable business
// logic in case future RPC consumers (e.g. a mobile gRPC client) need it
// without going through the gateway.
//
// Closes audit Section F's "no canned responses" gap. Wave 5 / Agent P.

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// TemplateMaxLen mirrors the DB CHECK on message_templates.body. Keeping
// it here lets validation happen at the service boundary too, so callers
// don't have to round-trip to the DB to learn they sent too many bytes.
const TemplateMaxLen = 500

// ErrEmptyTemplateBody is returned when a CreateTemplate call passes a
// body that, after trimming, is empty.
var ErrEmptyTemplateBody = errors.New("template body is empty")

// ErrTemplateTooLong is returned when a template body exceeds TemplateMaxLen.
var ErrTemplateTooLong = errors.New("template body too long")

// MessageTemplate is the domain shape for a quick-reply.
type MessageTemplate struct {
	ID       string
	UserID   string
	Body     string
	UseCount int
}

// TemplateRepository is the persistence boundary for message_templates.
// The default implementation is direct pgx in the gateway handler; this
// interface exists so tests can stub it without standing up a DB.
type TemplateRepository interface {
	CreateTemplate(ctx context.Context, userID, body string) (*MessageTemplate, error)
	UpdateTemplate(ctx context.Context, userID, id, body string) (*MessageTemplate, error)
	DeleteTemplate(ctx context.Context, userID, id string) error
	ListTemplates(ctx context.Context, userID string) ([]*MessageTemplate, error)
	IncrementUseCount(ctx context.Context, userID, id string) (int, error)
}

// TemplateService wraps a TemplateRepository with input validation and
// the marketplace-friendly default list.
type TemplateService struct {
	repo TemplateRepository
}

// NewTemplateService returns a TemplateService.
func NewTemplateService(repo TemplateRepository) *TemplateService {
	return &TemplateService{repo: repo}
}

// DefaultTemplates is the built-in fallback list returned alongside a
// user's own templates when the empty-state would otherwise be barren.
// Mirrors the list in gateway/internal/handler/chat_templates.go so
// callers see the same defaults whether they go through the gateway or
// the (future) gRPC surface.
var DefaultTemplates = []string{
	"Is this still available?",
	"What's your best price?",
	"Can you do $___?",
	"I can pick up tomorrow at 5pm.",
	"Would you take $___ cash today?",
	"Can you send more photos?",
	"Where is the pickup location?",
	"Thanks, I'll pass for now.",
}

// validateBody trims the body and rejects empty or oversize input.
func validateBody(body string) (string, error) {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return "", ErrEmptyTemplateBody
	}
	if len(trimmed) > TemplateMaxLen {
		return "", ErrTemplateTooLong
	}
	return trimmed, nil
}

// Create validates and persists a new template.
func (s *TemplateService) Create(ctx context.Context, userID, body string) (*MessageTemplate, error) {
	trimmed, err := validateBody(body)
	if err != nil {
		return nil, err
	}
	if userID == "" {
		return nil, fmt.Errorf("create template: user_id is required")
	}
	return s.repo.CreateTemplate(ctx, userID, trimmed)
}

// Update validates and updates an existing template owned by userID.
func (s *TemplateService) Update(ctx context.Context, userID, id, body string) (*MessageTemplate, error) {
	trimmed, err := validateBody(body)
	if err != nil {
		return nil, err
	}
	if userID == "" || id == "" {
		return nil, fmt.Errorf("update template: user_id and id are required")
	}
	return s.repo.UpdateTemplate(ctx, userID, id, trimmed)
}

// Delete removes a template owned by userID.
func (s *TemplateService) Delete(ctx context.Context, userID, id string) error {
	if userID == "" || id == "" {
		return fmt.Errorf("delete template: user_id and id are required")
	}
	return s.repo.DeleteTemplate(ctx, userID, id)
}

// List returns the user's templates merged with the default fallback list.
// The defaults are returned via a separate slice so the UI can render
// them in a "suggested" rail rather than as first-class user rows.
func (s *TemplateService) List(ctx context.Context, userID string) ([]*MessageTemplate, []string, error) {
	if userID == "" {
		return nil, DefaultTemplates, fmt.Errorf("list templates: user_id is required")
	}
	rows, err := s.repo.ListTemplates(ctx, userID)
	if err != nil {
		return nil, DefaultTemplates, err
	}
	return rows, DefaultTemplates, nil
}

// Use bumps use_count and returns the new value. Idempotency is
// intentionally NOT enforced — clicking the same template twice should
// move it up the sort order each time.
func (s *TemplateService) Use(ctx context.Context, userID, id string) (int, error) {
	if userID == "" || id == "" {
		return 0, fmt.Errorf("use template: user_id and id are required")
	}
	return s.repo.IncrementUseCount(ctx, userID, id)
}
