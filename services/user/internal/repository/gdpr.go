package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// MarkDeletionRequested records a user's GDPR/CCPA erasure request.
//
// Idempotency rules:
//   - First call: sets deletion_requested_at and deletion_reason, returns nil.
//   - Same user re-requests while pending: returns ErrDeletionAlreadyRequested
//     so the caller can fall back to "request already on file" UX.
//   - User has already been finalized: returns ErrDeletionAlreadyFinalized.
//
// We deliberately do NOT change users.status here — the user can still log in
// during the grace window (so they can rescind). Login rejection only happens
// after FinalizeAccountDeletion runs and overwrites status to 'deactivated'.
func (r *PostgresRepository) MarkDeletionRequested(ctx context.Context, userID, reason string, requestedAt time.Time) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("mark deletion requested: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var existingRequested, existingFinalized *time.Time
	err = tx.QueryRow(ctx, `
		SELECT deletion_requested_at, deletion_finalized_at
		  FROM users
		 WHERE id = $1`, userID).Scan(&existingRequested, &existingFinalized)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("mark deletion requested: %w", domain.ErrUserNotFound)
		}
		return fmt.Errorf("mark deletion requested: read existing: %w", err)
	}

	if existingFinalized != nil {
		return fmt.Errorf("mark deletion requested: %w", domain.ErrDeletionAlreadyFinalized)
	}
	if existingRequested != nil {
		return fmt.Errorf("mark deletion requested: %w", domain.ErrDeletionAlreadyRequested)
	}

	tag, err := tx.Exec(ctx, `
		UPDATE users
		   SET deletion_requested_at = $2,
		       deletion_reason       = NULLIF($3, ''),
		       updated_at            = now()
		 WHERE id = $1
		   AND deletion_requested_at IS NULL
		   AND deletion_finalized_at IS NULL`, userID, requestedAt, reason)
	if err != nil {
		return fmt.Errorf("mark deletion requested: update: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Lost the race to another caller — surface the same error the
		// up-front read would have produced.
		return fmt.Errorf("mark deletion requested: %w", domain.ErrDeletionAlreadyRequested)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("mark deletion requested: commit: %w", err)
	}
	return nil
}

