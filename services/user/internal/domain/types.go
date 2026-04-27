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
	ErrInvalidToken            = errors.New("invalid or expired verification token")
	ErrInvalidOTP              = errors.New("invalid OTP code")
	ErrOTPExpired              = errors.New("OTP code expired")
	ErrDocumentNotFound        = errors.New("document not found")
	ErrInvalidMFACode          = errors.New("invalid MFA code")
	ErrMFANotSetup             = errors.New("MFA not set up")
	ErrMFAAlreadyEnabled       = errors.New("MFA already enabled")
	ErrInvalidMFAChallengeToken = errors.New("invalid or expired MFA challenge token")
	ErrEmailNotVerified         = errors.New("email not verified")
	ErrPropertyNotFound         = errors.New("property not found")

	// GDPR / CCPA erasure pipeline.
	ErrDeletionAlreadyRequested = errors.New("account deletion already requested")
	ErrDeletionNotRequested     = errors.New("account deletion not requested")
	ErrDeletionAlreadyFinalized = errors.New("account deletion already finalized")
	ErrDeletionGracePeriodActive = errors.New("account deletion grace period still active")
	ErrDeletionConfirmation     = errors.New("deletion confirmation phrase invalid")
)

// DeletionGracePeriod is the window between a user requesting account
// deletion and the cron finalizing it. Aligns with GDPR Article 17 (30 days)
// and CCPA's 45-day default. Picking the shorter of the two is the safer
// regulator-facing choice.
const DeletionGracePeriod = 30 * 24 * time.Hour

// DeletionConfirmationPhrase is the literal string the client must echo when
// requesting deletion. The frontend renders this in the confirmation dialog
// so the action cannot be triggered by an accidental click.
const DeletionConfirmationPhrase = "DELETE"

// PendingDeletion summarises a user that has an unfinalized deletion request.
// Used by the cron worker to materialize the work queue.
type PendingDeletion struct {
	UserID              string
	Email               string
	StripeCustomerID    string
	StripeAccountID     string
	DeletionRequestedAt time.Time
}

// ErasureCounts holds per-table row anonymization counts so the audit log
// can record exactly what was wiped during a finalize call.
type ErasureCounts map[string]int64

// FinalizeOutcome captures everything the cascade did so it can be both
// returned over gRPC and written into the admin_audit_log payload.
type FinalizeOutcome struct {
	UserID                string
	FinalizedAt           time.Time
	Counts                ErasureCounts
	StripeCustomerOutcome string
	StripeAccountOutcome  string
}

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

// OAuthAccount represents a linked OAuth provider account.
type OAuthAccount struct {
	ID         string
	UserID     string
	Provider   string
	ProviderID string
	Email      string
	CreatedAt  time.Time
}

