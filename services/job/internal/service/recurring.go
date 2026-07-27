package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

const recurringMaxPauseDays = 90

// GetRecurringConfig loads the recurring schedule for a contract. Parties only.
// Auto-cancels configs paused past pause_max_date (FR-18.6).
// If the job was posted as is_recurring and the contract is already active but
// no config row exists yet (legacy awards before this path shipped), seed one.
func (s *ContractService) GetRecurringConfig(ctx context.Context, contractID, requestingUserID string) (*domain.RecurringConfig, error) {
	contract, err := s.requireContractParty(ctx, contractID, requestingUserID)
	if err != nil {
		return nil, fmt.Errorf("get recurring config: %w", err)
	}
	cfg, err := s.contractRepo.GetRecurringConfigByContract(ctx, contractID)
	if err != nil {
		if errors.Is(err, domain.ErrRecurringNotFound) && contract.Status == "active" {
			if seedErr := s.ensureRecurringConfigForActiveContract(ctx, contract); seedErr != nil {
				slog.Warn("lazy seed recurring config failed",
					"contract_id", contractID, "error", seedErr)
			} else if seeded, seedErr := s.contractRepo.GetRecurringConfigByContract(ctx, contractID); seedErr == nil {
				return s.maybeExpirePaused(ctx, seeded)
			}
		}
		return nil, fmt.Errorf("get recurring config: %w", err)
	}
	return s.maybeExpirePaused(ctx, cfg)
}

// GetRecurringConfigByID loads by recurring id after party check via contract.
func (s *ContractService) GetRecurringConfigByID(ctx context.Context, recurringID, requestingUserID string) (*domain.RecurringConfig, error) {
	cfg, err := s.contractRepo.GetRecurringConfigByID(ctx, recurringID)
	if err != nil {
		return nil, fmt.Errorf("get recurring config: %w", err)
	}
	if _, err := s.requireContractParty(ctx, cfg.ContractID, requestingUserID); err != nil {
		return nil, fmt.Errorf("get recurring config: %w", err)
	}
	return s.maybeExpirePaused(ctx, cfg)
}

// UpdateRecurringConfig updates auto_approve and/or rate for future instances.
// Rate negotiation UI (accept/reject via chat) is residual — either party may
// update rate/auto_approve on an active or paused config (FR-18.3 / partial 18.4).
func (s *ContractService) UpdateRecurringConfig(
	ctx context.Context,
	recurringID, userID string,
	proposedRateCents *int64,
	autoApprove *bool,
) (*domain.RecurringConfig, error) {
	cfg, err := s.contractRepo.GetRecurringConfigByID(ctx, recurringID)
	if err != nil {
		return nil, fmt.Errorf("update recurring config: %w", err)
	}
	if _, err := s.requireContractParty(ctx, cfg.ContractID, userID); err != nil {
		return nil, fmt.Errorf("update recurring config: %w", err)
	}
	cfg, err = s.maybeExpirePaused(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("update recurring config: %w", err)
	}
	if cfg.Status == "cancelled" {
		return nil, fmt.Errorf("update recurring config: %w", domain.ErrRecurringCancelled)
	}

	if proposedRateCents != nil {
		if *proposedRateCents <= 0 {
			return nil, fmt.Errorf("update recurring config: %w", domain.ErrRecurringInvalidRate)
		}
		cfg.RateCents = *proposedRateCents
	}
	if autoApprove != nil {
		cfg.AutoApprove = *autoApprove
	}

	updated, err := s.contractRepo.UpdateRecurringConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("update recurring config: %w", err)
	}
	slog.Info("recurring config updated",
		"recurring_id", recurringID, "user_id", userID,
		"rate_cents", updated.RateCents, "auto_approve", updated.AutoApprove,
	)
	return updated, nil
}

