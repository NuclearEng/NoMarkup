package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// ContractService implements contract business logic.
type ContractService struct {
	contractRepo domain.ContractRepository
	jobRepo      domain.JobRepository
	// pendingTerms applies chat-accepted local terms when the contract is
	// created after a pre-award Accept (FR-5.4 residual). Nil = skip.
	pendingTerms PendingLocalTermsApplier
}

// NewContractService creates a new contract service.
func NewContractService(contractRepo domain.ContractRepository, jobRepo domain.JobRepository) *ContractService {
	return &ContractService{
		contractRepo: contractRepo,
		jobRepo:      jobRepo,
	}
}

// SetPendingLocalTermsApplier wires FR-5.4 residual: apply pre-award accepted
// chat local terms onto the new contract. Optional; nil keeps award path only.
func (s *ContractService) SetPendingLocalTermsApplier(a PendingLocalTermsApplier) {
	s.pendingTerms = a
}

// CreateContractFromAward creates a contract from a bid award.
func (s *ContractService) CreateContractFromAward(
	ctx context.Context,
	jobID, bidID, customerID, providerID string,
	amountCents int64,
	paymentTiming string,
	milestones []domain.MilestoneInput,
) (*domain.Contract, error) {
	contract := &domain.Contract{
		JobID:              jobID,
		CustomerID:         customerID,
		ProviderID:         providerID,
		BidID:              bidID,
		AmountCents:        amountCents,
		PaymentTiming:      paymentTiming,
		Status:             "pending_acceptance",
		CustomerAccepted:   false,
		ProviderAccepted:   false,
		AcceptanceDeadline: timePtr(time.Now().Add(72 * time.Hour)),
	}

	// If no milestones provided, create a single milestone for the full amount.
	if len(milestones) == 0 {
		milestones = []domain.MilestoneInput{
			{
				Description: "Complete work",
				AmountCents: amountCents,
			},
		}
	}

	created, err := s.contractRepo.CreateContract(ctx, contract, milestones)
	if err != nil {
		return nil, fmt.Errorf("create contract from award: %w", err)
	}

	// Update job status to contract_pending.
	if err := s.contractRepo.UpdateJobStatus(ctx, jobID, "contract_pending"); err != nil {
		slog.Warn("failed to update job status to contract_pending", "job_id", jobID, "error", err)
	}

	// FR-5.4 residual: customer may have accepted proposed terms in chat
	// before this contract existed. Bind them now. Fail soft — award must
	// never fail because terms re-apply failed.
	created = s.applyPendingLocalTermsSoft(ctx, created)

	slog.Info("contract created from award",
		"contract_id", created.ID,
		"job_id", jobID,
		"bid_id", bidID,
		"amount_cents", amountCents,
		"payment_timing", created.PaymentTiming,
	)

	return created, nil
}

// applyPendingLocalTermsSoft runs PendingLocalTermsApplier after award.
// Never returns an error to the award path; logs and returns the original
// contract when apply fails or is a no-op.
func (s *ContractService) applyPendingLocalTermsSoft(ctx context.Context, created *domain.Contract) *domain.Contract {
	if s.pendingTerms == nil || created == nil {
		return created
	}
	boundID, err := s.pendingTerms.ApplyPendingLocalTerms(
		ctx, created.JobID, created.CustomerID, created.ProviderID,
	)
	if err != nil {
		slog.Warn("pending local terms apply failed after award (fail-soft)",
			"contract_id", created.ID,
			"job_id", created.JobID,
			"customer_id", created.CustomerID,
			"provider_id", created.ProviderID,
			"error", err,
		)
		return created
	}
	if boundID == "" {
		return created
	}
	// Re-load so response reflects payment_timing / terms_json bind.
	updated, err := s.contractRepo.GetContract(ctx, created.ID)
	if err != nil {
		slog.Warn("pending local terms applied but re-fetch failed",
			"contract_id", created.ID,
			"bound_contract_id", boundID,
			"error", err,
		)
		return created
	}
	slog.Info("pending local terms applied after award",
		"contract_id", updated.ID,
		"job_id", updated.JobID,
		"payment_timing", updated.PaymentTiming,
	)
	return updated
}

