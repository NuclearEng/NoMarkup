package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// pgerrcodeForeignKeyViolation is PostgreSQL's SQLSTATE for a foreign key
// violation. Named rather than inlined so the branch below reads as intent.
const pgerrcodeForeignKeyViolation = "23503"

func (r *PostgresRepository) CreateAdvance(ctx context.Context, advance *domain.Advance) error {
	err := r.pool.QueryRow(ctx, `
		INSERT INTO working_capital_advances (
			id, provider_id, contract_id, advance_amount_cents,
			fee_cents, repaid_cents, status
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING created_at, updated_at`,
		advance.ID, advance.ProviderID, advance.ContractID, advance.AdvanceAmountCents,
		advance.FeeCents, advance.RepaidCents, advance.Status,
	).Scan(&advance.CreatedAt, &advance.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create advance: %w", err)
	}
	return nil
}

func (r *PostgresRepository) ListAdvances(ctx context.Context, providerID string, statusFilter string, page, pageSize int) ([]*domain.Advance, int, error) {
	where := []string{}
	args := []interface{}{}
	argIdx := 1

	if providerID != "" {
		where = append(where, fmt.Sprintf("provider_id = $%d", argIdx))
		args = append(args, providerID)
		argIdx++
	}

	if statusFilter != "" {
		where = append(where, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, statusFilter)
		argIdx++
	}

	whereClause := "TRUE"
	if len(where) > 0 {
		whereClause = strings.Join(where, " AND ")
	}

	var totalCount int
	err := r.pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT COUNT(*) FROM working_capital_advances WHERE %s`, whereClause),
		args...,
	).Scan(&totalCount)
	if err != nil {
		return nil, 0, fmt.Errorf("list advances count: %w", err)
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize

	selectQuery := fmt.Sprintf(`
		SELECT id, provider_id, contract_id, advance_amount_cents,
		       fee_cents, repaid_cents, status,
		       reviewed_by, reviewed_at, rejection_reason,
		       disbursed_at, repaid_at, COALESCE(stripe_transfer_id, ''),
		       created_at, updated_at
		FROM working_capital_advances
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`, whereClause, argIdx, argIdx+1)

	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list advances query: %w", err)
	}
	defer rows.Close()

	var advances []*domain.Advance
	for rows.Next() {
		a := &domain.Advance{}
		err := rows.Scan(
			&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
			&a.FeeCents, &a.RepaidCents, &a.Status,
			&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
			&a.DisbursedAt, &a.RepaidAt, &a.StripeTransferID,
			&a.CreatedAt, &a.UpdatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("list advances scan: %w", err)
		}
		advances = append(advances, a)
	}

	return advances, totalCount, nil
}

func (r *PostgresRepository) GetAdvance(ctx context.Context, advanceID string) (*domain.Advance, error) {
	a := &domain.Advance{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, provider_id, contract_id, advance_amount_cents,
		       fee_cents, repaid_cents, status,
		       reviewed_by, reviewed_at, rejection_reason,
		       disbursed_at, repaid_at, COALESCE(stripe_transfer_id, ''),
		       created_at, updated_at
		FROM working_capital_advances
		WHERE id = $1`, advanceID).Scan(
		&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
		&a.FeeCents, &a.RepaidCents, &a.Status,
		&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
		&a.DisbursedAt, &a.RepaidAt, &a.StripeTransferID,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get advance: %w", domain.ErrAdvanceNotFound)
		}
		return nil, fmt.Errorf("get advance: %w", err)
	}
	return a, nil
}

func (r *PostgresRepository) UpdateAdvanceReview(ctx context.Context, advanceID string, status string, reviewerID string, rejectionReason *string) (*domain.Advance, error) {
	a := &domain.Advance{}
	err := r.pool.QueryRow(ctx, `
		UPDATE working_capital_advances SET
			status = $2,
			reviewed_by = $3,
			reviewed_at = now(),
			rejection_reason = $4,
			updated_at = now()
		WHERE id = $1 AND status = 'requested'
		RETURNING id, provider_id, contract_id, advance_amount_cents,
		          fee_cents, repaid_cents, status,
		          reviewed_by, reviewed_at, rejection_reason,
		          disbursed_at, repaid_at, COALESCE(stripe_transfer_id, ''),
		          created_at, updated_at`,
		advanceID, status, reviewerID, rejectionReason,
	).Scan(
		&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
		&a.FeeCents, &a.RepaidCents, &a.Status,
		&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
		&a.DisbursedAt, &a.RepaidAt, &a.StripeTransferID,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("review advance: %w (may already be reviewed)", domain.ErrAdvanceNotFound)
		}
		return nil, fmt.Errorf("review advance: %w", err)
	}
	return a, nil
}

