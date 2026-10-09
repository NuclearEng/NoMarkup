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

// SuspendUser suspends a user account and revokes all their active sessions
// atomically. Either both succeed or neither — there is no state where the
// user is suspended but their refresh tokens still authenticate.
func (a *Admin) SuspendUser(ctx context.Context, userID, reason, adminID string) error {
	if err := a.repo.SuspendUserAndRevokeTokens(ctx, userID, reason, adminID); err != nil {
		slog.Error("suspend user failed",
			"user_id", userID,
			"admin_id", adminID,
			"error", err,
		)
		return fmt.Errorf("suspend user: %w", err)
	}

	slog.Info("user suspended",
		"user_id", userID,
		"admin_id", adminID,
		"reason", reason,
	)
	return nil
}

// BanUser bans a user account and revokes all their active sessions atomically.
// Either both succeed or neither.
func (a *Admin) BanUser(ctx context.Context, userID, reason, adminID string) error {
	if err := a.repo.BanUserAndRevokeTokens(ctx, userID, reason, adminID); err != nil {
		slog.Error("ban user failed",
			"user_id", userID,
			"admin_id", adminID,
			"error", err,
		)
		return fmt.Errorf("ban user: %w", err)
	}

	slog.Info("user banned",
		"user_id", userID,
		"admin_id", adminID,
		"reason", reason,
	)
	return nil
}

// ReactivateUser flips a previously-suspended (or banned/deactivated) user
// back to status='active' and clears the suspension reason. Existing refresh
// tokens stay revoked — the user will need to log in again, which is the
// expected behaviour. Used as the counterpart to SuspendUser.
func (a *Admin) ReactivateUser(ctx context.Context, userID, adminID string) error {
	if err := a.repo.ReactivateUser(ctx, userID, adminID); err != nil {
		slog.Error("reactivate user failed",
			"user_id", userID,
			"admin_id", adminID,
			"error", err,
		)
		return fmt.Errorf("reactivate user: %w", err)
	}

	slog.Info("user reactivated",
		"user_id", userID,
		"admin_id", adminID,
	)
	return nil
}

// AdminSearchUsers searches for users with optional query, status, and role filters.
func (a *Admin) AdminSearchUsers(ctx context.Context, query, status, role string, page, pageSize int) ([]domain.User, int, error) {
	users, total, err := a.repo.AdminSearchUsers(ctx, query, status, role, page, pageSize)
	if err != nil {
		return nil, 0, fmt.Errorf("admin search users: %w", err)
	}
	return users, total, nil
}

// AdminListPendingDocuments returns verification documents awaiting review,
// oldest first, paginated.
func (a *Admin) AdminListPendingDocuments(ctx context.Context, page, pageSize int) ([]domain.PendingDocument, int, error) {
	docs, total, err := a.repo.ListPendingDocuments(ctx, page, pageSize)
	if err != nil {
		return nil, 0, fmt.Errorf("admin list pending documents: %w", err)
	}
	return docs, total, nil
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