// AcceptContract validates user is party and within deadline, then accepts.
func (s *ContractService) AcceptContract(ctx context.Context, contractID, userID string) (*domain.Contract, error) {
	contract, err := s.contractRepo.GetContract(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("accept contract: %w", err)
	}

	// Validate user is a party to the contract.
	isCustomer := contract.CustomerID == userID
	isProvider := contract.ProviderID == userID
	if !isCustomer && !isProvider {
		return nil, fmt.Errorf("accept contract: %w", domain.ErrNotContractParty)
	}

	// Check if already accepted by this party.
	if isCustomer && contract.CustomerAccepted {
		return nil, fmt.Errorf("accept contract: %w", domain.ErrAlreadyAccepted)
	}
	if isProvider && contract.ProviderAccepted {
		return nil, fmt.Errorf("accept contract: %w", domain.ErrAlreadyAccepted)
	}

	// Validate within deadline.
	if contract.AcceptanceDeadline != nil && time.Now().After(*contract.AcceptanceDeadline) {
		return nil, fmt.Errorf("accept contract: %w", domain.ErrDeadlineExpired)
	}

	updated, err := s.contractRepo.AcceptContract(ctx, contractID, userID, isCustomer)
	if err != nil {
		return nil, fmt.Errorf("accept contract: %w", err)
	}

	// If contract is now active, update job status and seed FR-18 recurring config
	// when the underlying job was posted as is_recurring.
	if updated.Status == "active" {
		if err := s.contractRepo.UpdateJobStatus(ctx, updated.JobID, "in_progress"); err != nil {
			slog.Warn("failed to update job status to in_progress", "job_id", updated.JobID, "error", err)
		}
		if err := s.ensureRecurringConfigForActiveContract(ctx, updated); err != nil {
			slog.Warn("failed to ensure recurring config on accept",
				"contract_id", contractID, "job_id", updated.JobID, "error", err)
		}
	}

	slog.Info("contract accepted", "contract_id", contractID, "user_id", userID, "status", updated.Status)
	return updated, nil
}

// StartWork validates provider and starts work on the contract.
func (s *ContractService) StartWork(ctx context.Context, contractID, providerID string) (*domain.Contract, error) {
	contract, err := s.contractRepo.GetContract(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("start work: %w", err)
	}

	if contract.ProviderID != providerID {
		return nil, fmt.Errorf("start work: %w", domain.ErrNotContractParty)
	}

	if contract.Status != "active" {
		return nil, fmt.Errorf("start work: %w", domain.ErrContractNotActive)
	}

	updated, err := s.contractRepo.StartWork(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("start work: %w", err)
	}

	slog.Info("work started", "contract_id", contractID, "provider_id", providerID)
	return updated, nil
}

// GetContract retrieves a contract, validating the requesting user is a party.
func (s *ContractService) GetContract(ctx context.Context, contractID, requestingUserID string) (*domain.Contract, error) {
	contract, err := s.contractRepo.GetContract(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("get contract: %w", err)
	}

	if requestingUserID != "" &&
		contract.CustomerID != requestingUserID &&
		contract.ProviderID != requestingUserID {
		return nil, fmt.Errorf("get contract: %w", domain.ErrNotContractParty)
	}

	return contract, nil
}

// ListContracts lists contracts for a user.
func (s *ContractService) ListContracts(ctx context.Context, userID string, statusFilter *string, page, pageSize int) ([]*domain.Contract, *domain.Pagination, error) {
	contracts, pagination, err := s.contractRepo.ListContracts(ctx, userID, statusFilter, page, pageSize)
	if err != nil {
		return nil, nil, fmt.Errorf("list contracts: %w", err)
	}
	return contracts, pagination, nil
}

