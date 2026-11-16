package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// Stripe billing identity persistence (migrations 102 + 103).
//
// These methods back service.CustomerDirectory. They are deliberately NOT added
// to domain.PaymentRepository: that interface is already 60+ methods shared by
// every payment surface, and the customer/payment-method concern is used by
// three narrow call sites. The codebase already has this pattern for exactly
// this reason (service.MarketplaceRepository, service.ConnectAccountResolver) —
// a small interface declared where it is consumed, satisfied structurally by
// *PostgresRepository.

// GetUserStripeCustomerID reads users.stripe_customer_id.
//
// Returns ("", nil) when the user exists but has never been provisioned — that
// is a normal state, not an error, and the caller decides whether to provision.
// A MISSING user is an error: silently returning "" for a nonexistent id would
// let a caller provision a Stripe Customer for a user that does not exist.
func (r *PostgresRepository) GetUserStripeCustomerID(ctx context.Context, userID string) (string, error) {
	var customerID *string
	err := r.pool.QueryRow(ctx, `
		SELECT stripe_customer_id FROM users
		WHERE id = $1 AND deleted_at IS NULL`, userID).Scan(&customerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("get user stripe customer id %s: %w", userID, domain.ErrPaymentNotFound)
		}
		return "", fmt.Errorf("get user stripe customer id: %w", err)
	}
	if customerID == nil {
		return "", nil
	}
	return *customerID, nil
}

// ClaimUserStripeCustomerID atomically binds a Stripe Customer to a user, and
// returns the id that is actually bound afterwards.
//
// This is the DB half of idempotent provisioning. The UPDATE is guarded by
// `stripe_customer_id IS NULL`, so under N concurrent claims Postgres row
// locking serializes them and exactly one sees rows-affected = 1. Every loser
// gets rows-affected = 0 and is handed the WINNER's id — never its own, and
// never an error. Callers therefore always end up agreeing on one customer.
//
// The returned value is authoritative: a caller must use it and discard the
// candidate it passed in. (When the candidate loses, the Stripe Customer it
// created is a duplicate — see service.CustomerProvisioner for why the
// deterministic idempotency key makes that case essentially unreachable, and
// what happens in the residual window where it is not.)
func (r *PostgresRepository) ClaimUserStripeCustomerID(ctx context.Context, userID, customerID string) (string, error) {
	if customerID == "" {
		return "", fmt.Errorf("claim user stripe customer id: customer id required")
	}

	var claimed string
	err := r.pool.QueryRow(ctx, `
		UPDATE users
		   SET stripe_customer_id = $2, updated_at = now()
		 WHERE id = $1
		   AND deleted_at IS NULL
		   AND stripe_customer_id IS NULL
		RETURNING stripe_customer_id`, userID, customerID).Scan(&claimed)
	if err == nil {
		return claimed, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("claim user stripe customer id: %w", err)
	}

	// No row updated: either someone else won the race, or the user is gone.
	// Re-read to find out which. This is the only correct way to distinguish
	// them — rows-affected=0 alone is ambiguous.
	existing, readErr := r.GetUserStripeCustomerID(ctx, userID)
	if readErr != nil {
		return "", fmt.Errorf("claim user stripe customer id: reread after lost claim: %w", readErr)
	}
	if existing == "" {
		// The user row exists, is not deleted, and stripe_customer_id is still
		// NULL — yet the guarded UPDATE matched nothing. That is not a state the
		// schema permits. Fail closed rather than return a customer id nobody
		// has recorded.
		return "", fmt.Errorf("claim user stripe customer id: guarded update matched no row but column is still null for user %s", userID)
	}
	return existing, nil
}

// GetUserBillingIdentity returns the email and display name used to label the
// Stripe Customer, so a support agent looking at the Stripe dashboard can tell
// which person an object belongs to.
//
// users.email is plaintext by design (CLAUDE.md §6: it is the auth lookup key
// and is deliberately excluded from the secretbox PII inventory), so no
// decryption is needed here. Phone is NOT read — it IS in the encrypted
// inventory, and Stripe does not need it to hold a card.
func (r *PostgresRepository) GetUserBillingIdentity(ctx context.Context, userID string) (email, displayName string, err error) {
	err = r.pool.QueryRow(ctx, `
		SELECT email, display_name FROM users
		WHERE id = $1 AND deleted_at IS NULL`, userID).Scan(&email, &displayName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", fmt.Errorf("get user billing identity %s: %w", userID, domain.ErrPaymentNotFound)
		}
		return "", "", fmt.Errorf("get user billing identity: %w", err)
	}
	return email, displayName, nil
}

