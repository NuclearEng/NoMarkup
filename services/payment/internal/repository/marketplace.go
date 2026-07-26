package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/services/payment/internal/service"
)

// MarketplaceRepository is the pgx-backed implementation of
// service.MarketplaceRepository for the goods escrow lifecycle.
type MarketplaceRepository struct {
	pool *pgxpool.Pool
}

// NewMarketplaceRepository creates a new MarketplaceRepository.
func NewMarketplaceRepository(pool *pgxpool.Pool) *MarketplaceRepository {
	return &MarketplaceRepository{pool: pool}
}

// GetListingOrder retrieves a listing order by id.
func (r *MarketplaceRepository) GetListingOrder(ctx context.Context, orderID string) (*service.MarketplaceListingOrder, error) {
	const q = `
		SELECT lo.id, lo.listing_id, lo.seller_id, lo.buyer_id,
		       lo.amount_cents, lo.fee_cents, lo.tax_cents, lo.seller_payout_cents,
		       lo.escrow_status, COALESCE(lo.payment_intent_id,''),
		       COALESCE(lo.idempotency_key,''),
		       COALESCE(lo.stripe_transfer_id,''),
		       COALESCE(l.pickup_zip_code,''),
		       lo.pickup_confirmed_at, lo.released_at, lo.auto_release_at,
		       lo.dispute_id, lo.created_at, lo.updated_at
		  FROM listing_orders lo
		  JOIN listings l ON l.id = lo.listing_id
		 WHERE lo.id = $1`
	o := &service.MarketplaceListingOrder{}
	var disputeID *string
	row := r.pool.QueryRow(ctx, q, orderID)
	if err := row.Scan(&o.ID, &o.ListingID, &o.SellerID, &o.BuyerID,
		&o.AmountCents, &o.FeeCents, &o.TaxCents, &o.SellerPayoutCents,
		&o.EscrowStatus, &o.PaymentIntentID,
		&o.IdempotencyKey,
		&o.StripeTransferID,
		&o.PickupZipCode,
		&o.PickupConfirmedAt, &o.ReleasedAt, &o.AutoReleaseAt,
		&disputeID, &o.CreatedAt, &o.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, service.ErrListingOrderNotFound
		}
		return nil, fmt.Errorf("get listing order: %w", err)
	}
	o.DisputeID = disputeID
	return o, nil
}

// GetListingOrderByPaymentIntent finds an order by its Stripe PI id.
func (r *MarketplaceRepository) GetListingOrderByPaymentIntent(ctx context.Context, piID string) (*service.MarketplaceListingOrder, error) {
	const q = `SELECT id FROM listing_orders WHERE payment_intent_id = $1`
	var orderID string
	if err := r.pool.QueryRow(ctx, q, piID).Scan(&orderID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, service.ErrListingOrderNotFound
		}
		return nil, fmt.Errorf("get listing order by pi: %w", err)
	}
	return r.GetListingOrder(ctx, orderID)
}

// UpdateListingOrderEscrowStatus transitions the escrow_status. When the new
// status is 'released' or 'partially_refunded' the released_at and
// seller_payout_cents are stamped. pickup_confirmed_at is also set when
// supplied (e.g. on ConfirmPickup).
func (r *MarketplaceRepository) UpdateListingOrderEscrowStatus(
	ctx context.Context,
	orderID, newStatus string,
	releasedAt *time.Time,
	pickupConfirmedAt *time.Time,
	sellerPayoutCents int64,
) error {
	const q = `
		UPDATE listing_orders
		   SET escrow_status = $2,
		       released_at = COALESCE($3, released_at),
		       pickup_confirmed_at = COALESCE($4, pickup_confirmed_at),
		       seller_payout_cents = CASE WHEN $5::BIGINT > 0 THEN $5 ELSE seller_payout_cents END,
		       updated_at = now()
		 WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, orderID, newStatus, releasedAt, pickupConfirmedAt, sellerPayoutCents)
	if err != nil {
		return fmt.Errorf("update listing order escrow status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return service.ErrListingOrderNotFound
	}
	return nil
}

// UpdateListingOrderPaymentIntent stamps the PI id, idempotency key, tax,
// fee, and auto-release deadline on the order.
func (r *MarketplaceRepository) UpdateListingOrderPaymentIntent(
	ctx context.Context,
	orderID, paymentIntentID, idempotencyKey string,
	taxCents, feeCents int64,
	autoReleaseAt time.Time,
) error {
	const q = `
		UPDATE listing_orders
		   SET payment_intent_id = $2,
		       idempotency_key   = $3,
		       tax_cents         = $4,
		       fee_cents         = $5,
		       auto_release_at   = $6,
		       updated_at        = now()
		 WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, orderID, paymentIntentID, idempotencyKey, taxCents, feeCents, autoReleaseAt)
	if err != nil {
		return fmt.Errorf("update listing order payment intent: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return service.ErrListingOrderNotFound
	}
	return nil
}