// SubmitMilestone validates the provider is a party and submits the milestone.
func (s *ContractService) SubmitMilestone(ctx context.Context, milestoneID, providerID string) (*domain.Milestone, error) {
	milestone, err := s.contractRepo.GetMilestone(ctx, milestoneID)
	if err != nil {
		return nil, fmt.Errorf("submit milestone: %w", err)
	}

	// Validate provider is party to the contract.
	contract, err := s.contractRepo.GetContract(ctx, milestone.ContractID)
	if err != nil {
		return nil, fmt.Errorf("submit milestone: %w", err)
	}
	if contract.ProviderID != providerID {
		return nil, fmt.Errorf("submit milestone: %w", domain.ErrNotContractParty)
	}

	updated, err := s.contractRepo.SubmitMilestone(ctx, milestoneID)
	if err != nil {
		return nil, fmt.Errorf("submit milestone: %w", err)
	}

	slog.Info("milestone submitted", "milestone_id", milestoneID, "provider_id", providerID)
	return updated, nil
}

// ApproveMilestone validates the customer is a party and approves the milestone.
func (s *ContractService) ApproveMilestone(ctx context.Context, milestoneID, customerID string) (*domain.Milestone, error) {
	milestone, err := s.contractRepo.GetMilestone(ctx, milestoneID)
	if err != nil {
		return nil, fmt.Errorf("approve milestone: %w", err)
	}

	contract, err := s.contractRepo.GetContract(ctx, milestone.ContractID)
	if err != nil {
		return nil, fmt.Errorf("approve milestone: %w", err)
	}
	if contract.CustomerID != customerID {
		return nil, fmt.Errorf("approve milestone: %w", domain.ErrNotContractParty)
	}

	updated, err := s.contractRepo.ApproveMilestone(ctx, milestoneID)
	if err != nil {
		return nil, fmt.Errorf("approve milestone: %w", err)
	}

	slog.Info("milestone approved", "milestone_id", milestoneID, "customer_id", customerID)
	return updated, nil
}

// RequestRevision validates the customer and requests a revision.
func (s *ContractService) RequestRevision(ctx context.Context, milestoneID, customerID, notes string) (*domain.Milestone, error) {
	milestone, err := s.contractRepo.GetMilestone(ctx, milestoneID)
	if err != nil {
		return nil, fmt.Errorf("request revision: %w", err)
	}

	contract, err := s.contractRepo.GetContract(ctx, milestone.ContractID)
	if err != nil {
		return nil, fmt.Errorf("request revision: %w", err)
	}
	if contract.CustomerID != customerID {
		return nil, fmt.Errorf("request revision: %w", domain.ErrNotContractParty)
	}

	updated, err := s.contractRepo.RequestRevision(ctx, milestoneID, notes)
	if err != nil {
		return nil, fmt.Errorf("request revision: %w", err)
	}

	slog.Info("revision requested", "milestone_id", milestoneID, "customer_id", customerID)
	return updated, nil
}

// MarkComplete validates all milestones are approved (for milestone payment timing) and marks the contract complete.
func (s *ContractService) MarkComplete(ctx context.Context, contractID, providerID string) (*domain.Contract, error) {
	contract, err := s.contractRepo.GetContract(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("mark complete: %w", err)
	}

	// The "providerID" param is the authenticated caller's user ID. Only the
	// provider may mark a contract complete. Distinguish the customer (who IS a
	// party, but lacks this permission) from a true non-party: the customer gets
	// a clear "only the provider can complete" message rather than the
	// misleading "not a party to this contract".
	if contract.ProviderID != providerID {
		if contract.CustomerID == providerID {
			return nil, fmt.Errorf("mark complete: %w", domain.ErrNotContractProvider)
		}
		return nil, fmt.Errorf("mark complete: %w", domain.ErrNotContractParty)
	}

	if contract.Status != "active" {
		return nil, fmt.Errorf("mark complete: %w", domain.ErrContractNotActive)
	}

	// For milestone payment timing, validate all milestones are approved.
	if contract.PaymentTiming == "milestone" {
		for _, m := range contract.Milestones {
			if m.Status != "approved" {
				return nil, fmt.Errorf("mark complete: %w", domain.ErrMilestonesNotApproved)
			}
		}
	}

	updated, err := s.contractRepo.MarkComplete(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("mark complete: %w", err)
	}

	// Do NOT move the job to "completed" here. The provider has only marked
	// work done; the contract is still active and awaiting customer approval
	// (or 7-day auto-release). The job is finalised to "completed" in
	// ApproveCompletion, when escrow would release. Marking it completed now
	// would diverge the job from a still-active contract and let the customer
	// see a finished job while the approval step is still pending.

	slog.Info("contract marked complete by provider, awaiting customer approval",
		"contract_id", contractID, "provider_id", providerID)
	return updated, nil
}