// PauseRecurring pauses generation of new instances (FR-18.6). Max 90 days.
func (s *ContractService) PauseRecurring(ctx context.Context, recurringID, userID string) (*domain.RecurringConfig, error) {
	cfg, err := s.contractRepo.GetRecurringConfigByID(ctx, recurringID)
	if err != nil {
		return nil, fmt.Errorf("pause recurring: %w", err)
	}
	if _, err := s.requireContractParty(ctx, cfg.ContractID, userID); err != nil {
		return nil, fmt.Errorf("pause recurring: %w", err)
	}
	cfg, err = s.maybeExpirePaused(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("pause recurring: %w", err)
	}
	if cfg.Status == "cancelled" {
		return nil, fmt.Errorf("pause recurring: %w", domain.ErrRecurringCancelled)
	}
	if cfg.Status != "active" {
		return nil, fmt.Errorf("pause recurring: %w", domain.ErrRecurringNotActive)
	}

	now := time.Now().UTC()
	max := now.AddDate(0, 0, recurringMaxPauseDays)
	cfg.Status = "paused"
	cfg.PausedAt = &now
	cfg.PauseMaxDate = &max

	updated, err := s.contractRepo.UpdateRecurringConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("pause recurring: %w", err)
	}
	slog.Info("recurring paused", "recurring_id", recurringID, "user_id", userID, "pause_max", max)
	return updated, nil
}

// ResumeRecurring resumes a paused config (FR-18.6).
func (s *ContractService) ResumeRecurring(ctx context.Context, recurringID, userID string) (*domain.RecurringConfig, error) {
	cfg, err := s.contractRepo.GetRecurringConfigByID(ctx, recurringID)
	if err != nil {
		return nil, fmt.Errorf("resume recurring: %w", err)
	}
	if _, err := s.requireContractParty(ctx, cfg.ContractID, userID); err != nil {
		return nil, fmt.Errorf("resume recurring: %w", err)
	}
	cfg, err = s.maybeExpirePaused(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("resume recurring: %w", err)
	}
	if cfg.Status == "cancelled" {
		return nil, fmt.Errorf("resume recurring: %w", domain.ErrRecurringCancelled)
	}
	if cfg.Status != "paused" {
		return nil, fmt.Errorf("resume recurring: %w", domain.ErrRecurringNotPaused)
	}

	cfg.Status = "active"
	cfg.PausedAt = nil
	cfg.PauseMaxDate = nil

	updated, err := s.contractRepo.UpdateRecurringConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("resume recurring: %w", err)
	}
	slog.Info("recurring resumed", "recurring_id", recurringID, "user_id", userID)
	return updated, nil
}

// CancelRecurring cancels with 1-occurrence notice (FR-18.5). notice_period_end
// is set to next_occurrence; status becomes cancelled so no further generation.
func (s *ContractService) CancelRecurring(ctx context.Context, recurringID, userID string) (*domain.RecurringConfig, error) {
	cfg, err := s.contractRepo.GetRecurringConfigByID(ctx, recurringID)
	if err != nil {
		return nil, fmt.Errorf("cancel recurring: %w", err)
	}
	if _, err := s.requireContractParty(ctx, cfg.ContractID, userID); err != nil {
		return nil, fmt.Errorf("cancel recurring: %w", err)
	}
	if cfg.Status == "cancelled" {
		return nil, fmt.Errorf("cancel recurring: %w", domain.ErrRecurringCancelled)
	}

	now := time.Now().UTC()
	notice := cfg.NextOccurrence
	if notice.Before(now) {
		// If next occurrence is already past, notice ends today.
		y, m, d := now.Date()
		notice = time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	}
	cfg.Status = "cancelled"
	cfg.CancelledAt = &now
	cfg.CancelledBy = &userID
	cfg.NoticePeriodEnd = &notice
	cfg.PausedAt = nil
	cfg.PauseMaxDate = nil

	updated, err := s.contractRepo.UpdateRecurringConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("cancel recurring: %w", err)
	}
	slog.Info("recurring cancelled", "recurring_id", recurringID, "user_id", userID, "notice_end", notice)
	return updated, nil
}

