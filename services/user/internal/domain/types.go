package domain

import (
	"context"
	"errors"
	"net"
	"time"
)

// Sentinel errors for the user domain.
var (
	ErrUserNotFound       = errors.New("user not found")
	ErrEmailTaken         = errors.New("email already taken")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrTokenExpired       = errors.New("token expired")
	ErrTokenRevoked       = errors.New("token revoked")
	ErrAccountSuspended   = errors.New("account suspended")
	ErrAccountBanned      = errors.New("account banned")
	ErrAccountDeactivated = errors.New("account deactivated")
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
}