// ApproveCompletion approves the completion of a contract by the customer.
func (s *ContractService) ApproveCompletion(ctx context.Context, contractID, customerID string) (*domain.Contract, error) {
	contract, err := s.contractRepo.GetContract(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("approve completion: %w", err)
	}

	if contract.CustomerID != customerID {
		return nil, fmt.Errorf("approve completion: %w", domain.ErrNotContractParty)
	}

	if contract.Status != "active" {
		return nil, fmt.Errorf("approve completion: %w", domain.ErrContractNotActive)
	}

	updated, err := s.contractRepo.ApproveCompletion(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("approve completion: %w", err)
	}

	// Update job status.
	if err := s.contractRepo.UpdateJobStatus(ctx, updated.JobID, "completed"); err != nil {
		slog.Warn("failed to update job status to completed", "job_id", updated.JobID, "error", err)
	}

	slog.Info("contract completion approved", "contract_id", contractID, "customer_id", customerID)
	return updated, nil
}

// AutoReleaseCompletedContracts finds contracts where the provider marked complete
// more than 7 days ago without customer action and auto-approves them.
func (s *ContractService) AutoReleaseCompletedContracts(ctx context.Context) error {
	contracts, err := s.contractRepo.GetContractsAwaitingApproval(ctx, 7*24*time.Hour)
	if err != nil {
		return fmt.Errorf("auto release: %w", err)
	}

	for _, c := range contracts {
		// Finalise the contract first (active+completed_at → completed), the
		// same terminal transition a customer approval performs. Without this
		// the contract would stay 'active' forever and be re-selected on every
		// sweep. Only after the contract is terminal do we finalise the job.
		if _, err := s.contractRepo.ApproveCompletion(ctx, c.ID); err != nil {
			slog.Warn("auto release: failed to complete contract",
				"contract_id", c.ID,
				"job_id", c.JobID,
				"error", err,
			)
			continue
		}
		if err := s.contractRepo.UpdateJobCompleted(ctx, c.JobID); err != nil {
			slog.Warn("auto release: failed to update job completed",
				"contract_id", c.ID,
				"job_id", c.JobID,
				"error", err,
			)
			continue
		}
		slog.Info("auto released contract",
			"contract_id", c.ID,
			"job_id", c.JobID,
		)
	}

	return nil
}

// --- Change Order Methods ---

// ProposeChangeOrder lets the provider propose a scope/price change on an active
// contract. Only the provider may propose; the contract must be active. The
// delta is validated server-side (integer cents): it must be non-zero, and the
// resulting contract amount must stay strictly positive and within a sane bound
// (no absurd values). The amount math is never trusted to the client.
func (s *ContractService) ProposeChangeOrder(
	ctx context.Context,
	contractID, proposedBy, description string,
	amountDeltaCents int64,
) (*domain.ChangeOrder, error) {
	contract, err := s.contractRepo.GetContract(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("propose change order: %w", err)
	}

	// Only the provider may propose a change order. A customer is a party but
	// lacks this permission; a true non-party gets the not-a-party error.
	if contract.ProviderID != proposedBy {
		if contract.CustomerID == proposedBy {
			return nil, fmt.Errorf("propose change order: %w", domain.ErrChangeOrderNotProposer)
		}
		return nil, fmt.Errorf("propose change order: %w", domain.ErrNotContractParty)
	}

	if contract.Status != "active" {
		return nil, fmt.Errorf("propose change order: %w", domain.ErrContractNotActive)
	}

	// Validate the delta server-side. Reject a no-op (zero) delta, a delta that
	// would drive the contract to zero/negative, and absurd magnitudes. The
	// upper bound (1 trillion cents = $10B) guards against overflow/typos.
	const maxAmountCents int64 = 1_000_000_000_000
	if amountDeltaCents == 0 {
		return nil, fmt.Errorf("propose change order: %w", domain.ErrInvalidChangeOrderDelta)
	}
	if amountDeltaCents < -maxAmountCents || amountDeltaCents > maxAmountCents {
		return nil, fmt.Errorf("propose change order: %w", domain.ErrInvalidChangeOrderDelta)
	}
	newAmount := contract.AmountCents + amountDeltaCents
	if newAmount <= 0 || newAmount > maxAmountCents {
		return nil, fmt.Errorf("propose change order: %w", domain.ErrInvalidChangeOrderDelta)
	}

	order := &domain.ChangeOrder{
		ContractID:       contractID,
		ProposedBy:       proposedBy,
		Description:      description,
		AmountDeltaCents: amountDeltaCents,
		Status:           "proposed",
	}

	created, err := s.contractRepo.CreateChangeOrder(ctx, order)
	if err != nil {
		return nil, fmt.Errorf("propose change order: %w", err)
	}

	slog.Info("change order proposed",
		"change_order_id", created.ID,
		"contract_id", contractID,
		"proposed_by", proposedBy,
		"amount_delta_cents", amountDeltaCents,
	)
	return created, nil
}

