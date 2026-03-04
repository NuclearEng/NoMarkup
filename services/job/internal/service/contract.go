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
}

// NewContractService creates a new contract service.
func NewContractService(contractRepo domain.ContractRepository, jobRepo domain.JobRepository) *ContractService {
	return &ContractService{
		contractRepo: contractRepo,
		jobRepo:      jobRepo,
	}
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
		AcceptanceDeadline: time.Now().Add(72 * time.Hour),
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

	slog.Info("contract created from award",
		"contract_id", created.ID,
		"job_id", jobID,
		"bid_id", bidID,
		"amount_cents", amountCents,
	)

	return created, nil
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
	if time.Now().After(contract.AcceptanceDeadline) {
		return nil, fmt.Errorf("accept contract: %w", domain.ErrDeadlineExpired)
	}

	updated, err := s.contractRepo.AcceptContract(ctx, contractID, userID, isCustomer)
	if err != nil {
		return nil, fmt.Errorf("accept contract: %w", err)
	}

	// If contract is now active, update job status.
	if updated.Status == "active" {
		if err := s.contractRepo.UpdateJobStatus(ctx, updated.JobID, "in_progress"); err != nil {
			slog.Warn("failed to update job status to in_progress", "job_id", updated.JobID, "error", err)
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

	if contract.ProviderID != providerID {
		return nil, fmt.Errorf("mark complete: %w", domain.ErrNotContractParty)
	}

	if contract.Status != "active" {
		return nil, fmt.Errorf("mark complete: %w", domain.ErrContractNotActive)
	}

	// For milestone payment timing, validate all milestones are approved.
	if contract.PaymentTiming == "milestone" {
		for _, m := range contract.Milestones {
			if m.Status != "approved" {
				return nil, fmt.Errorf("mark complete: all milestones must be approved")
			}
		}
	}

	updated, err := s.contractRepo.MarkComplete(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("mark complete: %w", err)
	}

	// Update job status.
	if err := s.contractRepo.UpdateJobStatus(ctx, updated.JobID, "completed"); err != nil {
		slog.Warn("failed to update job status to completed", "job_id", updated.JobID, "error", err)
	}

	slog.Info("contract marked complete", "contract_id", contractID, "provider_id", providerID)
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
func (s *ContractService) ListDisputes(ctx context.Context, contractID *string, userID *string, status *string, page, pageSize int) ([]*domain.Dispute, *domain.Pagination, error) {
	disputes, pagination, err := s.contractRepo.ListDisputes(ctx, contractID, userID, status, page, pageSize)
	if err != nil {
		return nil, nil, fmt.Errorf("list disputes: %w", err)
	}
	return disputes, pagination, nil
}

// AdminResolveDispute resolves a dispute and logs an audit entry.
func (s *ContractService) AdminResolveDispute(
	ctx context.Context,
	disputeID, resolutionType, notes, adminID string,
	refundAmountCents int64,
	guaranteeOutcome string,
) (*domain.Dispute, error) {
	// Validate the dispute exists before resolving.
	existingDispute, err := s.contractRepo.GetDispute(ctx, disputeID)
	if err != nil {
		return nil, fmt.Errorf("admin resolve dispute: %w", err)
	}

	if existingDispute.Status == "resolved" || existingDispute.Status == "closed" {
		return nil, fmt.Errorf("admin resolve dispute: %w", domain.ErrDisputeAlreadyResolved)
	}

	resolved, err := s.contractRepo.ResolveDispute(ctx, disputeID, resolutionType, notes, adminID, refundAmountCents, guaranteeOutcome)
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