// ClaimListingOrderForRelease locks the order row FOR UPDATE and returns it
// only when still eligible for payout (held or released, no open dispute, no
// transfer yet). Concurrent dispute file or another auto-release loses.
func (r *MarketplaceRepository) ClaimListingOrderForRelease(ctx context.Context, orderID string) (*service.MarketplaceListingOrder, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("claim listing order begin: %w", err)
	}
	defer tx.Rollback(ctx)

	const q = `
		SELECT lo.id, lo.listing_id, lo.seller_id, lo.buyer_id,
		       lo.amount_cents, lo.fee_cents, lo.tax_cents, lo.seller_payout_cents,
		       lo.escrow_status, COALESCE(lo.payment_intent_id,''),
		       COALESCE(lo.idempotency_key,''),
		       COALESCE(lo.stripe_transfer_id,''),
		       COALESCE(l.pickup_zip_code,''),
		       lo.pickup_confirmed_at, lo.released_at, lo.auto_release_at,
		       lo.dispute_id, lo.created_at, lo.updated_at
		  FROM listing_orders lo
		  JOIN listings l ON l.id = lo.listing_id
		 WHERE lo.id = $1
		 FOR UPDATE OF lo`
	o := &service.MarketplaceListingOrder{}
	var disputeID *string
	err = tx.QueryRow(ctx, q, orderID).Scan(
		&o.ID, &o.ListingID, &o.SellerID, &o.BuyerID,
		&o.AmountCents, &o.FeeCents, &o.TaxCents, &o.SellerPayoutCents,
		&o.EscrowStatus, &o.PaymentIntentID, &o.IdempotencyKey,
		&o.StripeTransferID, &o.PickupZipCode,
		&o.PickupConfirmedAt, &o.ReleasedAt, &o.AutoReleaseAt,
		&disputeID, &o.CreatedAt, &o.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, service.ErrListingOrderNotFound
		}
		return nil, fmt.Errorf("claim listing order: %w", err)
	}
	o.DisputeID = disputeID

	if o.DisputeID != nil && *o.DisputeID != "" {
		return nil, fmt.Errorf("claim listing order disputed: %w", service.ErrInvalidEscrowState)
	}
	if o.StripeTransferID != "" {
		return nil, fmt.Errorf("claim listing order already paid: %w", service.ErrInvalidEscrowState)
	}
	if o.EscrowStatus != "held" && o.EscrowStatus != "released" {
		return nil, fmt.Errorf("claim listing order status %q: %w", o.EscrowStatus, service.ErrInvalidEscrowState)
	}

	// Commit releases the lock; the transfer id stamp is the durable claim.
	// Holding the lock only through the SELECT is enough to serialize with
	// FileListingDispute's status update on the same row when both run under
	// FOR UPDATE; FileListingDispute currently does not lock — the recheck of
	// dispute_id above is the critical race close for auto-release.
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("claim listing order commit: %w", err)
	}
	return o, nil
}

