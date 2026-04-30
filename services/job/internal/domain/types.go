package domain

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors for the job domain.
var (
	ErrJobNotFound         = errors.New("job not found")
	ErrNotDraft            = errors.New("job is not a draft")
	ErrNotActive           = errors.New("job is not active")
	ErrNotOwner            = errors.New("not the job owner")
	ErrInvalidStatus       = errors.New("invalid status transition")
	ErrCategoryNotFound    = errors.New("category not found")
	ErrPropertyNotFound    = errors.New("property not found")
	ErrMarketRangeNotFound = errors.New("market range not found")
	ErrMissingTitle        = errors.New("title is required")
	ErrMissingDescription  = errors.New("description is required")
	ErrMissingCategory     = errors.New("category is required")
	ErrInvalidDuration     = errors.New("auction duration must be between 1 and 168 hours")
	ErrDraftLimitExceeded  = errors.New("maximum of 10 draft jobs allowed")
	ErrNotRepostable       = errors.New("job must be in closed or expired status to repost")
	ErrNotAwarded          = errors.New("job is not in awarded status")
	ErrNotCompleted        = errors.New("job is not in completed status")
)

// Job represents a service job posting.
type Job struct {
	ID                   string
	CustomerID           string
	PropertyID           string
	Title                string
	Description          string
	CategoryID           string
	SubcategoryID        string
	ServiceTypeID        string
	ServiceAddress       string
	ServiceCity          string
	ServiceState         string
	ServiceZip           string
	ScheduleType         string
	ScheduledDate        *time.Time
	ScheduleRangeStart   *time.Time
	ScheduleRangeEnd     *time.Time
	IsRecurring          bool
	RecurrenceFrequency  *string
	StartingBidCents     *int64
	OfferAcceptedCents   *int64
	AuctionDurationHours int
	AuctionEndsAt        *time.Time
	MinProviderRating    *float64
	Status               string
	BidCount             int
	AwardedProviderID    *string
	AwardedBidID         *string
	RepostedFromID       *string
	RepostCount          int
	AuctionType          string
	SnipeExtensionCount  int32
	OriginalAuctionEndsAt *time.Time
	AwardedAt            *time.Time
	ClosedAt             *time.Time
	CompletedAt          *time.Time
	CancelledAt          *time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
	DeletedAt            *time.Time

	// Wave 5 services-polish (migration 046).
	// IsHourly toggles flat-rate vs. hourly billing on the job posting.
	// HourlyRateCents is set when IsHourly=true (nil otherwise).
	// SameDayRequested is the Thumbtack-style "I need this today" SLA flag —
	// downstream matcher prioritizes providers with same_day_available=true.
	IsHourly         bool
	HourlyRateCents  *int64
	SameDayRequested bool

	// Populated via JOINs
	Photos      []JobPhoto
	Category    *ServiceCategory
	Subcategory *ServiceCategory
	ServiceType *ServiceCategory
	MarketRange *MarketRange
}

// JobPhoto represents a photo attached to a job.
type JobPhoto struct {
	ID        string
	JobID     string
	ImageURL  string
	SortOrder int
	CreatedAt time.Time
}