// ListRecurringInstances lists occurrences for a contract's recurring config.
// Accepts either contract_id lookup path (gateway) after resolving config.
// Lazy roll-forward: for active configs, create up to 4 upcoming scheduled
// instances when next_occurrence is due (FR-18.1 generator without a cron).
func (s *ContractService) ListRecurringInstances(
	ctx context.Context,
	recurringID, requestingUserID string,
	page, pageSize int,
) ([]*domain.RecurringInstance, *domain.Pagination, error) {
	cfg, err := s.contractRepo.GetRecurringConfigByID(ctx, recurringID)
	if err != nil {
		return nil, nil, fmt.Errorf("list recurring instances: %w", err)
	}
	if _, err := s.requireContractParty(ctx, cfg.ContractID, requestingUserID); err != nil {
		return nil, nil, fmt.Errorf("list recurring instances: %w", err)
	}
	cfg, err = s.maybeExpirePaused(ctx, cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("list recurring instances: %w", err)
	}
	if rollErr := s.ensureUpcomingRecurringInstances(ctx, cfg); rollErr != nil {
		// Fail-soft: still return existing rows.
		slog.Warn("recurring roll-forward failed",
			"recurring_id", recurringID, "error", rollErr)
	}
	instances, pagination, err := s.contractRepo.ListRecurringInstances(ctx, recurringID, page, pageSize)
	if err != nil {
		return nil, nil, fmt.Errorf("list recurring instances: %w", err)
	}
	return instances, pagination, nil
}

// ensureUpcomingRecurringInstances creates scheduled instances for dates that
// should already exist (next_occurrence ≤ today+horizon) up to maxGenerate.
// Idempotent: skips dates that already have a row (unique by occurrence_date if
// enforced; otherwise we scan the list).
func (s *ContractService) ensureUpcomingRecurringInstances(ctx context.Context, cfg *domain.RecurringConfig) error {
	if cfg == nil || cfg.Status != "active" {
		return nil
	}
	if cfg.NoticePeriodEnd != nil && !time.Now().UTC().Before(*cfg.NoticePeriodEnd) {
		// Past notice after cancel path — do not generate.
		return nil
	}
	const maxGenerate = 4
	const horizonDays = 90

	existing, _, err := s.contractRepo.ListRecurringInstances(ctx, cfg.ID, 1, 200)
	if err != nil {
		return fmt.Errorf("list for roll-forward: %w", err)
	}
	have := make(map[string]struct{}, len(existing))
	for _, inst := range existing {
		if inst == nil {
			continue
		}
		have[inst.OccurrenceDate.UTC().Format("2006-01-02")] = struct{}{}
	}

	today := time.Now().UTC()
	y, m, d := today.Date()
	cursor := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	// Start from next_occurrence if it's in the future of last known date.
	if !cfg.NextOccurrence.IsZero() {
		n := dateOnlyUTC(cfg.NextOccurrence)
		if n.Before(cursor) {
			// Catch up from next_occurrence while still generating future slots.
			cursor = n
		} else {
			cursor = n
		}
	}

	horizon := time.Date(y, m, d, 0, 0, 0, 0, time.UTC).AddDate(0, 0, horizonDays)
	created := 0
	nextAfter := cfg.NextOccurrence
	for created < maxGenerate && !cursor.After(horizon) {
		key := cursor.Format("2006-01-02")
		if _, ok := have[key]; !ok {
			_, cerr := s.contractRepo.CreateRecurringInstance(ctx, &domain.RecurringInstance{
				RecurringID:    cfg.ID,
				ContractID:     cfg.ContractID,
				OccurrenceDate: cursor,
				Status:         "scheduled",
				AmountCents:    cfg.RateCents,
			})
			if cerr != nil {
				// Unique violation on duplicate date is fine — continue.
				slog.Debug("recurring instance create skip",
					"recurring_id", cfg.ID, "date", key, "error", cerr)
			} else {
				have[key] = struct{}{}
				created++
			}
		}
		nextAfter = nextOccurrenceFrom(cursor, cfg.Frequency)
		cursor = nextAfter
	}

	// Advance next_occurrence to the first date without an instance or beyond horizon.
	if !nextAfter.IsZero() && (cfg.NextOccurrence.IsZero() || nextAfter.After(cfg.NextOccurrence)) {
		cfg.NextOccurrence = nextAfter
		if _, uerr := s.contractRepo.UpdateRecurringConfig(ctx, cfg); uerr != nil {
			return fmt.Errorf("advance next_occurrence: %w", uerr)
		}
	}
	if created > 0 {
		slog.Info("recurring roll-forward created instances",
			"recurring_id", cfg.ID, "created", created, "next", cfg.NextOccurrence)
	}
	return nil
}

