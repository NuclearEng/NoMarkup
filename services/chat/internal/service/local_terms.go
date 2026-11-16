package service

// FR-5.4 / FR-8.9 — bind accepted chat local terms onto a live contract.
//
// Chat records explicit customer Accept via RespondToTerms. When the channel
// is linked to a job and a live contract exists for that job + parties, this
// binder updates the existing contracts columns:
//   - payment_timing  (when the proposed value normalizes to a CHECK-allowed value)
//   - terms_json      (merge a local_terms snapshot under the accepted proposal)
//
// No new schema. No new gRPC contract RPC — chat already shares the primary
// Postgres and the same pattern is used for bid access checks (PGBidChecker).
// If there is no live contract (pre-award chat), accept still succeeds and
// consent is recorded with contract_override_applied=false /
// no_live_contract. Job CreateContractFromAward closes that residual via
// PendingLocalTermsApplier (mirrored SQL; fail-soft on award).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LocalTermsBinder loads the latest proposal and applies it to a live contract.
// Optional on Service: nil means consent-only (no contract override attempt).
type LocalTermsBinder interface {
	// LatestProposedTerms returns metadata JSON and message id for the newest
	// non-deleted proposed_terms message on the channel. ErrNoRows-style miss
	// returns ("", "", nil).
	LatestProposedTerms(ctx context.Context, channelID string) (metadataJSON []byte, messageID string, err error)

	// ApplyLocalTerms updates contracts.payment_timing (optional) and merges
	// termsJSON into contracts.terms_json for the live contract matching
	// job + parties. Returns ("", nil) when no eligible contract exists.
	ApplyLocalTerms(ctx context.Context, jobID, customerID, providerID string, paymentTiming *string, termsJSON []byte) (contractID string, err error)
}

// PGLocalTermsBinder implements LocalTermsBinder against primary Postgres.
type PGLocalTermsBinder struct {
	pool *pgxpool.Pool
}

// NewPGLocalTermsBinder returns a binder backed by the given pool.
func NewPGLocalTermsBinder(pool *pgxpool.Pool) *PGLocalTermsBinder {
	return &PGLocalTermsBinder{pool: pool}
}

// LatestProposedTerms implements LocalTermsBinder.
func (b *PGLocalTermsBinder) LatestProposedTerms(ctx context.Context, channelID string) ([]byte, string, error) {
	if b == nil || b.pool == nil {
		return nil, "", fmt.Errorf("local terms binder: no database pool configured")
	}
	var id string
	var meta []byte
	err := b.pool.QueryRow(ctx, `
		SELECT id, metadata_json
		  FROM chat_messages
		 WHERE channel_id = $1
		   AND message_type = 'proposed_terms'
		   AND is_deleted = false
		 ORDER BY created_at DESC
		 LIMIT 1`,
		channelID,
	).Scan(&id, &meta)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", fmt.Errorf("latest proposed terms: %w", err)
	}
	return meta, id, nil
}

// ApplyLocalTerms implements LocalTermsBinder.
//
// Eligible contracts: deleted_at IS NULL, status pending_acceptance|active,
// matching job_id + customer_id + provider_id. Mirrors the live-contract idea
// from uq_contracts_live_job but also excludes completed/abandoned so terminal
// work is not rewritten by a late chat Accept.
func (b *PGLocalTermsBinder) ApplyLocalTerms(
	ctx context.Context,
	jobID, customerID, providerID string,
	paymentTiming *string,
	termsJSON []byte,
) (string, error) {
	// Empty party set is a deliberate residual (no eligible contract) — check
	// before pool so miswired binders still fail soft on incomplete identity.
	if jobID == "" || customerID == "" || providerID == "" {
		return "", nil
	}
	if b == nil || b.pool == nil {
		return "", fmt.Errorf("local terms binder: no database pool configured")
	}
	if len(termsJSON) == 0 {
		termsJSON = []byte(`{}`)
	}

	var contractID string
	var err error
	if paymentTiming != nil && *paymentTiming != "" {
		err = b.pool.QueryRow(ctx, `
			UPDATE contracts
			   SET payment_timing = $4,
			       terms_json = COALESCE(terms_json, '{}'::jsonb) || $5::jsonb,
			       updated_at = now()
			 WHERE job_id = $1
			   AND customer_id = $2
			   AND provider_id = $3
			   AND deleted_at IS NULL
			   AND status IN ('pending_acceptance', 'active')
			 RETURNING id`,
			jobID, customerID, providerID, *paymentTiming, termsJSON,
		).Scan(&contractID)
	} else {
		err = b.pool.QueryRow(ctx, `
			UPDATE contracts
			   SET terms_json = COALESCE(terms_json, '{}'::jsonb) || $4::jsonb,
			       updated_at = now()
			 WHERE job_id = $1
			   AND customer_id = $2
			   AND provider_id = $3
			   AND deleted_at IS NULL
			   AND status IN ('pending_acceptance', 'active')
			 RETURNING id`,
			jobID, customerID, providerID, termsJSON,
		).Scan(&contractID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("apply local terms: %w", err)
	}
	return contractID, nil
}

// normalizePaymentTiming maps free-text proposal fields onto contracts.payment_timing
// CHECK values. Returns ok=false when the value is free-form narrative (still
// stored under terms_json; payment_timing column left unchanged).
func normalizePaymentTiming(raw string) (string, bool) {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return "", false
	}
	s = strings.ReplaceAll(s, "-", "_")
	s = strings.ReplaceAll(s, " ", "_")
	// Collapse repeated underscores from mixed separators.
	for strings.Contains(s, "__") {
		s = strings.ReplaceAll(s, "__", "_")
	}
	switch s {
	case "upfront", "up_front":
		return "upfront", true
	case "milestone", "milestones":
		return "milestone", true
	case "completion", "on_completion", "at_completion":
		return "completion", true
	case "payment_plan", "paymentplan", "installment", "installments":
		return "payment_plan", true
	case "recurring", "subscription":
		return "recurring", true
	default:
		return "", false
	}
}

// extractPaymentTiming prefers an explicit payment_timing key, then payment_type.
func extractPaymentTiming(terms map[string]interface{}) *string {
	if terms == nil {
		return nil
	}
	for _, key := range []string{"payment_timing", "paymentTiming", "payment_type", "paymentType"} {
		s := termString(terms, key)
		if s == "" {
			continue
		}
		if pt, ok := normalizePaymentTiming(s); ok {
			return &pt
		}
	}
	return nil
}

// buildLocalTermsPatch builds the JSONB merge fragment written into terms_json.
func buildLocalTermsPatch(
	proposed map[string]interface{},
	customerID, channelID, proposedMessageID string,
	paymentTiming *string,
) ([]byte, error) {
	if proposed == nil {
		proposed = map[string]interface{}{}
	}
	local := map[string]interface{}{
		"payment_type":        termString(proposed, "payment_type", "paymentType"),
		"amount":              termString(proposed, "amount"),
		"milestones":          termString(proposed, "milestones"),
		"description":         termString(proposed, "description"),
		"accepted_by":         customerID,
		"accepted_at":         time.Now().UTC().Format(time.RFC3339),
		"source":              "chat_proposed_terms",
		"channel_id":          channelID,
		"proposed_message_id": proposedMessageID,
	}
	if paymentTiming != nil {
		local["payment_timing"] = *paymentTiming
	}
	// Drop empty string fields so terms_json stays compact.
	for k, v := range local {
		if s, ok := v.(string); ok && s == "" {
			delete(local, k)
		}
	}
	patch := map[string]interface{}{
		"local_terms": local,
	}
	return json.Marshal(patch)
}