// --- Saved payment methods (migration 103) ---

// UpsertUserPaymentMethod records a saved card, keyed on the Stripe
// PaymentMethod id.
//
// Idempotent by construction: stripe_payment_method_id is UNIQUE, so a
// redelivered setup_intent.succeeded event (Stripe redelivers successful
// events) and the synchronous confirmation fast path both converge on ONE row.
// A conflict refreshes the display fields and clears deleted_at, so re-attaching
// a previously detached card revives the original row rather than inserting a
// second one.
//
// is_default is deliberately NOT written here. Defaulting is a separate,
// serialized operation (SetDefaultUserPaymentMethod) because it must clear the
// previous default in the same transaction to respect the one-default-per-user
// unique index.
func (r *PostgresRepository) UpsertUserPaymentMethod(ctx context.Context, userID, stripeCustomerID string, pm domain.PaymentMethod) error {
	if userID == "" || stripeCustomerID == "" || pm.ID == "" {
		return fmt.Errorf("upsert user payment method: user id, customer id and payment method id are required")
	}
	pmType := pm.Type
	if pmType == "" {
		pmType = "card"
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO user_payment_methods (
			user_id, stripe_payment_method_id, stripe_customer_id,
			type, brand, last_four, exp_month, exp_year
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (stripe_payment_method_id) DO UPDATE SET
			user_id            = EXCLUDED.user_id,
			stripe_customer_id = EXCLUDED.stripe_customer_id,
			type               = EXCLUDED.type,
			brand              = EXCLUDED.brand,
			last_four          = EXCLUDED.last_four,
			exp_month          = EXCLUDED.exp_month,
			exp_year           = EXCLUDED.exp_year,
			deleted_at         = NULL,
			updated_at         = now()`,
		userID, pm.ID, stripeCustomerID,
		pmType, pm.Brand, pm.LastFour, pm.ExpMonth, pm.ExpYear)
	if err != nil {
		return fmt.Errorf("upsert user payment method: %w", err)
	}
	return nil
}

// SetDefaultUserPaymentMethod makes one method the user's default and demotes
// every other one, in a single transaction.
//
// Both statements must land together: the partial unique index
// idx_user_payment_methods_one_default forbids two live defaults, so promoting
// before demoting outside a transaction would either fail or (worse, if the
// process died between them) leave the user with zero defaults and no card to
// charge off-session. The demote runs FIRST inside the transaction for the same
// reason — the index is checked per statement, not deferred.
func (r *PostgresRepository) SetDefaultUserPaymentMethod(ctx context.Context, userID, stripePaymentMethodID string) error {
	if userID == "" || stripePaymentMethodID == "" {
		return fmt.Errorf("set default user payment method: user id and payment method id are required")
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("set default user payment method: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		UPDATE user_payment_methods
		   SET is_default = false, updated_at = now()
		 WHERE user_id = $1 AND is_default AND stripe_payment_method_id <> $2`,
		userID, stripePaymentMethodID); err != nil {
		return fmt.Errorf("set default user payment method: demote previous: %w", err)
	}

	tag, err := tx.Exec(ctx, `
		UPDATE user_payment_methods
		   SET is_default = true, updated_at = now()
		 WHERE user_id = $1 AND stripe_payment_method_id = $2 AND deleted_at IS NULL`,
		userID, stripePaymentMethodID)
	if err != nil {
		return fmt.Errorf("set default user payment method: promote: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// The method is not this user's (or is soft-deleted). Refuse rather than
		// silently leave the user with no default: this is an ownership failure,
		// and treating it as success would let a caller "default" someone else's
		// card. Rolling back also restores the previous default.
		return fmt.Errorf("set default user payment method: %w", domain.ErrPaymentNotFound)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("set default user payment method: commit: %w", err)
	}
	return nil
}

// ListUserPaymentMethods returns the user's live saved methods, default first.
func (r *PostgresRepository) ListUserPaymentMethods(ctx context.Context, userID string) ([]domain.PaymentMethod, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT stripe_payment_method_id, type, brand, last_four, exp_month, exp_year, is_default
		  FROM user_payment_methods
		 WHERE user_id = $1 AND deleted_at IS NULL
		 ORDER BY is_default DESC, created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list user payment methods: %w", err)
	}
	defer rows.Close()

	methods := []domain.PaymentMethod{}
	for rows.Next() {
		var m domain.PaymentMethod
		if err := rows.Scan(&m.ID, &m.Type, &m.Brand, &m.LastFour, &m.ExpMonth, &m.ExpYear, &m.IsDefault); err != nil {
			return nil, fmt.Errorf("list user payment methods scan: %w", err)
		}
		methods = append(methods, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list user payment methods rows: %w", err)
	}
	return methods, nil
}

// GetDefaultUserPaymentMethod returns the user's default saved method.
//
// Returns ("", nil) when the user has no live default — "this buyer cannot be
// charged off-session" is a normal answer the caller must handle, not an error
// condition. Callers MUST treat the empty string as "do not charge"; that is the
// fail-closed path.
func (r *PostgresRepository) GetDefaultUserPaymentMethod(ctx context.Context, userID string) (string, error) {
	var pmID string
	err := r.pool.QueryRow(ctx, `
		SELECT stripe_payment_method_id
		  FROM user_payment_methods
		 WHERE user_id = $1 AND is_default AND deleted_at IS NULL
		 LIMIT 1`, userID).Scan(&pmID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("get default user payment method: %w", err)
	}
	return pmID, nil
}

// SoftDeleteUserPaymentMethod marks a method detached. Scoped by user_id so a
// caller can never detach a card that is not theirs.
func (r *PostgresRepository) SoftDeleteUserPaymentMethod(ctx context.Context, userID, stripePaymentMethodID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE user_payment_methods
		   SET deleted_at = now(), is_default = false, updated_at = now()
		 WHERE user_id = $1 AND stripe_payment_method_id = $2 AND deleted_at IS NULL`,
		userID, stripePaymentMethodID)
	if err != nil {
		return fmt.Errorf("soft delete user payment method: %w", err)
	}
	// No rows-affected check: detaching an already-detached method is a
	// successful no-op, and the caller has already proven ownership.
	return nil
}

// FindUserByPaymentMethodID resolves a saved method back to its owner.
//
// Needed by the payment_method.detached handler: that event carries only the
// method, so the owner has to come from our own record. Includes soft-deleted
// rows on purpose — a redelivered detach for an already-deleted method must
// still resolve, so the handler can ack it as a no-op instead of logging it as
// untracked.
func (r *PostgresRepository) FindUserByPaymentMethodID(ctx context.Context, stripePaymentMethodID string) (string, error) {
	if stripePaymentMethodID == "" {
		return "", fmt.Errorf("find user by payment method id: payment method id required")
	}
	var userID string
	err := r.pool.QueryRow(ctx, `
		SELECT user_id FROM user_payment_methods WHERE stripe_payment_method_id = $1`,
		stripePaymentMethodID).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("find user by payment method id %s: %w", stripePaymentMethodID, domain.ErrPaymentNotFound)
		}
		return "", fmt.Errorf("find user by payment method id: %w", err)
	}
	return userID, nil
}

// FindUserByStripeCustomerID resolves a Stripe Customer back to a platform user.
//
// Needed by the setup_intent.succeeded handler: the event carries the Customer,
// and we must know whose card was just saved. Guaranteed to match at most one
// user by idx_users_stripe_customer_id (migration 102).
func (r *PostgresRepository) FindUserByStripeCustomerID(ctx context.Context, stripeCustomerID string) (string, error) {
	if stripeCustomerID == "" {
		return "", fmt.Errorf("find user by stripe customer id: customer id required")
	}
	var userID string
	err := r.pool.QueryRow(ctx, `
		SELECT id FROM users WHERE stripe_customer_id = $1 AND deleted_at IS NULL`,
		stripeCustomerID).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("find user by stripe customer id %s: %w", stripeCustomerID, domain.ErrPaymentNotFound)
		}
		return "", fmt.Errorf("find user by stripe customer id: %w", err)
	}
	return userID, nil
}