func (r *PostgresRepository) UpdateAdvanceDisbursement(ctx context.Context, advanceID string, stripeTransferID string) (*domain.Advance, error) {
	a := &domain.Advance{}
	err := r.pool.QueryRow(ctx, `
		UPDATE working_capital_advances SET
			status = 'disbursed',
			disbursed_at = now(),
			stripe_transfer_id = $2,
			updated_at = now()
		WHERE id = $1 AND status = 'approved'
		RETURNING id, provider_id, contract_id, advance_amount_cents,
		          fee_cents, repaid_cents, status,
		          reviewed_by, reviewed_at, rejection_reason,
		          disbursed_at, repaid_at, COALESCE(stripe_transfer_id, ''),
		          created_at, updated_at`,
		advanceID, stripeTransferID,
	).Scan(
		&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
		&a.FeeCents, &a.RepaidCents, &a.Status,
		&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
		&a.DisbursedAt, &a.RepaidAt, &a.StripeTransferID,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("disburse advance: %w (may not be in approved status)", domain.ErrAdvanceNotFound)
		}
		return nil, fmt.Errorf("disburse advance: %w", err)
	}
	return a, nil
}

// UpdateAdvanceRepayment records that paymentID paid amountCents down against
// advanceID and increments the advance's repaid_cents accordingly.
//
// It is IDEMPOTENT per (advanceID, paymentID) and it CANNOT over-repay. The
// returned advance is always the advance's current state; callers must diff its
// RepaidCents against what they read before the call to learn how much this
// call actually applied — a repeat call for the same (advance, payment) applies
// zero and returns the row unchanged.
//
// MONEY (MON-03 follow-up): both guarantees are load-bearing. ReleaseEscrow can
// legitimately re-enter this path for a payment it has already deducted from:
// release #1 claims the payment escrow→released, deducts R here, creates the
// Stripe transfer for (payout - R) and crashes before stripe_transfer_id is
// stamped; the retry sees released-with-no-transfer, sets resume=true, skips the
// CAS claim and runs the repayment loop again. Stripe dedupes the transfer on
// its deterministic idempotency key and returns the ORIGINAL transfer, so only R
// was ever withheld — but the old code inserted a second advance_repayments row
// and ran `repaid_cents = repaid_cents + R'` with no cap in the WHERE, crediting
// R + R' against a debt only R was collected for. The platform ate the
// difference, compounding on every retry.
//
// Two guards, both enforced by the database rather than by a prior read:
//
//  1. The INSERT is ON CONFLICT (advance_id, payment_id) DO NOTHING against the
//     unique index from migration 076, and its RowsAffected gates the UPDATE.
//     A repeat delivery inserts nothing, so nothing is credited.
//  2. The UPDATE carries `repaid_cents + $2 <= advance_amount_cents + fee_cents`
//     in its WHERE, so the over-repay check is evaluated atomically against the
//     CURRENT row under the row lock the UPDATE takes — not against a value read
//     earlier. This is the same guard already proven in
//     gateway/internal/handler/working_capital.go's manual-repayment path.
//
// Both run inside one transaction, so a rejected cap check also rolls back the
// repayment row rather than leaving a ledger entry with no matching credit.
func (r *PostgresRepository) UpdateAdvanceRepayment(ctx context.Context, advanceID string, paymentID string, amountCents int64) (*domain.Advance, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("update advance repayment begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Claim the (advance, payment) pair. RowsAffected is the claim: 1 means this
	// caller is the first to record this payment against this advance, 0 means a
	// prior delivery already did and this call must not credit anything.
	tag, err := tx.Exec(ctx, `
		INSERT INTO advance_repayments (advance_id, payment_id, amount_cents)
		VALUES ($1, $2, $3)
		ON CONFLICT (advance_id, payment_id) DO NOTHING`,
		advanceID, paymentID, amountCents,
	)
	if err != nil {
		// A bogus advance/payment id trips the foreign key here, before the
		// UPDATE below ever runs. Map those to the domain sentinels so the
		// caller gets a 404 rather than a 500 on what is plain bad input
		// (CLAUDE.md §15: a 500 is never the answer to a predictable
		// condition).
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgerrcodeForeignKeyViolation {
			switch pgErr.ConstraintName {
			case "advance_repayments_advance_id_fkey":
				return nil, fmt.Errorf("update advance repayment: advance %s: %w",
					advanceID, domain.ErrAdvanceNotFound)
			case "advance_repayments_payment_id_fkey":
				return nil, fmt.Errorf("update advance repayment: payment %s: %w",
					paymentID, domain.ErrPaymentNotFound)
			}
		}
		return nil, fmt.Errorf("update advance repayment insert: %w", err)
	}

	if tag.RowsAffected() == 0 {
		// Already recorded. Return the advance untouched so the caller sees an
		// unchanged repaid_cents and accounts for a zero delta.
		a, aerr := scanAdvance(tx.QueryRow(ctx, advanceSelectSQL+` WHERE id = $1`, advanceID))
		if aerr != nil {
			return nil, aerr
		}
		if cerr := tx.Commit(ctx); cerr != nil {
			return nil, fmt.Errorf("update advance repayment commit: %w", cerr)
		}
		return a, nil
	}

	// Apply the credit. The cap in the WHERE is the authoritative over-repay
	// guard; it is re-evaluated against the row as it stands right now.
	a, err := scanAdvance(tx.QueryRow(ctx, `
		UPDATE working_capital_advances SET
			repaid_cents = repaid_cents + $2,
			status = CASE
				WHEN repaid_cents + $2 >= advance_amount_cents + fee_cents THEN 'repaid'
				WHEN status = 'disbursed' THEN 'repaying'
				ELSE status
			END,
			repaid_at = CASE
				WHEN repaid_cents + $2 >= advance_amount_cents + fee_cents THEN now()
				ELSE repaid_at
			END,
			updated_at = now()
		WHERE id = $1
		  AND repaid_cents + $2 <= advance_amount_cents + fee_cents
		RETURNING id, provider_id, contract_id, advance_amount_cents,
		          fee_cents, repaid_cents, status,
		          reviewed_by, reviewed_at, rejection_reason,
		          disbursed_at, repaid_at, COALESCE(stripe_transfer_id, ''),
		          created_at, updated_at`,
		advanceID, amountCents,
	))
	if err != nil {
		if errors.Is(err, domain.ErrAdvanceNotFound) {
			// Zero rows matched: either the advance does not exist, or the cap
			// guard rejected the amount. Re-read to tell them apart and report
			// the right error, rather than a misleading "not found" on what is
			// really an over-repayment (CLAUDE.md §15: map to the right 4xx).
			var exists bool
			if cerr := tx.QueryRow(ctx,
				`SELECT true FROM working_capital_advances WHERE id = $1`, advanceID,
			).Scan(&exists); cerr == nil && exists {
				return nil, fmt.Errorf(
					"update advance repayment: %d cents exceeds the outstanding balance on advance %s: %w",
					amountCents, advanceID, domain.ErrInvalidAmount)
			}
			return nil, fmt.Errorf("update advance repayment: %w", domain.ErrAdvanceNotFound)
		}
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("update advance repayment commit: %w", err)
	}

	return a, nil
}

// advanceSelectSQL is the canonical column list for working_capital_advances,
// shared by the readers that hydrate a domain.Advance so the projection and
// scanAdvance below cannot drift apart.
const advanceSelectSQL = `
	SELECT id, provider_id, contract_id, advance_amount_cents,
	       fee_cents, repaid_cents, status,
	       reviewed_by, reviewed_at, rejection_reason,
	       disbursed_at, repaid_at, COALESCE(stripe_transfer_id, ''),
	       created_at, updated_at
	FROM working_capital_advances`

// scanAdvance hydrates a domain.Advance from a row projecting advanceSelectSQL's
// column list (or an equivalent RETURNING clause). pgx.ErrNoRows is translated
// to domain.ErrAdvanceNotFound so callers can branch on a sentinel.
func scanAdvance(row pgx.Row) (*domain.Advance, error) {
	a := &domain.Advance{}
	err := row.Scan(
		&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
		&a.FeeCents, &a.RepaidCents, &a.Status,
		&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
		&a.DisbursedAt, &a.RepaidAt, &a.StripeTransferID,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("scan advance: %w", domain.ErrAdvanceNotFound)
		}
		return nil, fmt.Errorf("scan advance: %w", err)
	}
	return a, nil
}

