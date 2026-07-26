package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
	"github.com/nomarkup/nomarkup/services/user/internal/repository"
)

// TrustScoreGetter retrieves trust scores for users. Implemented by a gRPC
// client wrapper so the profile service does not depend on protobuf directly.
type TrustScoreGetter interface {
	GetTrustScore(ctx context.Context, userID string) (*domain.TrustScore, error)
}

// Profile implements profile-related business logic.
type Profile struct {
	repo  domain.UserRepository
	trust TrustScoreGetter
}

// NewProfile creates a new Profile service.
func NewProfile(repo domain.UserRepository) *Profile {
	return &Profile{repo: repo}
}

// SetTrustClient sets the trust score client on the Profile service.
// Called after construction once the gRPC connection is established.
func (s *Profile) SetTrustClient(trust TrustScoreGetter) {
	s.trust = trust
}

func (s *Profile) GetUser(ctx context.Context, userID string) (*domain.User, error) {
	return s.repo.GetUserByID(ctx, userID)
}

// MaxBatchGetUsers caps a single BatchGetUsers request. Sized for the worst
// realistic caller (a bid list page's unique bidders, a chat thread's
// participants) with headroom, and enforced server-side because an unbounded id
// list is a trivial resource-exhaustion vector: the array is materialised in the
// query plan and every row in the result set is allocated.
const MaxBatchGetUsers = 200

// BatchGetUsers resolves up to MaxBatchGetUsers ids to their public projection
// in ONE database query.
//
// Behaviour that callers depend on:
//   - Over the cap => domain.ErrBatchTooLarge (InvalidArgument). Never
//     truncated: a silently partial answer is worse than an error, because the
//     caller cannot tell it happened.
//   - Duplicates are collapsed before the query.
//   - Malformed (non-UUID) ids are dropped rather than failing the batch — one
//     bad id from one caller must not deny the other 199 lookups. They are
//     logged so a gateway bug producing them is still visible.
//   - Ids with no live user are simply absent from the result.
func (s *Profile) BatchGetUsers(ctx context.Context, ids []string) ([]domain.PublicUser, error) {
	// Check the RAW length first: the cap must bound what we allocate, so it
	// has to be enforced before dedupe, not after.
	if len(ids) > MaxBatchGetUsers {
		return nil, fmt.Errorf("batch get users: %w (%d > %d)", domain.ErrBatchTooLarge, len(ids), MaxBatchGetUsers)
	}

	seen := make(map[string]struct{}, len(ids))
	unique := make([]string, 0, len(ids))
	malformed := 0
	for _, id := range ids {
		if id == "" {
			continue
		}
		if !isValidUUID(id) {
			malformed++
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}

	if malformed > 0 {
		slog.WarnContext(ctx, "batch get users: dropped malformed ids",
			"malformed_count", malformed, "requested_count", len(ids))
	}

	if len(unique) == 0 {
		return []domain.PublicUser{}, nil
	}

	users, err := s.repo.GetPublicUsersByIDs(ctx, unique)
	if err != nil {
		return nil, fmt.Errorf("batch get users: %w", err)
	}
	if users == nil {
		users = []domain.PublicUser{}
	}
	return users, nil
}

// isValidUUID reports whether s is a canonical 8-4-4-4-12 hex UUID. Kept local
// and allocation-free so the batch path can screen ids without pulling in a
// parser or risking a malformed value reaching the `::uuid[]` cast, where it
// would abort the whole statement.
func isValidUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i := 0; i < 36; i++ {
		c := s[i]
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		switch {
		case c >= '0' && c <= '9':
		case c >= 'a' && c <= 'f':
		case c >= 'A' && c <= 'F':
		default:
			return false
		}
	}
	return true
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
	profile, err := s.repo.GetProviderProfile(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Enrich with trust score if the client is available.
	if s.trust != nil {
		ts, tsErr := s.trust.GetTrustScore(ctx, userID)
		if tsErr != nil {
			slog.Warn("failed to fetch trust score for provider profile",
				"user_id", userID,
				"error", tsErr,
			)
		} else {
			profile.TrustScore = ts
		}
	}

	return profile, nil
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

func (s *Profile) SearchProviders(ctx context.Context, input domain.ProviderSearchInput) ([]domain.ProviderSearchResult, int, error) {
	results, total, err := s.repo.SearchProviders(ctx, input)
	if err != nil {
		return nil, 0, fmt.Errorf("search providers: %w", err)
	}

	// Enrich each result with trust scores if the client is available.
	if s.trust != nil {
		for i := range results {
			ts, tsErr := s.trust.GetTrustScore(ctx, results[i].UserID)
			if tsErr != nil {
				slog.Warn("failed to fetch trust score for search result",
					"user_id", results[i].UserID,
					"error", tsErr,
				)
				continue
			}
			results[i].TrustScore = ts
		}
	}

	return results, total, nil
}

// MarshalSchedule converts AvailabilityWindow proto objects into JSON for DB storage.
func MarshalSchedule(data interface{}) ([]byte, error) {
	b, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("marshal schedule: %w", err)
	}
	return b, nil
}

// --- Property operations ---

// CreateProperty creates a new property for a customer.
func (s *Profile) CreateProperty(ctx context.Context, input domain.CreatePropertyInput) (*domain.Property, error) {
	return s.repo.CreateProperty(ctx, input)
}

// ListProperties returns all properties for a user.
func (s *Profile) ListProperties(ctx context.Context, userID string) ([]domain.Property, error) {
	return s.repo.ListProperties(ctx, userID)
}

// UpdateProperty updates a property's mutable fields.
func (s *Profile) UpdateProperty(ctx context.Context, propertyID string, input domain.UpdatePropertyInput) (*domain.Property, error) {
	return s.repo.UpdateProperty(ctx, propertyID, input)
}

// DeleteProperty soft-deletes a property.
func (s *Profile) DeleteProperty(ctx context.Context, propertyID string) error {
	return s.repo.DeleteProperty(ctx, propertyID)
}
