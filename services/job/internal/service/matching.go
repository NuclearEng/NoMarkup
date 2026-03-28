package service

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

const (
	defaultMatchRadius  = 50000.0 // 50km in meters
	defaultMaxProviders = 5
)

// MatchingService finds the best-fit providers for a newly published job.
type MatchingService struct {
	repo domain.MatchingRepository
}

// NewMatchingService creates a new matching service.
func NewMatchingService(repo domain.MatchingRepository) *MatchingService {
	return &MatchingService{repo: repo}
}

// FindMatchingProviders identifies the top providers for a job based on category,
// geo proximity, trust score, historical win rate, and response time.
//
// Scoring weights:
//   - Trust score:    40%
//   - Geo proximity:  30%
//   - Win rate:       20%
//   - Response time:  10%
func (s *MatchingService) FindMatchingProviders(ctx context.Context, jobID, categoryID string, lat, lng float64, maxResults int) ([]domain.MatchedProvider, error) {
	if maxResults <= 0 {
		maxResults = defaultMaxProviders
	}

	if lat == 0 && lng == 0 {
		// Attempt to look up the job location from the database.
		jobLat, jobLng, err := s.repo.GetJobLocation(ctx, jobID)
		if err != nil {
			return nil, fmt.Errorf("find matching providers get job location: %w", err)
		}
		lat = jobLat
		lng = jobLng
	}

	if lat == 0 && lng == 0 {
		slog.Warn("skipping provider matching — job has no location",
			"job_id", jobID,
		)
		return nil, nil
	}

	providers, err := s.repo.QueryMatchingProviders(ctx, categoryID, lat, lng, defaultMatchRadius, maxResults)
	if err != nil {
		return nil, fmt.Errorf("find matching providers: %w", err)
	}

	slog.Info("provider matching complete",
		"job_id", jobID,
		"category_id", categoryID,
		"candidates_found", len(providers),
	)

	return providers, nil
}