// ServiceCategory represents a service category.
type ServiceCategory struct {
	ID          string
	ParentID    *string
	Name        string
	Slug        string
	Level       int
	Description string
	Icon        string
	SortOrder   int
	Active      bool
	ParentName  string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// MarketRange represents a market price range for a service type in a zip code.
type MarketRange struct {
	ID            string
	ServiceTypeID string
	ZipCode       string
	City          string
	State         string
	LowCents      int64
	MedianCents   int64
	HighCents     int64
	DataPoints    int
	Source        string
	Confidence    float64
	Season        *string
	ComputedAt    time.Time
	ValidUntil    time.Time
}

// CreateJobInput holds the data needed to create a new job.
type CreateJobInput struct {
	CustomerID           string
	PropertyID           string
	Title                string
	Description          string
	CategoryID           string
	SubcategoryID        string
	ServiceTypeID        string
	ScheduleType         string
	ScheduledDate        *time.Time
	ScheduleRangeStart   *time.Time
	ScheduleRangeEnd     *time.Time
	IsRecurring          bool
	RecurrenceFrequency  *string
	StartingBidCents     *int64
	OfferAcceptedCents   *int64
	AuctionDurationHours int
	MinProviderRating    *float64
	PhotoURLs            []string
	TagCategoryIDs       []string
	Publish              bool
	AuctionType          string
	LocationAddress      string
	LocationLat          *float64
	LocationLng          *float64

	// Wave 5 services-polish (migration 046).
	IsHourly         bool
	HourlyRateCents  *int64
	SameDayRequested bool
}

// UpdateJobInput holds optional fields for updating a draft job.
type UpdateJobInput struct {
	Title                *string
	Description          *string
	CategoryID           *string
	SubcategoryID        *string
	ServiceTypeID        *string
	ScheduleType         *string
	StartingBidCents     *int64
	OfferAcceptedCents   *int64
	AuctionDurationHours *int
	PhotoURLs            []string // nil means don't change, empty means clear

	// Wave 5 services-polish (migration 046).
	IsHourly         *bool
	HourlyRateCents  *int64
	SameDayRequested *bool
}

// SearchJobsInput defines job search parameters.
type SearchJobsInput struct {
	CategoryIDs   []string
	Latitude      float64
	Longitude     float64
	RadiusKm      float64
	MinPriceCents *int64
	MaxPriceCents *int64
	ScheduleType  *string
	RecurringOnly *bool
	TextQuery     string
	SortField     string
	SortDesc      bool
	Page          int
	PageSize      int
}

// Pagination holds pagination metadata.
type Pagination struct {
	TotalCount int
	Page       int
	PageSize   int
	TotalPages int
	HasNext    bool
}

// JobMapPin represents a lightweight job pin for map display.
type JobMapPin struct {
	JobID            string
	Latitude         float64
	Longitude        float64
	Title            string
	CategoryName     string
	StartingBidCents *int64
	BidCount         int
	AuctionEndsAt    *time.Time
}

// GetJobsOnMapInput defines parameters for retrieving map pins.
type GetJobsOnMapInput struct {
	Latitude      float64
	Longitude     float64
	RadiusKm      float64
	CategoryIDs   []string
	MaxPriceCents *int64
}

// MatchedProvider represents a provider matched to a job by the pre-matching engine.
type MatchedProvider struct {
	ProviderID    string
	DisplayName   string
	TrustScore    float64
	TrustTier     string
	DistanceKm    float64
	WinRate       float64
	AvgResponseMin int
	MatchScore    float64
}

// MatchingRepository defines persistence operations for provider matching.
type MatchingRepository interface {
	QueryMatchingProviders(ctx context.Context, categoryID string, lat, lng float64, radiusMeters float64, limit int) ([]MatchedProvider, error)
	GetJobLocation(ctx context.Context, jobID string) (lat, lng float64, err error)
}

// JobRepository defines persistence operations for jobs.
type JobRepository interface {
	CreateJob(ctx context.Context, input CreateJobInput) (*Job, error)
	UpdateJob(ctx context.Context, jobID string, customerID string, input UpdateJobInput) (*Job, error)
	GetJob(ctx context.Context, jobID string) (*Job, error)
	GetJobDetail(ctx context.Context, jobID string, requestingUserID string) (*Job, error)
	DeleteDraft(ctx context.Context, jobID string, customerID string) error
	PublishJob(ctx context.Context, jobID string, customerID string) (*Job, error)
	CloseAuction(ctx context.Context, jobID string, customerID string) (*Job, error)
	CancelJob(ctx context.Context, jobID string, customerID string) (*Job, error)
	SearchJobs(ctx context.Context, input SearchJobsInput) ([]*Job, *Pagination, error)
	GetJobsOnMap(ctx context.Context, input GetJobsOnMapInput) ([]JobMapPin, error)
	ListCustomerJobs(ctx context.Context, customerID string, statusFilter *string, propertyID *string, page, pageSize int) ([]*Job, *Pagination, error)
	ListDrafts(ctx context.Context, customerID string) ([]*Job, error)
	ListServiceCategories(ctx context.Context, level *int, parentID *string) ([]ServiceCategory, error)
	GetCategoryTree(ctx context.Context) ([]ServiceCategory, error)
	LookupMarketRange(ctx context.Context, serviceTypeID string, zipCode string) (*MarketRange, error)

	// Draft limit
	CountDrafts(ctx context.Context, customerID string) (int, error)

	// Repost
	RepostJob(ctx context.Context, originalJobID string, input CreateJobInput) (*Job, error)
	IncrementRepostCount(ctx context.Context, jobID string) error

	// Lifecycle transitions
	AwardJob(ctx context.Context, jobID, customerID, providerID, bidID string) (*Job, error)
	MarkReviewed(ctx context.Context, jobID string) (*Job, error)

	// Admin operations
	AdminListJobs(ctx context.Context, statusFilter *string, categoryID *string, customerID *string, page, pageSize int) ([]*Job, *Pagination, error)
	AdminSuspendJob(ctx context.Context, jobID, reason string) error
	AdminRemoveJob(ctx context.Context, jobID, reason string) error
	InsertAuditLog(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any) error
}