func dateOnlyUTC(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// CompleteRecurringInstance marks an occurrence complete (provider only).
func (s *ContractService) CompleteRecurringInstance(ctx context.Context, instanceID, providerID string) (*domain.RecurringInstance, error) {
	inst, err := s.contractRepo.GetRecurringInstance(ctx, instanceID)
	if err != nil {
		return nil, fmt.Errorf("complete recurring instance: %w", err)
	}
	contract, err := s.contractRepo.GetContract(ctx, inst.ContractID)
	if err != nil {
		return nil, fmt.Errorf("complete recurring instance: %w", err)
	}
	if contract.ProviderID != providerID {
		return nil, fmt.Errorf("complete recurring instance: %w", domain.ErrNotContractParty)
	}
	if inst.Status != "scheduled" && inst.Status != "in_progress" {
		return nil, fmt.Errorf("complete recurring instance: %w", domain.ErrRecurringInstanceState)
	}

	now := time.Now().UTC()
	inst.Status = "completed"
	inst.CompletedAt = &now

	// Auto-approve if configured (FR-18.3) — marks approved without payment wire.
	cfg, cfgErr := s.contractRepo.GetRecurringConfigByID(ctx, inst.RecurringID)
	if cfgErr == nil && cfg.AutoApprove {
		inst.ApprovedAt = &now
		inst.AutoApproved = true
	}

	updated, err := s.contractRepo.UpdateRecurringInstance(ctx, inst)
	if err != nil {
		return nil, fmt.Errorf("complete recurring instance: %w", err)
	}
	slog.Info("recurring instance completed",
		"instance_id", instanceID, "provider_id", providerID, "auto_approved", updated.AutoApproved,
	)
	return updated, nil
}

// ApproveRecurringInstance marks a completed occurrence approved by the customer.
// Payment creation is residual (returns empty payment id from gRPC layer) —
// status/approval timestamps are the durable record for FR-18.2.
func (s *ContractService) ApproveRecurringInstance(ctx context.Context, instanceID, customerID string) (*domain.RecurringInstance, error) {
	inst, err := s.contractRepo.GetRecurringInstance(ctx, instanceID)
	if err != nil {
		return nil, fmt.Errorf("approve recurring instance: %w", err)
	}
	contract, err := s.contractRepo.GetContract(ctx, inst.ContractID)
	if err != nil {
		return nil, fmt.Errorf("approve recurring instance: %w", err)
	}
	if contract.CustomerID != customerID {
		return nil, fmt.Errorf("approve recurring instance: %w", domain.ErrNotContractParty)
	}
	if inst.Status != "completed" {
		return nil, fmt.Errorf("approve recurring instance: %w", domain.ErrRecurringInstanceState)
	}
	if inst.ApprovedAt != nil {
		// Idempotent success: already approved.
		return inst, nil
	}

	now := time.Now().UTC()
	inst.ApprovedAt = &now
	inst.AutoApproved = false

	updated, err := s.contractRepo.UpdateRecurringInstance(ctx, inst)
	if err != nil {
		return nil, fmt.Errorf("approve recurring instance: %w", err)
	}
	slog.Info("recurring instance approved", "instance_id", instanceID, "customer_id", customerID)
	return updated, nil
}

// ensureRecurringConfigForActiveContract creates a recurring_configs row (+ first
// scheduled instance) when a newly-activated contract belongs to a recurring job.
// Best-effort: failures are logged by the caller and never block accept.
func (s *ContractService) ensureRecurringConfigForActiveContract(ctx context.Context, contract *domain.Contract) error {
	if contract == nil || contract.Status != "active" {
		return nil
	}
	// Already configured?
	existing, err := s.contractRepo.GetRecurringConfigByContract(ctx, contract.ID)
	if err == nil && existing != nil {
		return nil
	}
	if err != nil && !errors.Is(err, domain.ErrRecurringNotFound) {
		return fmt.Errorf("ensure recurring: lookup: %w", err)
	}

	if s.jobRepo == nil {
		return nil
	}
	job, err := s.jobRepo.GetJob(ctx, contract.JobID)
	if err != nil {
		return fmt.Errorf("ensure recurring: get job: %w", err)
	}
	if !job.IsRecurring {
		return nil
	}

	freq := "monthly"
	if job.RecurrenceFrequency != nil && *job.RecurrenceFrequency != "" {
		freq = *job.RecurrenceFrequency
	}
	if !validRecurrenceFrequency(freq) {
		return fmt.Errorf("ensure recurring: %w", domain.ErrRecurringInvalidFrequency)
	}
	if contract.AmountCents <= 0 {
		return fmt.Errorf("ensure recurring: %w", domain.ErrRecurringInvalidRate)
	}

	next := nextOccurrenceFrom(time.Now().UTC(), freq)
	cfg := &domain.RecurringConfig{
		ContractID:     contract.ID,
		Frequency:      freq,
		RateCents:      contract.AmountCents,
		AutoApprove:    false,
		Status:         "active",
		NextOccurrence: next,
	}
	created, err := s.contractRepo.CreateRecurringConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("ensure recurring: create config: %w", err)
	}

	// Seed the first scheduled instance so ListRecurringInstances is useful
	// before a background generator exists (scheduler residual).
	_, err = s.contractRepo.CreateRecurringInstance(ctx, &domain.RecurringInstance{
		RecurringID:    created.ID,
		ContractID:     contract.ID,
		OccurrenceDate: next,
		Status:         "scheduled",
		AmountCents:    created.RateCents,
	})
	if err != nil {
		return fmt.Errorf("ensure recurring: create first instance: %w", err)
	}

	// Align contract payment_timing for recurring jobs when still "completion".
	// Not a hard requirement of the schema; leave payment_timing as awarded.

	slog.Info("recurring config created on contract activation",
		"contract_id", contract.ID, "recurring_id", created.ID, "frequency", freq,
	)
	return nil
}

