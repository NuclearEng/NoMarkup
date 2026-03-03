package domain

import (
	"context"
	"time"
)

// User represents a platform user.
type User struct {
	ID            string
	Email         string
	DisplayName   string
	Phone         string
	AvatarURL     string
	Roles         []string
	Status        string
	EmailVerified bool
	PhoneVerified bool
	MFAEnabled    bool
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// UserRepository defines persistence operations for users.
type UserRepository interface {
	FindByID(ctx context.Context, id string) (*User, error)
	FindByEmail(ctx context.Context, email string) (*User, error)
	Create(ctx context.Context, user *User) error
	Update(ctx context.Context, user *User) error
}