// ClearDeletionRequest reverses a pending deletion request within the grace
// window. Returns ErrDeletionNotRequested if nothing was pending and
// ErrDeletionAlreadyFinalized once the cascade has run (irrecoverable).
func (r *PostgresRepository) ClearDeletionRequest(ctx context.Context, userID string) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("clear deletion request: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var requested, finalized *time.Time
	err = tx.QueryRow(ctx, `
		SELECT deletion_requested_at, deletion_finalized_at
		  FROM users
		 WHERE id = $1`, userID).Scan(&requested, &finalized)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("clear deletion request: %w", domain.ErrUserNotFound)
		}
		return fmt.Errorf("clear deletion request: %w", err)
	}

	if finalized != nil {
		return fmt.Errorf("clear deletion request: %w", domain.ErrDeletionAlreadyFinalized)
	}
	if requested == nil {
		return fmt.Errorf("clear deletion request: %w", domain.ErrDeletionNotRequested)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE users
		   SET deletion_requested_at = NULL,
		       deletion_reason       = NULL,
		       updated_at            = now()
		 WHERE id = $1`, userID); err != nil {
		return fmt.Errorf("clear deletion request: update: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("clear deletion request: commit: %w", err)
	}
	return nil
}

// GetUserDeletionState returns the deletion lifecycle timestamps for a user.
func (r *PostgresRepository) GetUserDeletionState(ctx context.Context, userID string) (*time.Time, *time.Time, error) {
	var requested, finalized *time.Time
	err := r.pool.QueryRow(ctx, `
		SELECT deletion_requested_at, deletion_finalized_at
		  FROM users
		 WHERE id = $1`, userID).Scan(&requested, &finalized)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, fmt.Errorf("get deletion state: %w", domain.ErrUserNotFound)
		}
		return nil, nil, fmt.Errorf("get deletion state: %w", err)
	}
	return requested, finalized, nil
}

// ListPendingFinalizations returns users whose grace window has elapsed and
// have not yet been finalized. Reads stripe IDs in the same query so the
// cron worker can call out to Stripe before holding a database transaction.
//
// olderThan should be `now() - DeletionGracePeriod` from the caller. Limit
// caps the batch size — pick something modest so a stuck Stripe call cannot
// stall the entire queue.
func (r *PostgresRepository) ListPendingFinalizations(ctx context.Context, olderThan time.Time, limit int) ([]domain.PendingDeletion, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := r.pool.Query(ctx, `
		SELECT u.id,
		       u.email,
		       COALESCE(s.stripe_customer_id, ''),
		       COALESCE(pp.stripe_account_id, ''),
		       u.deletion_requested_at
		  FROM users u
		  LEFT JOIN provider_profiles pp ON pp.user_id = u.id
		  LEFT JOIN LATERAL (
		      SELECT stripe_customer_id
		        FROM subscriptions
		       WHERE user_id = u.id AND stripe_customer_id IS NOT NULL
		       ORDER BY created_at DESC
		       LIMIT 1
		  ) s ON true
		 WHERE u.deletion_requested_at IS NOT NULL
		   AND u.deletion_finalized_at IS NULL
		   AND u.deletion_requested_at < $1
		 ORDER BY u.deletion_requested_at ASC
		 LIMIT $2`, olderThan, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending finalizations: %w", err)
	}
	defer rows.Close()

	var out []domain.PendingDeletion
	for rows.Next() {
		var p domain.PendingDeletion
		if err := rows.Scan(&p.UserID, &p.Email, &p.StripeCustomerID, &p.StripeAccountID, &p.DeletionRequestedAt); err != nil {
			return nil, fmt.Errorf("list pending finalizations: scan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// FinalizeAccountDeletion runs the full GDPR/CCPA erasure cascade for one
// user inside a single transaction. The cascade is idempotent — a re-call
// returns ErrDeletionAlreadyFinalized without re-running the wipes.
//
// Table-by-table erasure decisions are documented in
// docs/operations/gdpr-delete.md and summarised inline below.
func (r *PostgresRepository) FinalizeAccountDeletion(ctx context.Context, userID string) (domain.ErasureCounts, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, fmt.Errorf("finalize: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Idempotency guard: lock the row, bail if already finalized.
	var requested, finalized *time.Time
	err = tx.QueryRow(ctx, `
		SELECT deletion_requested_at, deletion_finalized_at
		  FROM users
		 WHERE id = $1
		 FOR UPDATE`, userID).Scan(&requested, &finalized)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("finalize: %w", domain.ErrUserNotFound)
		}
		return nil, fmt.Errorf("finalize: read state: %w", err)
	}
	if finalized != nil {
		return nil, fmt.Errorf("finalize: %w", domain.ErrDeletionAlreadyFinalized)
	}

	counts := make(domain.ErasureCounts)

	exec := func(table string, sql string, args ...any) error {
		tag, execErr := tx.Exec(ctx, sql, args...)
		if execErr != nil {
			return fmt.Errorf("finalize %s: %w", table, execErr)
		}
		counts[table] += tag.RowsAffected()
		return nil
	}

	// 1. users — anonymize PII, mark status='deactivated', set finalized_at.
	//    We keep the row so foreign keys (jobs.customer_id, bids.provider_id,
	//    reviews.reviewer_id, etc.) stay valid. Email is replaced with a
	//    deterministic-looking tombstone so analytics counts don't break.
	//
	//    dob / dob_verified_at / dob_encrypted are cleared here as of migration
	//    106. Before that they were absent from this statement, so a full date
	//    of birth SURVIVED a right-to-erasure request. dob_encrypted is in the
	//    list for the same reason the plaintext is: an encrypted copy of an
	//    erased identifier is still a retained identifier.
	if err := exec("users", `
		UPDATE users
		   SET email             = 'deleted-' || id::text || '@deleted.local',
		       email_verified    = false,
		       password_hash     = NULL,
		       phone             = NULL,
		       phone_verified    = false,
		       display_name      = 'Deleted User',
		       avatar_url        = NULL,
		       status            = 'deactivated',
		       suspension_reason = 'gdpr_erased',
		       mfa_enabled       = false,
		       mfa_secret        = NULL,
		       mfa_backup_codes  = NULL,
		       dob               = NULL,
		       dob_verified_at   = NULL,
		       dob_encrypted     = NULL,
		       deletion_finalized_at = now(),
		       deleted_at        = now(),
		       updated_at        = now()
		 WHERE id = $1`, userID); err != nil {
		return nil, err
	}

	// 2. provider_profiles — anonymize free-text and verification fields.
	if err := exec("provider_profiles", `
		UPDATE provider_profiles
		   SET business_name            = 'Deleted Provider',
		       bio                      = NULL,
		       service_address          = NULL,
		       service_location         = NULL,
		       ein_tin                  = NULL,
		       insurance_policy_number  = NULL,
		       updated_at               = now()
		 WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// 3. provider_employees — these are real people other than the user.
	//    Wipe their PII because the user can no longer manage consent.
	//    date_of_birth_encrypted (migration 106) is nulled alongside the DATE
	//    it is being drained into — otherwise erasure would clear the column
	//    the backfill empties and leave the one it fills.
	if err := exec("provider_employees", `
		UPDATE provider_employees
		   SET first_name              = 'Deleted',
		       last_name               = 'Employee',
		       email                   = NULL,
		       phone                   = NULL,
		       date_of_birth           = NULL,
		       date_of_birth_encrypted = NULL,
		       license_number          = NULL,
		       license_state           = NULL,
		       insurance_policy_number = NULL,
		       updated_at              = now()
		 WHERE provider_id = $1`, userID); err != nil {
		return nil, err
	}

	// 4. provider_portfolio_images — drop the rows entirely; S3 cleanup
	//    happens in the service layer (objects under users/{userID}/).
	if err := exec("provider_portfolio_images", `
		DELETE FROM provider_portfolio_images
		 WHERE provider_id IN (SELECT id FROM provider_profiles WHERE user_id = $1)`, userID); err != nil {
		return nil, err
	}

	// 5. properties — anonymize street address but KEEP zip_code so analytics
	//    and market-range computations continue to work. location is NOT NULL
	//    so we set it to a known sentinel point (NULL would violate the schema).
	//
	//    location_encrypted (migration 105) MUST be nulled in the same
	//    statement: it holds the exact coordinate of the home whose address
	//    this update is erasing, and an encrypted copy of an erased address is
	//    still a retained address. Zeroing the geometry while leaving the
	//    ciphertext behind would erase only the approximation and keep the
	//    precise original.
	if err := exec("properties", `
		UPDATE properties
		   SET nickname   = NULL,
		       address    = '[deleted]',
		       city       = '[deleted]',
		       state      = '[deleted]',
		       location   = ST_SetSRID(ST_MakePoint(0, 0), 4326),
		       location_encrypted = NULL,
		       notes      = NULL,
		       deleted_at = COALESCE(deleted_at, now()),
		       updated_at = now()
		 WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// 6. verification_documents — purge entirely. KYC scans must not survive
	//    erasure even if the user later re-registers; that's a fresh consent.
	if err := exec("verification_documents", `
		DELETE FROM verification_documents WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// 7. jobs — keep the row (jobs are platform-public listings; providers
	//    needed to see them publicly during the auction). Anonymize the
	//    free-text description in case the user wrote something identifying.
	//
	//    service_address was already cleared here. service_location_encrypted
	//    (migration 104) holds the EXACT coordinate of that same address and
	//    is cleared for the identical reason it is on properties: erasing the
	//    text while keeping a reverse-geocodable point is not erasure. The
	//    service_location / approximate_location geometries are left alone —
	//    they are NOT NULL and, post-104, coarsened to a ~1 km grid cell.
	if err := exec("jobs", `
		UPDATE jobs
		   SET description     = '[deleted]',
		       service_address = NULL,
		       service_location_encrypted = NULL,
		       updated_at      = now()
		 WHERE customer_id = $1`, userID); err != nil {
		return nil, err
	}

	// job_photos can carry PII (faces, license plates, house exteriors).
	// Drop the DB rows; S3 cleanup is handled by the service layer.
	if err := exec("job_photos", `
		DELETE FROM job_photos
		 WHERE job_id IN (SELECT id FROM jobs WHERE customer_id = $1)`, userID); err != nil {
		return nil, err
	}

	// 8. bids — keep for ledger integrity (every awarded contract has a bid
	//    behind it for money trail). Anonymize free-text inside bid_updates.
	//    bid_updates is a JSONB array; we strip any "note"/"comment" keys.
	if err := exec("bids", `
		UPDATE bids
		   SET bid_updates = COALESCE((
		            SELECT jsonb_agg(elem - 'note' - 'comment' - 'message')
		              FROM jsonb_array_elements(bid_updates) elem
		       ), '[]'::jsonb),
		       updated_at = now()
		 WHERE provider_id = $1
		   AND bid_updates IS NOT NULL`, userID); err != nil {
		return nil, err
	}

	// 9. contracts — ledger record, KEEP. Wipe any free-text the user may
	//    have entered in cancellation_reason.
	if err := exec("contracts", `
		UPDATE contracts
		   SET cancellation_reason = CASE
		          WHEN cancelled_by = $1 THEN NULL
		          ELSE cancellation_reason
		       END,
		       updated_at = now()
		 WHERE customer_id = $1 OR provider_id = $1 OR cancelled_by = $1`, userID); err != nil {
		return nil, err
	}

	// 10. payments — KEEP. Tax/AML retention is mandatory (IRS retains 7 yr,
	//     Stripe disputes 18 mo). No free-text fields owned by the user, so
	//     no anonymization is needed at this layer.

	// 11. reviews — keep ratings (legitimate platform interest), redact text.
	//     reviewer_id stays pointing at the (now-anonymized) user row so
	//     UNIQUE (contract_id, reviewer_id) is not violated.
	if err := exec("reviews", `
		UPDATE reviews
		   SET review_text = '[Deleted]',
		       updated_at  = now()
		 WHERE reviewer_id = $1 OR reviewee_id = $1`, userID); err != nil {
		return nil, err
	}

	if err := exec("review_responses", `
		UPDATE review_responses
		   SET response_text = '[Deleted]',
		       updated_at    = now()
		 WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	if err := exec("review_flags", `
		DELETE FROM review_flags WHERE flagged_by = $1 OR resolved_by = $1`, userID); err != nil {
		return nil, err
	}

	// 12. chat_messages — redact content, keep sender_id (FK preserves
	//     conversation structure for the OTHER party in the chat).
	if err := exec("chat_messages", `
		UPDATE chat_messages
		   SET content         = '[Deleted]',
		       attachment_url  = NULL,
		       attachment_name = NULL,
		       attachment_type = NULL,
		       attachment_size = NULL,
		       metadata_json   = NULL,
		       is_deleted      = true,
		       deleted_at      = COALESCE(deleted_at, now())
		 WHERE sender_id = $1`, userID); err != nil {
		return nil, err
	}

	// 13. sessions / refresh_tokens — DELETE all. The user must not be able
	//     to keep logging in once finalized (status transitions to deactivated
	//     above, but belt-and-braces: revoke the credentials too).
	if err := exec("refresh_tokens", `
		DELETE FROM refresh_tokens WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	if err := exec("user_sessions", `
		UPDATE user_sessions
		   SET fingerprint_components = NULL,
		       device_fingerprint     = NULL,
		       geo_lat                = NULL,
		       geo_lng                = NULL,
		       geo_city               = NULL,
		       geo_country            = NULL,
		       user_agent             = NULL
		 WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// 14. notifications — DELETE entirely. They are personalized; no value
	//     in keeping them after the account is gone.
	if err := exec("notifications", `
		DELETE FROM notifications WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	if err := exec("notification_preferences", `
		DELETE FROM notification_preferences WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	if err := exec("device_tokens", `
		DELETE FROM device_tokens WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// 15. fraud_signals / fraud-related rows — KEEP. Compliance retention
	//     justifies it (we may need to demonstrate why a related account was
	//     banned). Anonymize the user link by setting evidence to NULL where
	//     present; user_id stays so the row is still queryable by signal_type.
	if err := exec("fraud_signals", `
		UPDATE fraud_signals
		   SET evidence_json    = NULL,
		       updated_at       = now()
		 WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// 16. trust_scores — DELETE. The score is meaningless once the account
	//     is wiped, and keeping it would be a residual identifier.
	if err := exec("trust_scores", `
		DELETE FROM trust_scores WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	if err := exec("trust_score_history", `
		DELETE FROM trust_score_history WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// 17. oauth_accounts — DELETE. Provider revocation is handled at the
	//     service layer (call provider's revoke endpoint where supported).
	if err := exec("oauth_accounts", `
		DELETE FROM oauth_accounts WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// 18. subscriptions — KEEP for accounting; Stripe customer deletion is
	//     handled by the service layer. The stripe_customer_id remains on the
	//     row so we know which customer ID was deleted at Stripe.

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("finalize: commit: %w", err)
	}

	return counts, nil
}