func (s *ContractService) requireContractParty(ctx context.Context, contractID, userID string) (*domain.Contract, error) {
	contract, err := s.contractRepo.GetContract(ctx, contractID)
	if err != nil {
		return nil, err
	}
	if userID != "" &&
		contract.CustomerID != userID &&
		contract.ProviderID != userID {
		return nil, domain.ErrNotContractParty
	}
	return contract, nil
}

func (s *ContractService) maybeExpirePaused(ctx context.Context, cfg *domain.RecurringConfig) (*domain.RecurringConfig, error) {
	if cfg == nil {
		return nil, domain.ErrRecurringNotFound
	}
	if cfg.Status != "paused" || cfg.PauseMaxDate == nil {
		return cfg, nil
	}
	if time.Now().UTC().Before(*cfg.PauseMaxDate) {
		return cfg, nil
	}
	// FR-18.6: auto-cancel after max pause.
	now := time.Now().UTC()
	cfg.Status = "cancelled"
	cfg.CancelledAt = &now
	cfg.PausedAt = nil
	// leave CancelledBy nil (system)
	updated, err := s.contractRepo.UpdateRecurringConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("auto-cancel expired pause: %w", err)
	}
	slog.Info("recurring auto-cancelled after max pause", "recurring_id", cfg.ID)
	return updated, nil
}

func validRecurrenceFrequency(f string) bool {
	switch f {
	case "weekly", "biweekly", "monthly":
		return true
	default:
		return false
	}
}

func nextOccurrenceFrom(from time.Time, frequency string) time.Time {
	y, m, d := from.UTC().Date()
	base := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	switch frequency {
	case "weekly":
		return base.AddDate(0, 0, 7)
	case "biweekly":
		return base.AddDate(0, 0, 14)
	default: // monthly
		return base.AddDate(0, 1, 0)
	}
}