// OAuthInput holds the data needed to find or create a user via OAuth.
type OAuthInput struct {
	Provider   string
	ProviderID string
	Email      string
	Name       string
	AvatarURL  string
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

	// Populated via JOINs or external calls
	Categories      []ServiceCategory
	PortfolioImages []PortfolioImage
	TrustScore      *TrustScore
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

// TrustScore holds the trust score summary for a provider.
type TrustScore struct {
	OverallScore  float64
	Tier          string
	FeedbackScore float64
	VolumeScore   float64
	RiskScore     float64
	FraudScore    float64
}

// ProviderSearchInput holds the parameters for searching providers.
type ProviderSearchInput struct {
	CategoryIDs      []string
	Latitude         *float64
	Longitude        *float64
	RadiusKm         float64
	MinRating        *float64
	MinTrustTier     *string
	VerifiedOnly     *bool
	InstantAvailable *bool
	SortField        string
	SortDirection    string // "asc" or "desc"
	Page             int
	PageSize         int
}

// ProviderSearchResult holds a single result from a provider search.
type ProviderSearchResult struct {
	UserID           string
	DisplayName      string
	BusinessName     string
	AvatarURL        string
	DistanceKm       float64
	AverageRating    float64
	ReviewCount      int
	OnTimeRate       float64
	TrustScore       *TrustScore
	Badges           []VerificationBadge
	Categories       []ServiceCategory
	InstantAvailable bool
}

// VerificationBadge represents a verification badge for a provider.
type VerificationBadge struct {
	DocumentType string
	Status       string
	VerifiedAt   *time.Time
	ExpiresAt    *time.Time
}

// DocumentType represents a type of verification document.
type DocumentType string

const (
	DocDriversLicense  DocumentType = "drivers_license"
	DocBusinessLicense DocumentType = "business_license"
	DocEIN             DocumentType = "ein"
	DocInsurance       DocumentType = "insurance"
	DocTradeLicense    DocumentType = "trade_license"
)

// DocumentStatus represents the verification status of a document.
type DocumentStatus string

const (
	DocStatusNotUploaded DocumentStatus = "not_uploaded"
	DocStatusPending     DocumentStatus = "pending"
	DocStatusVerified    DocumentStatus = "verified"
	DocStatusRejected    DocumentStatus = "rejected"
)

// Document represents a verification document uploaded by a provider.
type Document struct {
	ID              string
	UserID          string
	Type            DocumentType
	Status          DocumentStatus
	FileName        string
	StorageURL      string
	RejectionReason string
	ExpiresAt       *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Property represents a customer's physical property (e.g., home address).
type Property struct {
	ID        string
	UserID    string
	Nickname  string
	Address   string
	City      string
	State     string
	ZipCode   string
	Latitude  float64
	Longitude float64
	Notes     string
	IsPrimary bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

// CreatePropertyInput holds the data needed to create a new property.
type CreatePropertyInput struct {
	UserID    string
	Nickname  string
	Address   string
	City      string
	State     string
	ZipCode   string
	Latitude  float64
	Longitude float64
	Notes     string
	IsPrimary bool
}

// UpdatePropertyInput holds optional fields for updating a property.
type UpdatePropertyInput struct {
	Nickname  *string
	Notes     *string
	IsPrimary *bool
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

	// Phone verification
	UpdatePhoneVerified(ctx context.Context, userID string, verified bool) error

	// Document verification
	CreateDocument(ctx context.Context, doc *Document) error
	GetDocument(ctx context.Context, documentID string) (*Document, error)
	GetDocumentByUserAndType(ctx context.Context, userID string, docType DocumentType) (*Document, error)
	ListDocuments(ctx context.Context, userID string) ([]Document, error)
	UpdateDocumentStatus(ctx context.Context, documentID string, status DocumentStatus, rejectionReason string) error

	// OAuth
	FindUserByOAuth(ctx context.Context, provider, providerID string) (*User, error)
	CreateOAuthUser(ctx context.Context, user *User, provider, providerID string) error
	LinkOAuthAccount(ctx context.Context, userID, provider, providerID, email string) error

	// MFA
	StoreMFASecret(ctx context.Context, userID, encryptedSecret string) error
	GetMFASecret(ctx context.Context, userID string) (string, error)
	EnableMFA(ctx context.Context, userID string, hashedBackupCodes []string) error
	DisableMFA(ctx context.Context, userID string) error
	IsMFAEnabled(ctx context.Context, userID string) (bool, error)

	// Admin operations
	SuspendUser(ctx context.Context, userID, reason, adminID string) error
	BanUser(ctx context.Context, userID, reason, adminID string) error
	// SuspendUserAndRevokeTokens performs both operations in a single
	// transaction. Either both succeed or neither — there is no state where
	// the user is suspended but their refresh tokens are still valid.
	SuspendUserAndRevokeTokens(ctx context.Context, userID, reason, adminID string) error
	// BanUserAndRevokeTokens performs both operations in a single
	// transaction. Either both succeed or neither.
	BanUserAndRevokeTokens(ctx context.Context, userID, reason, adminID string) error
	// ReactivateUser flips a suspended/banned/deactivated user back to
	// active and clears the suspension reason. No-op if already active.
	ReactivateUser(ctx context.Context, userID, adminID string) error
	InsertAuditLog(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any, ipAddress string) error
	AdminSearchUsers(ctx context.Context, query, status string, page, pageSize int) ([]User, int, error)

	// Provider search
	SearchProviders(ctx context.Context, input ProviderSearchInput) ([]ProviderSearchResult, int, error)

	// Property operations
	CreateProperty(ctx context.Context, input CreatePropertyInput) (*Property, error)
	ListProperties(ctx context.Context, userID string) ([]Property, error)
	UpdateProperty(ctx context.Context, propertyID string, input UpdatePropertyInput) (*Property, error)
	DeleteProperty(ctx context.Context, propertyID string) error

	// GDPR / CCPA erasure pipeline.
	// MarkDeletionRequested records that the user has asked for erasure,
	// returns ErrDeletionAlreadyRequested if there's already an unfinalized
	// request, and ErrDeletionAlreadyFinalized if the user has already been
	// finalized.
	MarkDeletionRequested(ctx context.Context, userID, reason string, requestedAt time.Time) error
	// ClearDeletionRequest removes a pending request (within grace period).
	// Returns ErrDeletionNotRequested when nothing was pending and
	// ErrDeletionAlreadyFinalized once finalize has run.
	ClearDeletionRequest(ctx context.Context, userID string) error
	// GetUserDeletionState returns the timestamps for a user — needed by
	// admin tooling and the lifecycle service. Returns ErrUserNotFound
	// if the user does not exist.
	GetUserDeletionState(ctx context.Context, userID string) (requestedAt, finalizedAt *time.Time, err error)
	// ListPendingFinalizations returns rows whose grace period has expired
	// and have not yet been finalized. The cron worker drains this queue.
	ListPendingFinalizations(ctx context.Context, olderThan time.Time, limit int) ([]PendingDeletion, error)
	// FinalizeAccountDeletion runs the full anonymization cascade in a
	// single transaction. Returns the per-table counts; idempotent
	// (returns ErrDeletionAlreadyFinalized on a second call).
	FinalizeAccountDeletion(ctx context.Context, userID string) (ErasureCounts, error)
}