// RespondToChangeOrder lets the customer accept or reject a proposed change
// order. Only the customer may respond. On accept, the contract amount and the
// single-milestone amount are adjusted by the delta atomically in the repo; the
// status guard there makes a double-accept a clean ErrChangeOrderNotPending
// (409). On reject, no money moves.
func (s *ContractService) RespondToChangeOrder(
	ctx context.Context,
	changeOrderID, userID string,
	accepted bool,
) (*domain.ChangeOrder, error) {
	order, err := s.contractRepo.GetChangeOrder(ctx, changeOrderID)
	if err != nil {
		return nil, fmt.Errorf("respond to change order: %w", err)
	}

	contract, err := s.contractRepo.GetContract(ctx, order.ContractID)
	if err != nil {
		return nil, fmt.Errorf("respond to change order: %w", err)
	}

	// Only the customer may respond. The provider proposed it; letting them
	// also approve would let one party unilaterally change the contract amount.
	if contract.CustomerID != userID {
		if contract.ProviderID == userID {
			return nil, fmt.Errorf("respond to change order: %w", domain.ErrChangeOrderNotResponder)
		}
		return nil, fmt.Errorf("respond to change order: %w", domain.ErrNotContractParty)
	}

	// Guard at the service layer too (the repo also guards atomically): a change
	// order that is not still proposed cannot be responded to.
	if order.Status != "proposed" {
		return nil, fmt.Errorf("respond to change order: %w", domain.ErrChangeOrderNotPending)
	}

	var updated *domain.ChangeOrder
	if accepted {
		updated, err = s.contractRepo.AcceptChangeOrder(ctx, changeOrderID)
	} else {
		updated, err = s.contractRepo.RejectChangeOrder(ctx, changeOrderID)
	}
	if err != nil {
		return nil, fmt.Errorf("respond to change order: %w", err)
	}

	slog.Info("change order responded",
		"change_order_id", changeOrderID,
		"contract_id", order.ContractID,
		"user_id", userID,
		"accepted", accepted,
		"status", updated.Status,
	)
	return updated, nil
}

// --- Dispute Methods ---

