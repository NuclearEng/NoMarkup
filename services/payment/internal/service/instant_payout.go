package service

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// Instant payout defaults — mirrored from gateway instant_payout_pricing.go so
// the payment-service path stays consistent when the gateway is rewired to call
// this method instead of fabricating payout_dev_* ids.
const (
	instantPayoutFeeBps       = 150      // 1.5%
	instantPayoutMinFeeCents  = 100      // $1.00 floor
	instantPayoutMaxPerTxn    = 500_000  // $5,000
	instantPayoutMaxPerDay    = 1_000_000 // $10,000
)

// InstantPayoutResult is returned to callers after a successful (or replayed)
// instant payout.
type InstantPayoutResult struct {
	PayoutID       string
	StripePayoutID string
	AmountCents    int64
	FeeCents       int64
	NetCents       int64
	Status         string
	Replayed       bool
}

// InstantPayout withdraws cleared escrow balance to a provider's Connect
// account via Stripe Instant Payouts (MON-09/10/11).
//
// Flow:
//  1. Eligibility: released AND completed payments contribute to available balance.
//  2. Ledger claim first under per-provider advisory lock (no Stripe before claim).
//  3. Stripe Connect instant payout with deterministic idempotency key.
//  4. Never returns a fabricated payout_dev_* id when not in devMode — either
//     Stripe succeeds or an error is returned.
func (s *PaymentService) InstantPayout(ctx context.Context, providerID string, amountCents int64, idempotencyKey string) (*InstantPayoutResult, error) {
	if providerID == "" {
		return nil, fmt.Errorf("instant payout: provider_id is required")
	}
	if amountCents <= 0 {
		return nil, fmt.Errorf("instant payout: %w", domain.ErrInvalidAmount)
	}
	if amountCents > instantPayoutMaxPerTxn {
		return nil, fmt.Errorf("instant payout: exceeds per-transaction max: %w", domain.ErrInvalidAmount)
	}

	// Replay prior success before claiming a new row.
	if idempotencyKey != "" {
		if prior, found, err := s.repo.LookupInstantPayoutByKey(ctx, providerID, idempotencyKey); err != nil {
			return nil, fmt.Errorf("instant payout lookup: %w", err)
		} else if found && prior.Status == "completed" && prior.StripePayoutID != "" {
			return &InstantPayoutResult{
				PayoutID:       prior.ID,
				StripePayoutID: prior.StripePayoutID,
				AmountCents:    prior.AmountCents,
				FeeCents:       prior.FeeCents,
				NetCents:       prior.NetCents,
				Status:         prior.Status,
				Replayed:       true,
			}, nil
		}
	}

	feeCents := computeInstantPayoutFee(amountCents)
	netCents := amountCents - feeCents
	if netCents <= 0 {
		return nil, fmt.Errorf("instant payout: net after fee non-positive: %w", domain.ErrInvalidAmount)
	}

	// Resolve Connect account before claiming so we fail closed without a
	// dangling pending ledger row when the provider has no account.
	accountID, err := s.repo.GetStripeAccountID(ctx, providerID)
	if err != nil {
		return nil, fmt.Errorf("instant payout: %w", err)
	}

	// Claim ledger first (MON-11) under advisory lock — Stripe only after.
	claimed, err := s.repo.ClaimInstantPayout(ctx, providerID, amountCents, feeCents, netCents, idempotencyKey)
	if err != nil {
		return nil, err
	}
	// If claim returned an already-completed row (idempotent insert race), replay.
	if claimed.Status == "completed" && claimed.StripePayoutID != "" {
		return &InstantPayoutResult{
			PayoutID:       claimed.ID,
			StripePayoutID: claimed.StripePayoutID,
			AmountCents:    claimed.AmountCents,
			FeeCents:       claimed.FeeCents,
			NetCents:       claimed.NetCents,
			Status:         claimed.Status,
			Replayed:       true,
		}, nil
	}

	// Deterministic Stripe key: prefer client key, else ledger row id.
	stripeKey := idempotencyKey
	if stripeKey == "" {
		stripeKey = "instant-payout:" + claimed.ID
	} else {
		stripeKey = "instant-payout:" + stripeKey
	}

	stripePayoutID, err := s.stripe.CreateConnectInstantPayout(ctx, netCents, "usd", accountID, stripeKey)
	if err != nil {
		_ = s.repo.FailInstantPayout(ctx, claimed.ID)
		// Never fabricate a success id outside devMode — CreateConnectInstantPayout
		// already refuses to do so.
		return nil, fmt.Errorf("instant payout stripe: %w", err)
	}

	if err := s.repo.CompleteInstantPayout(ctx, claimed.ID, stripePayoutID); err != nil {
		// Stripe already moved money; log loudly. Ledger claim + Stripe key
		// make a retry safe (same key → same payout).
		slog.Error("instant payout: stripe succeeded but ledger complete failed",
			"payout_id", claimed.ID,
			"stripe_payout_id", stripePayoutID,
			"error", err,
		)
		return nil, fmt.Errorf("instant payout complete ledger: %w", err)
	}

	slog.Info("instant payout completed",
		"payout_id", claimed.ID,
		"provider_id", providerID,
		"amount_cents", amountCents,
		"fee_cents", feeCents,
		"net_cents", netCents,
		"stripe_payout_id", stripePayoutID,
	)

	return &InstantPayoutResult{
		PayoutID:       claimed.ID,
		StripePayoutID: stripePayoutID,
		AmountCents:    amountCents,
		FeeCents:       feeCents,
		NetCents:       netCents,
		Status:         "completed",
	}, nil
}

// computeInstantPayoutFee applies instantPayoutFeeBps with ceiling rounding
// (feeFromBPS — platform take never under-collects) and enforces the $1 floor.
func computeInstantPayoutFee(amountCents int64) int64 {
	fee := feeFromBPS(amountCents, instantPayoutFeeBps)
	if fee < instantPayoutMinFeeCents {
		fee = instantPayoutMinFeeCents
	}
	return fee
}