func (r *PostgresRepository) GetActiveAdvancesForProvider(ctx context.Context, providerID string) ([]*domain.Advance, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, provider_id, contract_id, advance_amount_cents,
		       fee_cents, repaid_cents, status,
		       reviewed_by, reviewed_at, rejection_reason,
		       disbursed_at, repaid_at, COALESCE(stripe_transfer_id, ''),
		       created_at, updated_at
		FROM working_capital_advances
		WHERE provider_id = $1 AND status IN ('disbursed', 'repaying')
		ORDER BY created_at ASC`, providerID)
	if err != nil {
		return nil, fmt.Errorf("get active advances: %w", err)
	}
	defer rows.Close()

	var advances []*domain.Advance
	for rows.Next() {
		a := &domain.Advance{}
		err := rows.Scan(
			&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
			&a.FeeCents, &a.RepaidCents, &a.Status,
			&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
			&a.DisbursedAt, &a.RepaidAt, &a.StripeTransferID,
			&a.CreatedAt, &a.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("get active advances scan: %w", err)
		}
		advances = append(advances, a)
	}

	return advances, nil
}

func (r *PostgresRepository) GetCreditLimit(ctx context.Context, providerID string) (*domain.CreditLimit, error) {
	cl := &domain.CreditLimit{}
	// factor_rate is a nullable NUMERIC; scan into a pointer so a NULL (no
	// decision yet) maps to the domain's zero value rather than erroring.
	var factorRate *float64
	err := r.pool.QueryRow(ctx, `
		SELECT id, provider_id, max_advance_cents, total_outstanding_cents,
		       risk_score, last_computed_at, jobs_completed,
		       total_earnings_cents, avg_job_value_cents, on_time_rate,
		       approved, COALESCE(tier, ''), available_advance_cents,
		       fee_bps, factor_rate, holdback_pct,
		       COALESCE(binding_cap, ''), COALESCE(decision_hash, ''), COALESCE(model_version, ''),
		       created_at, updated_at
		FROM provider_credit_limits
		WHERE provider_id = $1`, providerID).Scan(
		&cl.ID, &cl.ProviderID, &cl.MaxAdvanceCents, &cl.TotalOutstandingCents,
		&cl.RiskScore, &cl.LastComputedAt, &cl.JobsCompleted,
		&cl.TotalEarningsCents, &cl.AvgJobValueCents, &cl.OnTimeRate,
		&cl.Approved, &cl.Tier, &cl.AvailableAdvanceCents,
		&cl.FeeBps, &factorRate, &cl.HoldbackPct,
		&cl.BindingCap, &cl.DecisionHash, &cl.ModelVersion,
		&cl.CreatedAt, &cl.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Return a zero-value credit limit for providers without one.
			return &domain.CreditLimit{ProviderID: providerID}, nil
		}
		return nil, fmt.Errorf("get credit limit: %w", err)
	}
	if factorRate != nil {
		cl.FactorRate = *factorRate
	}
	return cl, nil
}

func (r *PostgresRepository) UpsertCreditLimit(ctx context.Context, limit *domain.CreditLimit) error {
	// factor_rate stores NULL when no decision has set it (zero value), keeping
	// "1.0000" (a real factor rate) distinct from "never underwritten".
	var factorRate *float64
	if limit.FactorRate != 0 {
		factorRate = &limit.FactorRate
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO provider_credit_limits (
			provider_id, max_advance_cents, total_outstanding_cents,
			risk_score, last_computed_at, jobs_completed,
			total_earnings_cents, avg_job_value_cents, on_time_rate,
			approved, tier, available_advance_cents,
			fee_bps, factor_rate, holdback_pct,
			binding_cap, decision_hash, model_version
		) VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8,
			$9, $10, $11, $12, $13, $14, $15, $16, $17)
		ON CONFLICT (provider_id) DO UPDATE SET
			max_advance_cents = EXCLUDED.max_advance_cents,
			total_outstanding_cents = EXCLUDED.total_outstanding_cents,
			risk_score = EXCLUDED.risk_score,
			last_computed_at = now(),
			jobs_completed = EXCLUDED.jobs_completed,
			total_earnings_cents = EXCLUDED.total_earnings_cents,
			avg_job_value_cents = EXCLUDED.avg_job_value_cents,
			on_time_rate = EXCLUDED.on_time_rate,
			approved = EXCLUDED.approved,
			tier = EXCLUDED.tier,
			available_advance_cents = EXCLUDED.available_advance_cents,
			fee_bps = EXCLUDED.fee_bps,
			factor_rate = EXCLUDED.factor_rate,
			holdback_pct = EXCLUDED.holdback_pct,
			binding_cap = EXCLUDED.binding_cap,
			decision_hash = EXCLUDED.decision_hash,
			model_version = EXCLUDED.model_version`,
		limit.ProviderID, limit.MaxAdvanceCents, limit.TotalOutstandingCents,
		limit.RiskScore, limit.JobsCompleted,
		limit.TotalEarningsCents, limit.AvgJobValueCents, limit.OnTimeRate,
		limit.Approved, limit.Tier, limit.AvailableAdvanceCents,
		limit.FeeBps, factorRate, limit.HoldbackPct,
		limit.BindingCap, limit.DecisionHash, limit.ModelVersion,
	)
	if err != nil {
		return fmt.Errorf("upsert credit limit: %w", err)
	}
	return nil
}
