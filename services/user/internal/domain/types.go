package domain

import (
	"context"
	"errors"
	"net"
	"time"
)

// Sentinel errors for the user domain.
var (
	ErrUserNotFound            = errors.New("user not found")
	ErrEmailTaken              = errors.New("email already taken")
	ErrInvalidCredentials      = errors.New("invalid credentials")
	ErrTokenExpired            = errors.New("token expired")
	ErrTokenRevoked            = errors.New("token revoked")
	ErrAccountSuspended        = errors.New("account suspended")
	ErrAccountBanned           = errors.New("account banned")
	ErrAccountDeactivated      = errors.New("account deactivated")
	ErrProviderProfileNotFound = errors.New("provider profile not found")
	ErrInvalidRole             = errors.New("invalid role")
	ErrCategoryNotFound        = errors.New("category not found")
)

// User represents a platform user.
type User struct {
	ID               string
	Email            string
	EmailVerified    bool
	PasswordHash     string
	Phone            string
	PhoneVerified    bool
	DisplayName      string
	AvatarURL        string
	Roles            []string
	Status           string
	SuspensionReason string
	MFAEnabled       bool
	MFASecret        string
	MFABackupCodes   []string
	LastLoginAt      *time.Time
	LastActiveAt     *time.Time
	Timezone         string
	CreatedAt        time.Time
	UpdatedAt        time.Time
	DeletedAt        *time.Time
}

// RefreshToken represents a stored refresh token.
type RefreshToken struct {
	ID         string
	UserID     string
	TokenHash  string
	DeviceInfo string
	IPAddress  net.IP
	ExpiresAt  time.Time
	RevokedAt  *time.Time
	CreatedAt  time.Time
}

// RegisterInput holds the data needed to register a new user.
type RegisterInput struct {
	Email       string
	Password    string
	DisplayName string
	Roles       []string
}

// LoginInput holds the data needed to authenticate a user.
type LoginInput struct {
	Email      string
	Password   string
	DeviceInfo string
	IPAddress  string
}

// TokenPair holds an access token and refresh token pair.
type TokenPair struct {
	AccessToken          string
	RefreshToken         string
	AccessTokenExpiresAt time.Time
}

// ProviderProfile represents a provider's profile.
type ProviderProfile struct {
	ID                       string
	UserID                   string
	BusinessName             string
	Bio                      string
	ServiceAddress           string
	Latitude                 *float64
	Longitude                *float64
	ServiceRadiusKm          float64
	DefaultPaymentTiming     string
	DefaultMilestoneJSON     []byte
	CancellationPolicy       string
	WarrantyTerms            string
	InstantEnabled           bool
	InstantSchedule          []byte
	InstantAvailable         bool
	JobsCompleted            int
	AvgResponseTimeMinutes   *int
	OnTimeRate               *float64
	ProfileCompleteness      int
	StripeAccountID          string
	StripeOnboardingComplete bool
	CreatedAt                time.Time
	UpdatedAt                time.Time

	// Populated via JOINs
	Categories     []ServiceCategory
	PortfolioImages []PortfolioImage
}

// PortfolioImage represents a provider portfolio image.
type PortfolioImage struct {
	ID         string
	ProviderID string
	ImageURL   string
	Caption    string
	SortOrder  int
	CreatedAt  time.Time
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

// UpdateUserInput holds optional fields for updating a user profile.
type UpdateUserInput struct {
	DisplayName *string
	Phone       *string
	AvatarURL   *string
	Timezone    *string
}

// UpdateProviderInput holds optional fields for updating a provider profile.
type UpdateProviderInput struct {
	BusinessName    *string
	Bio             *string
	ServiceAddress  *string
	Latitude        *float64
	Longitude       *float64
	ServiceRadiusKm *float64
}

// GlobalTermsInput holds provider global terms settings.
type GlobalTermsInput struct {
	PaymentTiming      string
	Milestones         []MilestoneTemplate
	CancellationPolicy string
	WarrantyTerms      string
}

// MilestoneTemplate represents a milestone within a payment schedule.
type MilestoneTemplate struct {
	Description string
	Percentage  int
}

// AvailabilityInput holds instant availability settings.
type AvailabilityInput struct {
	Enabled      bool
	AvailableNow bool
	Schedule     []byte
}

// UserRepository defines persistence operations for users.
type UserRepository interface {
	CreateUser(ctx context.Context, user *User) error
	GetUserByID(ctx context.Context, id string) (*User, error)
	GetUserByEmail(ctx context.Context, email string) (*User, error)
	UpdateLastLogin(ctx context.Context, userID string, at time.Time) error
	UpdateEmailVerified(ctx context.Context, userID string, verified bool) error

	CreateRefreshToken(ctx context.Context, token *RefreshToken) error
	GetRefreshToken(ctx context.Context, tokenHash string) (*RefreshToken, error)
	RevokeRefreshToken(ctx context.Context, tokenHash string) error
	RevokeAllUserTokens(ctx context.Context, userID string) error

	UpdateUser(ctx context.Context, userID string, input UpdateUserInput) (*User, error)
	EnableRole(ctx context.Context, userID string, role string) (*User, error)

	CreateProviderProfile(ctx context.Context, userID string) (*ProviderProfile, error)
	GetProviderProfile(ctx context.Context, userID string) (*ProviderProfile, error)
	UpdateProviderProfile(ctx context.Context, userID string, input UpdateProviderInput) (*ProviderProfile, error)
	SetGlobalTerms(ctx context.Context, userID string, input GlobalTermsInput) error
	UpdateServiceCategories(ctx context.Context, providerID string, categoryIDs []string) error
	UpdatePortfolio(ctx context.Context, providerID string, images []PortfolioImage) error
	SetInstantAvailability(ctx context.Context, userID string, input AvailabilityInput) error
	GetProviderIDByUserID(ctx context.Context, userID string) (string, error)
	GetServiceCategories(ctx context.Context, providerID string) ([]ServiceCategory, error)
	GetPortfolioImages(ctx context.Context, providerID string) ([]PortfolioImage, error)
	ListServiceCategories(ctx context.Context, level *int, parentID *string) ([]ServiceCategory, error)
	GetCategoryTree(ctx context.Context) ([]ServiceCategory, error)

	// Admin operations
	SuspendUser(ctx context.Context, userID, reason, adminID string) error
	BanUser(ctx context.Context, userID, reason, adminID string) error
	InsertAuditLog(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any, ipAddress string) error
	AdminSearchUsers(ctx context.Context, query, status string, page, pageSize int) ([]User, int, error)
}