// OpenDispute creates a new dispute against a contract.
func (s *ContractService) OpenDispute(
	ctx context.Context,
	contractID, openedBy, disputeType, description string,
	evidenceURLs []string,
	isGuaranteeClaim bool,
) (*domain.Dispute, error) {
	// Validate that the contract exists.
	contract, err := s.contractRepo.GetContract(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("open dispute: %w", err)
	}

	// Validate the user is a party to the contract.
	if contract.CustomerID != openedBy && contract.ProviderID != openedBy {
		return nil, fmt.Errorf("open dispute: %w", domain.ErrNotContractParty)
	}

	// Validate the contract is in a disputable status.
	if contract.Status != "active" && contract.Status != "completed" {
		return nil, fmt.Errorf("open dispute: %w", domain.ErrInvalidStatusTransition)
	}
	// A NoMarkup Guarantee claim covers delivered work, so it requires a
	// COMPLETED contract. A regular mid-job dispute may be opened while active,
	// but a guarantee claim on an active, never-completed contract is invalid.
	if isGuaranteeClaim && contract.Status != "completed" {
		return nil, fmt.Errorf("open dispute: %w", domain.ErrGuaranteeNotCompleted)
	}

	dispute := &domain.Dispute{
		ContractID:       contractID,
		OpenedBy:         openedBy,
		DisputeType:      disputeType,
		Description:      description,
		EvidenceURLs:     evidenceURLs,
		Status:           "open",
		IsGuaranteeClaim: isGuaranteeClaim,
	}

	created, err := s.contractRepo.CreateDispute(ctx, dispute)
	if err != nil {
		return nil, fmt.Errorf("open dispute: %w", err)
	}

	// Update contract status to "disputed".
	if err := s.contractRepo.UpdateContractStatus(ctx, contractID, "disputed"); err != nil {
		slog.Warn("failed to update contract status to disputed",
			"contract_id", contractID,
			"error", err,
		)
	}

	slog.Info("dispute opened",
		"dispute_id", created.ID,
		"contract_id", contractID,
		"opened_by", openedBy,
		"dispute_type", disputeType,
		"is_guarantee_claim", isGuaranteeClaim,
	)

	return created, nil
}

// GetDispute retrieves a dispute by ID.
func (s *ContractService) GetDispute(ctx context.Context, disputeID string) (*domain.Dispute, error) {
	dispute, err := s.contractRepo.GetDispute(ctx, disputeID)
	if err != nil {
		return nil, fmt.Errorf("get dispute: %w", err)
	}
	return dispute, nil
}

// ListDisputes lists disputes with optional filters.
func (s *ContractService) ListDisputes(ctx context.Context, contractID *string, userID *string, status *string, isGuaranteeClaim *bool, page, pageSize int) ([]*domain.Dispute, *domain.Pagination, error) {
	disputes, pagination, err := s.contractRepo.ListDisputes(ctx, contractID, userID, status, isGuaranteeClaim, page, pageSize)
	if err != nil {
		return nil, nil, fmt.Errorf("list disputes: %w", err)
	}
	return disputes, pagination, nil
}

// normalizeResolutionType maps the resolution type a client may send to the
// canonical value the `disputes.resolution_type` CHECK constraint accepts.
//
// The admin UI speaks in dispute-outcome terms (favor_customer / favor_provider
// / split), while the database column stores money-movement terms
// (full_refund / release_payment / partial_refund / ...). We translate the
// former and pass the latter through unchanged, so both vocabularies are valid
// inputs and an unknown value is rejected as a clean 4xx rather than blowing up
// on a constraint violation (SQLSTATE 23514).
func normalizeResolutionType(rt string) (string, error) {
	switch rt {
	// Admin-UI outcome vocabulary.
	case "favor_customer":
		return "full_refund", nil
	case "favor_provider":
		return "release_payment", nil
	case "split":
		return "partial_refund", nil
	// Canonical DB vocabulary (pass-through).
	case "release_payment", "partial_refund", "full_refund",
		"contract_terminated", "dismissed", "guarantee_invoked":
		return rt, nil
	default:
		return "", fmt.Errorf("%w: %q", domain.ErrInvalidResolutionType, rt)
	}
}

// normalizeGuaranteeOutcome validates the optional guarantee outcome against the
// `disputes.guarantee_outcome` CHECK constraint. Empty is allowed (stored NULL).
func normalizeGuaranteeOutcome(go_ string) (string, error) {
	switch go_ {
	case "", "replacement_provider", "refund", "denied":
		return go_, nil
	default:
		return "", fmt.Errorf("%w: %q", domain.ErrInvalidGuaranteeOutcome, go_)
	}
}