// ListListingOrdersAwaitingPayment returns orders still sitting in
// escrow_status='pending_payment', oldest first. This is the settlement
// sweeper's input set — orders whose buyer has not funded escrow — and it is
// served by idx_listing_orders_awaiting_payment (migration 101), a partial
// index on exactly that status so the scan never walks the funded majority.
//
// Deliberately a narrow projection: the sweeper needs identity, the PI (or its
// absence) and the payment clock, so this query does not have to join listings
// or carry the escrow/dispute columns the full-row SELECTs above return.
func (r *MarketplaceRepository) ListListingOrdersAwaitingPayment(ctx context.Context, limit int) ([]*service.PendingListingOrder, error) {
	const q = `
		SELECT id, listing_id, seller_id, buyer_id, amount_cents,
		       COALESCE(payment_intent_id,''), payment_attempts,
		       payment_due_at, created_at
		  FROM listing_orders
		 WHERE escrow_status = 'pending_payment'
		 ORDER BY created_at ASC
		 LIMIT $1`
	rows, err := r.pool.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("list listing orders awaiting payment: %w", err)
	}
	defer rows.Close()

	var out []*service.PendingListingOrder
	for rows.Next() {
		o := &service.PendingListingOrder{}
		if err := rows.Scan(&o.ID, &o.ListingID, &o.SellerID, &o.BuyerID, &o.AmountCents,
			&o.PaymentIntentID, &o.PaymentAttempts, &o.PaymentDueAt, &o.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan pending listing order: %w", err)
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// RecordListingPaymentAttempt increments payment_attempts and stamps
// last_payment_error (an empty string clears a previous failure).
//
// paymentDueAt is applied only when non-nil AND the row does not already carry
// one: the buyer's deadline is set once, by the pass that first attaches the
// PaymentIntent. A later retry must never quietly extend a clock that is
// already running, or an unfunded order could outlive its window indefinitely.
func (r *MarketplaceRepository) RecordListingPaymentAttempt(ctx context.Context, orderID string, paymentDueAt *time.Time, lastErr string) error {
	const q = `
		UPDATE listing_orders
		   SET payment_attempts   = payment_attempts + 1,
		       payment_due_at     = COALESCE(payment_due_at, $2),
		       last_payment_error = NULLIF($3, ''),
		       updated_at         = now()
		 WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, orderID, paymentDueAt, lastErr)
	if err != nil {
		return fmt.Errorf("record listing payment attempt: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return service.ErrListingOrderNotFound
	}
	return nil
}

// FailListingOrderPayment moves an unfunded order to the terminal
// 'payment_failed' state (migration 101).
//
// The `escrow_status = 'pending_payment'` guard lives in the UPDATE itself, so
// an order that funded between the sweeper's SELECT and this write is left
// exactly as it is — a paid order can never be cancelled by a stale read. Zero
// rows affected therefore means "no longer eligible", reported as
// ErrInvalidEscrowState, not as a missing row.
//
// Money-safety: 'payment_failed' is invisible to ListListingOrdersForAutoRelease
// (which selects only 'held' and 'released'), so an expired order can never
// transfer funds to a seller.
func (r *MarketplaceRepository) FailListingOrderPayment(ctx context.Context, orderID, reason string) error {
	const q = `
		UPDATE listing_orders
		   SET escrow_status      = 'payment_failed',
		       last_payment_error = $2,
		       updated_at         = now()
		 WHERE id = $1
		   AND escrow_status = 'pending_payment'`
	tag, err := r.pool.Exec(ctx, q, orderID, reason)
	if err != nil {
		return fmt.Errorf("fail listing order payment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("fail listing order payment: order %s no longer pending_payment: %w",
			orderID, service.ErrInvalidEscrowState)
	}
	return nil
}

// UpdateListingOrderDispute links / unlinks a dispute_id.
func (r *MarketplaceRepository) UpdateListingOrderDispute(ctx context.Context, orderID string, disputeID *string) error {
	const q = `UPDATE listing_orders SET dispute_id = $2, updated_at = now() WHERE id = $1`
	_, err := r.pool.Exec(ctx, q, orderID, disputeID)
	if err != nil {
		return fmt.Errorf("update listing order dispute: %w", err)
	}
	return nil
}

// ListListingOrdersForAutoRelease returns the orders that still owe the seller
// a payout, with no open dispute, bounded by limit. Two kinds qualify:
//
//  1. escrow_status='held' past the auto-release window (created_at < before) —
//     the buyer never confirmed pickup nor disputed, so we assume pickup and
//     release after 14 days.
//  2. escrow_status='released' with stripe_transfer_id IS NULL — the order was
//     released synchronously by the gateway pickup handshake (buyer + seller
//     both confirmed) but the Stripe Connect transfer to the seller was never
//     fired. These have no time window: they should be paid out on the next
//     tick. This is the disconnect the money-bug fix closes.
//
// Disputed/refunded orders never appear (status filter), so they never pay out.
func (r *MarketplaceRepository) ListListingOrdersForAutoRelease(ctx context.Context, before time.Time, limit int) ([]*service.MarketplaceListingOrder, error) {
	const q = `
		SELECT lo.id, lo.listing_id, lo.seller_id, lo.buyer_id,
		       lo.amount_cents, lo.fee_cents, lo.tax_cents, lo.seller_payout_cents,
		       lo.escrow_status, COALESCE(lo.payment_intent_id,''),
		       COALESCE(lo.idempotency_key,''),
		       COALESCE(lo.stripe_transfer_id,''),
		       COALESCE(l.pickup_zip_code,''),
		       lo.pickup_confirmed_at, lo.released_at, lo.auto_release_at,
		       lo.dispute_id, lo.created_at, lo.updated_at
		  FROM listing_orders lo
		  JOIN listings l ON l.id = lo.listing_id
		 WHERE lo.dispute_id IS NULL
		   AND lo.stripe_transfer_id IS NULL
		   AND (
		         (lo.escrow_status = 'held' AND lo.created_at < $1)
		         OR
		         (lo.escrow_status = 'released')
		       )
		 ORDER BY lo.created_at ASC
		 LIMIT $2`
	rows, err := r.pool.Query(ctx, q, before, limit)
	if err != nil {
		return nil, fmt.Errorf("list listing orders for auto release: %w", err)
	}
	defer rows.Close()

	var out []*service.MarketplaceListingOrder
	for rows.Next() {
		o := &service.MarketplaceListingOrder{}
		var disputeID *string
		if err := rows.Scan(&o.ID, &o.ListingID, &o.SellerID, &o.BuyerID,
			&o.AmountCents, &o.FeeCents, &o.TaxCents, &o.SellerPayoutCents,
			&o.EscrowStatus, &o.PaymentIntentID, &o.IdempotencyKey,
			&o.StripeTransferID,
			&o.PickupZipCode,
			&o.PickupConfirmedAt, &o.ReleasedAt, &o.AutoReleaseAt,
			&disputeID, &o.CreatedAt, &o.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan listing order: %w", err)
		}
		o.DisputeID = disputeID
		out = append(out, o)
	}
	return out, rows.Err()
}

// MarkListingOrderTransferred stamps the Stripe Connect transfer id on a
// paid-out order. The partial index idx_listing_orders_unpaid_released keys off
// stripe_transfer_id IS NULL, so writing a non-null value here removes the order
// from the worker's reconcile set permanently — the durable double-pay guard.
//
// Idempotent: a re-stamp with the same transfer id (deterministic per order via
// the 'listing-release:<id>' Stripe key) is a harmless no-op write.
func (r *MarketplaceRepository) MarkListingOrderTransferred(ctx context.Context, orderID, transferID string) error {
	const q = `
		UPDATE listing_orders
		   SET stripe_transfer_id = $2,
		       updated_at = now()
		 WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, orderID, transferID)
	if err != nil {
		return fmt.Errorf("mark listing order transferred: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return service.ErrListingOrderNotFound
	}
	return nil
}

// CreateMarketplaceDispute inserts a row in marketplace_disputes.
func (r *MarketplaceRepository) CreateMarketplaceDispute(ctx context.Context, d *service.MarketplaceDispute) error {
	const q = `
		INSERT INTO marketplace_disputes (
			id, listing_order_id, opened_by, reason, description, status,
			created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`
	_, err := r.pool.Exec(ctx, q,
		d.ID, d.ListingOrderID, d.OpenedBy, d.Reason, d.Description, d.Status, d.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("create marketplace dispute: %w", err)
	}
	return nil
}

// GetMarketplaceDispute fetches a dispute by id.
func (r *MarketplaceRepository) GetMarketplaceDispute(ctx context.Context, disputeID string) (*service.MarketplaceDispute, error) {
	const q = `
		SELECT id, listing_order_id, opened_by, reason, description, status,
		       COALESCE(resolution,''), refund_to_buyer_cents, transfer_to_seller_cents,
		       COALESCE(resolution_notes,''), resolved_by, resolved_at,
		       created_at, updated_at
		  FROM marketplace_disputes
		 WHERE id = $1`
	d := &service.MarketplaceDispute{}
	var resolvedBy *string
	if err := r.pool.QueryRow(ctx, q, disputeID).Scan(
		&d.ID, &d.ListingOrderID, &d.OpenedBy, &d.Reason, &d.Description, &d.Status,
		&d.Resolution, &d.RefundToBuyerCents, &d.TransferToSellerCents,
		&d.ResolutionNotes, &resolvedBy, &d.ResolvedAt,
		&d.CreatedAt, &d.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get marketplace dispute: not found")
		}
		return nil, fmt.Errorf("get marketplace dispute: %w", err)
	}
	d.ResolvedBy = resolvedBy
	return d, nil
}

// ResolveMarketplaceDispute records the resolution + cents split and stamps
// resolved_by/resolved_at.
func (r *MarketplaceRepository) ResolveMarketplaceDispute(
	ctx context.Context,
	disputeID, resolution, notes, adminID string,
	refundCents, transferCents int64,
) (*service.MarketplaceDispute, error) {
	const q = `
		UPDATE marketplace_disputes
		   SET status = 'resolved',
		       resolution = $2,
		       resolution_notes = $3,
		       refund_to_buyer_cents = $4,
		       transfer_to_seller_cents = $5,
		       resolved_by = $6,
		       resolved_at = now(),
		       updated_at = now()
		 WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, disputeID, resolution, notes, refundCents, transferCents, adminID)
	if err != nil {
		return nil, fmt.Errorf("resolve marketplace dispute: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("resolve marketplace dispute: not found")
	}
	return r.GetMarketplaceDispute(ctx, disputeID)
}

// IncrementSellerTaxForm bumps the seller's running 1099-K total for the
// given tax year. Uses ON CONFLICT to upsert.
func (r *MarketplaceRepository) IncrementSellerTaxForm(ctx context.Context, sellerID string, taxYear int, grossPaymentsCents int64) error {
	const q = `
		INSERT INTO seller_tax_forms (
			seller_id, tax_year, form_type, seller_legal_name, seller_address,
			gross_payments_cents, transaction_count, platform_ein, platform_name, status
		) VALUES (
			$1, $2, '1099-K',
			COALESCE((SELECT email FROM users WHERE id = $1), ''),
			'',
			$3, 1, '', 'NoMarkup', 'draft'
		)
		ON CONFLICT (seller_id, tax_year, form_type) DO UPDATE
		   SET gross_payments_cents = seller_tax_forms.gross_payments_cents + EXCLUDED.gross_payments_cents,
		       transaction_count    = seller_tax_forms.transaction_count + 1,
		       updated_at           = now()`
	if _, err := r.pool.Exec(ctx, q, sellerID, taxYear, grossPaymentsCents); err != nil {
		return fmt.Errorf("increment seller tax form: %w", err)
	}
	return nil
}
