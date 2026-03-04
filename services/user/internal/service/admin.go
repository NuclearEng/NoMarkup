package service

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// Admin implements admin-related business logic.
type Admin struct {
	repo domain.UserRepository
}

// NewAdmin creates a new Admin service.
func NewAdmin(repo domain.UserRepository) *Admin {
	return &Admin{repo: repo}
}

// SuspendUser suspends a user account and revokes all their active sessions.
func (a *Admin) SuspendUser(ctx context.Context, userID, reason, adminID string) error {
	if err := a.repo.SuspendUser(ctx, userID, reason, adminID); err != nil {
		return fmt.Errorf("suspend user: %w", err)
	}

	if err := a.repo.RevokeAllUserTokens(ctx, userID); err != nil {
		slog.Warn("failed to revoke tokens after suspension",
			"user_id", userID,
			"admin_id", adminID,
			"error", err,
		)
	}

	slog.Info("user suspended",
		"user_id", userID,
		"admin_id", adminID,
		"reason", reason,
	)
	return nil
}

// BanUser bans a user account and revokes all their active sessions.
func (a *Admin) BanUser(ctx context.Context, userID, reason, adminID string) error {
	if err := a.repo.BanUser(ctx, userID, reason, adminID); err != nil {
		return fmt.Errorf("ban user: %w", err)
	}

	if err := a.repo.RevokeAllUserTokens(ctx, userID); err != nil {
		slog.Warn("failed to revoke tokens after ban",
			"user_id", userID,
			"admin_id", adminID,
			"error", err,
		)
	}

	slog.Info("user banned",
		"user_id", userID,
		"admin_id", adminID,
		"reason", reason,
	)
	return nil
}

// AdminSearchUsers searches for users with optional query and status filters.
func (a *Admin) AdminSearchUsers(ctx context.Context, query, status string, page, pageSize int) ([]domain.User, int, error) {
	users, total, err := a.repo.AdminSearchUsers(ctx, query, status, page, pageSize)
	if err != nil {
		return nil, 0, fmt.Errorf("admin search users: %w", err)
	}
	return users, total, nil
}

// AdminGetUser retrieves a user by ID for admin viewing.
func (a *Admin) AdminGetUser(ctx context.Context, userID string) (*domain.User, error) {
	user, err := a.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("admin get user: %w", err)
	}
	return user, nil
}

// InsertAuditLog records an admin action in the audit log.
func (a *Admin) InsertAuditLog(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any, ipAddress string) error {
	if err := a.repo.InsertAuditLog(ctx, adminID, action, targetType, targetID, details, ipAddress); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}