// AdminResolveDispute resolves a dispute and logs an audit entry.
func (s *ContractService) AdminResolveDispute(
	ctx context.Context,
	disputeID, resolutionType, notes, adminID string,
	refundAmountCents int64,
	guaranteeOutcome string,
) (*domain.Dispute, error) {
	// Translate/validate inputs against the DB CHECK constraints before any DB
	// write, so a bad enum is a clean 400 rather than a 500.
	normalizedType, err := normalizeResolutionType(resolutionType)
	if err != nil {
		return nil, fmt.Errorf("admin resolve dispute: %w", err)
	}
	normalizedOutcome, err := normalizeGuaranteeOutcome(guaranteeOutcome)
	if err != nil {
		return nil, fmt.Errorf("admin resolve dispute: %w", err)
	}

	// Validate the dispute exists before resolving.
	existingDispute, err := s.contractRepo.GetDispute(ctx, disputeID)
	if err != nil {
		return nil, fmt.Errorf("admin resolve dispute: %w", err)
	}

	if existingDispute.Status == "resolved" || existingDispute.Status == "closed" {
		return nil, fmt.Errorf("admin resolve dispute: %w", domain.ErrDisputeAlreadyResolved)
	}

	// Money guard (CLAUDE.md §6 — all price calculations server-side, fail
	// closed). The admin-supplied payout is untrusted client input. Enforce
	// two invariants here, BEFORE the row is written, so neither a negative
	// payout nor a payout exceeding the covered contract amount can ever be
	// persisted — the guarantee can refund at most what was contracted, and
	// never a negative amount. The gateway clamps too, but this is the
	// authoritative check (the gateway is not the only possible caller).
	if refundAmountCents < 0 {
		return nil, fmt.Errorf("admin resolve dispute: %w: payout must be non-negative", domain.ErrInvalidGuaranteePayout)
	}
	if refundAmountCents > 0 {
		// Load the covered contract to read its amount cap. The dispute always
		// carries the contract id; a missing contract is a hard error rather
		// than an uncapped payout.
		coveredContract, cerr := s.contractRepo.GetContract(ctx, existingDispute.ContractID)
		if cerr != nil {
			return nil, fmt.Errorf("admin resolve dispute: load covered contract: %w", cerr)
		}
		if refundAmountCents > coveredContract.AmountCents {
			return nil, fmt.Errorf(
				"admin resolve dispute: %w: payout %d exceeds covered contract amount %d",
				domain.ErrInvalidGuaranteePayout, refundAmountCents, coveredContract.AmountCents,
			)
		}
	}

	resolved, err := s.contractRepo.ResolveDispute(ctx, disputeID, normalizedType, notes, adminID, refundAmountCents, normalizedOutcome)
	if err != nil {
		return nil, fmt.Errorf("admin resolve dispute: %w", err)
	}

	// Log audit entry.
	auditDetails := map[string]any{
		"dispute_id":         disputeID,
		"contract_id":        resolved.ContractID,
		"resolution_type":    resolutionType,
		"refund_amount_cents": refundAmountCents,
	}
	if guaranteeOutcome != "" {
		auditDetails["guarantee_outcome"] = guaranteeOutcome
	}

	if err := s.contractRepo.InsertAuditLog(ctx, adminID, "dispute_resolved", "dispute", disputeID, auditDetails); err != nil {
		slog.Warn("failed to insert audit log for dispute resolution",
			"dispute_id", disputeID,
			"admin_id", adminID,
			"error", err,
		)
	}

	slog.Info("dispute resolved by admin",
		"dispute_id", disputeID,
		"admin_id", adminID,
		"resolution_type", resolutionType,
		"refund_amount_cents", refundAmountCents,
	)

	return resolved, nil
}

// CancelContract cancels a contract.
func (s *ContractService) CancelContract(ctx context.Context, contractID, userID, reason string) (*domain.Contract, error) {
	contract, err := s.contractRepo.GetContract(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("cancel contract: %w", err)
	}

	if contract.CustomerID != userID && contract.ProviderID != userID {
		return nil, fmt.Errorf("cancel contract: %w", domain.ErrNotContractParty)
	}

	updated, err := s.contractRepo.CancelContract(ctx, contractID, userID, reason)
	if err != nil {
		return nil, fmt.Errorf("cancel contract: %w", err)
	}

	// Update job status back to awarded so the customer can re-award.
	if err := s.contractRepo.UpdateJobStatus(ctx, updated.JobID, "awarded"); err != nil {
		slog.Warn("failed to update job status on contract cancel", "job_id", updated.JobID, "error", err)
	}

	slog.Info("contract cancelled", "contract_id", contractID, "user_id", userID)
	return updated, nil
}

func timePtr(t time.Time) *time.Time { return &t }
