package service

// FR-5.4 residual — apply chat-accepted local terms when a contract is created
// from award.
//
// Chat's RespondToTerms binds payment_timing / terms_json only when a live
// contract already exists. Customers often Accept proposed terms in pre-award
// chat; consent is recorded (terms_accepted) with
// contract_override_applied=false / no_live_contract. On CreateContractFromAward
// we close that residual by looking up the job's chat channel for the parties
// and applying the same merge chat would have done.
//
// Job owns the apply (SQL against shared Postgres) so chat and job stay free of
// circular service deps. Failures are soft: award must never fail because
// terms re-apply failed.

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

// PendingLocalTermsApplier binds previously accepted chat local terms onto a
// live contract for job + parties. Optional on ContractService: nil skips.
type PendingLocalTermsApplier interface {
	// ApplyPendingLocalTerms finds the chat channel for job+parties; if the
	// latest terms decision is an Accept that has not yet bound a contract
	// override, merges the latest proposed_terms into contracts.payment_timing
	// and terms_json. Returns the contract id when applied, "" when nothing
	// to do, or an error on hard failure (caller must fail soft).
	ApplyPendingLocalTerms(ctx context.Context, jobID, customerID, providerID string) (contractID string, err error)
}

// PGPendingLocalTermsApplier implements PendingLocalTermsApplier against primary Postgres.
type PGPendingLocalTermsApplier struct {
	pool *pgxpool.Pool
}

// NewPGPendingLocalTermsApplier returns an applier backed by the given pool.
func NewPGPendingLocalTermsApplier(pool *pgxpool.Pool) *PGPendingLocalTermsApplier {
	return &PGPendingLocalTermsApplier{pool: pool}
}

// ApplyPendingLocalTerms implements PendingLocalTermsApplier.
func (a *PGPendingLocalTermsApplier) ApplyPendingLocalTerms(
	ctx context.Context,
	jobID, customerID, providerID string,
) (string, error) {
	if a == nil || a.pool == nil {
		return "", fmt.Errorf("pending local terms: no database pool configured")
	}
	if jobID == "" || customerID == "" || providerID == "" {
		return "", nil
	}

	channelID, err := a.lookupChannel(ctx, jobID, customerID, providerID)
	if err != nil {
		return "", err
	}
	if channelID == "" {
		return "", nil
	}

	msgType, metaJSON, err := a.latestTermsDecision(ctx, channelID)
	if err != nil {
		return "", err
	}
	if msgType != "terms_accepted" {
		// No accept, or latest decision is reject / missing.
		return "", nil
	}
	if overrideAlreadyApplied(metaJSON) {
		return "", nil
	}

	proposedMeta, proposedMsgID, err := a.latestProposedTerms(ctx, channelID)
	if err != nil {
		return "", err
	}
	if proposedMsgID == "" {
		return "", nil
	}

	proposed := map[string]interface{}{}
	if len(proposedMeta) > 0 {
		if err := json.Unmarshal(proposedMeta, &proposed); err != nil {
			return "", fmt.Errorf("pending local terms: invalid proposal metadata: %w", err)
		}
	}

	paymentTiming := extractPaymentTiming(proposed)
	patch, err := buildLocalTermsPatch(proposed, customerID, channelID, proposedMsgID, paymentTiming)
	if err != nil {
		return "", fmt.Errorf("pending local terms: build patch: %w", err)
	}

	return a.applyLocalTerms(ctx, jobID, customerID, providerID, paymentTiming, patch)
}

func (a *PGPendingLocalTermsApplier) lookupChannel(
	ctx context.Context,
	jobID, customerID, providerID string,
) (string, error) {
	var channelID string
	err := a.pool.QueryRow(ctx, `
		SELECT id
		  FROM chat_channels
		 WHERE job_id = $1
		   AND customer_id = $2
		   AND provider_id = $3
		 LIMIT 1`,
		jobID, customerID, providerID,
	).Scan(&channelID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("pending local terms: channel lookup: %w", err)
	}
	return channelID, nil
}

func (a *PGPendingLocalTermsApplier) latestTermsDecision(
	ctx context.Context,
	channelID string,
) (messageType string, metadataJSON []byte, err error) {
	err = a.pool.QueryRow(ctx, `
		SELECT message_type, COALESCE(metadata_json, '{}'::jsonb)
		  FROM chat_messages
		 WHERE channel_id = $1
		   AND message_type IN ('terms_accepted', 'terms_rejected')
		   AND is_deleted = false
		 ORDER BY created_at DESC
		 LIMIT 1`,
		channelID,
	).Scan(&messageType, &metadataJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, fmt.Errorf("pending local terms: decision lookup: %w", err)
	}
	return messageType, metadataJSON, nil
}

func (a *PGPendingLocalTermsApplier) latestProposedTerms(
	ctx context.Context,
	channelID string,
) ([]byte, string, error) {
	var id string
	var meta []byte
	err := a.pool.QueryRow(ctx, `
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
		return nil, "", fmt.Errorf("pending local terms: proposal lookup: %w", err)
	}
	return meta, id, nil
}

// applyLocalTerms mirrors chat's PGLocalTermsBinder.ApplyLocalTerms.
func (a *PGPendingLocalTermsApplier) applyLocalTerms(
	ctx context.Context,
	jobID, customerID, providerID string,
	paymentTiming *string,
	termsJSON []byte,
) (string, error) {
	if len(termsJSON) == 0 {
		termsJSON = []byte(`{}`)
	}

	var contractID string
	var err error
	if paymentTiming != nil && *paymentTiming != "" {
		err = a.pool.QueryRow(ctx, `
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
		err = a.pool.QueryRow(ctx, `
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
		return "", fmt.Errorf("pending local terms: apply: %w", err)
	}
	return contractID, nil
}

// overrideAlreadyApplied reports whether terms_accepted metadata already shows
// a successful contract bind (chat path post-contract Accept).
func overrideAlreadyApplied(metaJSON []byte) bool {
	if len(metaJSON) == 0 {
		return false
	}
	var meta map[string]interface{}
	if err := json.Unmarshal(metaJSON, &meta); err != nil {
		return false
	}
	v, ok := meta["contract_override_applied"]
	if !ok {
		return false
	}
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return strings.EqualFold(t, "true")
	default:
		return false
	}
}

// --- helpers mirrored from services/chat LocalTermsBinder (keep in sync) ---

func normalizePaymentTiming(raw string) (string, bool) {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return "", false
	}
	s = strings.ReplaceAll(s, "-", "_")
	s = strings.ReplaceAll(s, " ", "_")
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
		// Distinguish award-time residual bind from live Accept bind.
		"bound_at": "award",
	}
	if paymentTiming != nil {
		local["payment_timing"] = *paymentTiming
	}
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

func termString(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			s := strings.TrimSpace(fmt.Sprint(v))
			if s != "" && s != "<nil>" {
				return s
			}
		}
	}
	return ""
}
