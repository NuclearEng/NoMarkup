package service

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
	"github.com/nomarkup/nomarkup/services/user/internal/repository"
)

// Profile implements profile-related business logic.
type Profile struct {
	repo domain.UserRepository
}

// NewProfile creates a new Profile service.
func NewProfile(repo domain.UserRepository) *Profile {
	return &Profile{repo: repo}
}

func (s *Profile) GetUser(ctx context.Context, userID string) (*domain.User, error) {
	return s.repo.GetUserByID(ctx, userID)
}

func (s *Profile) UpdateUser(ctx context.Context, userID string, input domain.UpdateUserInput) (*domain.User, error) {
	return s.repo.UpdateUser(ctx, userID, input)
}

func (s *Profile) EnableRole(ctx context.Context, userID string, role string) (*domain.User, error) {
	if role != "customer" && role != "provider" {
		return nil, fmt.Errorf("enable role: %w", domain.ErrInvalidRole)
	}

	user, err := s.repo.EnableRole(ctx, userID, role)
	if err != nil {
		return nil, fmt.Errorf("enable role: %w", err)
	}

	if role == "provider" {
		if _, err := s.repo.CreateProviderProfile(ctx, userID); err != nil {
			return nil, fmt.Errorf("enable role create provider profile: %w", err)
		}
	}

	return user, nil
}

func (s *Profile) GetProviderProfile(ctx context.Context, userID string) (*domain.ProviderProfile, error) {
	return s.repo.GetProviderProfile(ctx, userID)
}

func (s *Profile) UpdateProviderProfile(ctx context.Context, userID string, input domain.UpdateProviderInput) (*domain.ProviderProfile, error) {
	p, err := s.repo.UpdateProviderProfile(ctx, userID, input)
	if err != nil {
		return nil, fmt.Errorf("update provider profile: %w", err)
	}

	cats, catsErr := s.repo.GetServiceCategories(ctx, p.ID)
	if catsErr == nil {
		p.Categories = cats
	}
	imgs, imgsErr := s.repo.GetPortfolioImages(ctx, p.ID)
	if imgsErr == nil {
		p.PortfolioImages = imgs
	}

	completeness := repository.ComputeProfileCompleteness(p)
	if completeness != p.ProfileCompleteness {
		p.ProfileCompleteness = completeness
	}

	return p, nil
}

func (s *Profile) SetGlobalTerms(ctx context.Context, userID string, input domain.GlobalTermsInput) error {
	if input.PaymentTiming == "milestone" && len(input.Milestones) > 0 {
		total := 0
		for _, m := range input.Milestones {
			total += m.Percentage
		}
		if total != 100 {
			return fmt.Errorf("set global terms: milestone percentages must sum to 100, got %d", total)
		}
	}
	return s.repo.SetGlobalTerms(ctx, userID, input)
}

func (s *Profile) UpdateServiceCategories(ctx context.Context, userID string, categoryIDs []string) error {
	providerID, err := s.repo.GetProviderIDByUserID(ctx, userID)
	if err != nil {
		return fmt.Errorf("update service categories: %w", err)
	}
	return s.repo.UpdateServiceCategories(ctx, providerID, categoryIDs)
}

func (s *Profile) UpdatePortfolio(ctx context.Context, userID string, images []domain.PortfolioImage) error {
	providerID, err := s.repo.GetProviderIDByUserID(ctx, userID)
	if err != nil {
		return fmt.Errorf("update portfolio: %w", err)
	}
	return s.repo.UpdatePortfolio(ctx, providerID, images)
}

func (s *Profile) SetInstantAvailability(ctx context.Context, userID string, input domain.AvailabilityInput) error {
	if input.Schedule == nil {
		input.Schedule = []byte("null")
	}
	return s.repo.SetInstantAvailability(ctx, userID, input)
}

func (s *Profile) GetProviderServiceCategories(ctx context.Context, userID string) ([]domain.ServiceCategory, error) {
	providerID, err := s.repo.GetProviderIDByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("get provider service categories: %w", err)
	}
	return s.repo.GetServiceCategories(ctx, providerID)
}

func (s *Profile) ListServiceCategories(ctx context.Context, level *int, parentID *string) ([]domain.ServiceCategory, error) {
	return s.repo.ListServiceCategories(ctx, level, parentID)
}

func (s *Profile) GetCategoryTree(ctx context.Context) ([]domain.ServiceCategory, error) {
	return s.repo.GetCategoryTree(ctx)
}

// MarshalSchedule converts AvailabilityWindow proto objects into JSON for DB storage.
func MarshalSchedule(data interface{}) ([]byte, error) {
	b, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("marshal schedule: %w", err)
	}
	return b, nil
}
