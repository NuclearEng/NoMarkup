package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// GetDefaultPlatformBankAccount returns the current default (non-deleted)
// platform bank account, or (nil, nil) if none is configured.
func (r *PostgresRepository) GetDefaultPlatformBankAccount(ctx context.Context) (*domain.PlatformBankAccount, error) {
	acct := &domain.PlatformBankAccount{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, stripe_external_account_id, bank_name, account_holder_name,
		       account_holder_type, last4, routing_last4, currency, country,
		       status, is_default, set_by_admin_id, deleted_at, created_at, updated_at
		FROM platform_bank_account
		WHERE is_default = true AND deleted_at IS NULL
		LIMIT 1`).Scan(
		&acct.ID, &acct.StripeExternalAccountID, &acct.BankName, &acct.AccountHolderName,
		&acct.AccountHolderType, &acct.Last4, &acct.RoutingLast4, &acct.Currency, &acct.Country,
		&acct.Status, &acct.IsDefault, &acct.SetByAdminID, &acct.DeletedAt, &acct.CreatedAt, &acct.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get default platform bank account: %w", err)
	}
	return acct, nil
}

// InsertPlatformBankAccount inserts a new platform bank account row. If the new
// account is the default, the previous default is unset within the same
// transaction so the partial unique index is never violated.
func (r *PostgresRepository) InsertPlatformBankAccount(ctx context.Context, acct *domain.PlatformBankAccount) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("insert platform bank account begin: %w", err)
	}
	defer tx.Rollback(ctx)

	if acct.IsDefault {
		// Soft-delete the prior default so the partial unique index allows the
		// new default. The prior account no longer represents where the platform
		// balance pays out, so it is retired.
		if _, err := tx.Exec(ctx, `
			UPDATE platform_bank_account
			SET is_default = false, deleted_at = now(), updated_at = now()
			WHERE is_default = true AND deleted_at IS NULL`); err != nil {
			return fmt.Errorf("insert platform bank account unset previous default: %w", err)
		}
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO platform_bank_account (
			stripe_external_account_id, bank_name, account_holder_name,
			account_holder_type, last4, routing_last4, currency, country,
			status, is_default, set_by_admin_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at, updated_at`,
		acct.StripeExternalAccountID, acct.BankName, acct.AccountHolderName,
		acct.AccountHolderType, acct.Last4, acct.RoutingLast4, acct.Currency, acct.Country,
		acct.Status, acct.IsDefault, acct.SetByAdminID).Scan(
		&acct.ID, &acct.CreatedAt, &acct.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert platform bank account: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("insert platform bank account commit: %w", err)
	}
	return nil
}

// SoftDeletePlatformBankAccount marks a platform bank account as deleted and
// clears its default flag.
func (r *PostgresRepository) SoftDeletePlatformBankAccount(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE platform_bank_account
		SET is_default = false, deleted_at = now(), updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("soft delete platform bank account: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("soft delete platform bank account: %w", domain.ErrPlatformBankAccountNotFound)
	}
	return nil
}
