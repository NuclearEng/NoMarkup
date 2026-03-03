package domain

import (
	"context"
	"time"
)

// Job represents a service job posting.
type Job struct {
	ID                 string
	CustomerID         string
	PropertyID         string
	Title              string
	Description        string
	CategoryID         string
	SubcategoryID      string
	Status             string
	StartingBidCents   int64
	OfferAcceptedCents int64
	AuctionEndsAt      time.Time
	BidCount           int32
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// JobRepository defines persistence operations for jobs.
type JobRepository interface {
	FindByID(ctx context.Context, id string) (*Job, error)
	Create(ctx context.Context, job *Job) error
	Update(ctx context.Context, job *Job) error
	Search(ctx context.Context, filter SearchFilter) ([]*Job, int, error)
}

// SearchFilter defines job search parameters.
type SearchFilter struct {
	CategoryIDs []string
	Latitude    float64
	Longitude   float64
	RadiusKm    float64
	TextQuery   string
	Page        int
	PageSize    int
}
