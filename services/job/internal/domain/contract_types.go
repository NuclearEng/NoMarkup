package domain

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors for the contract domain.
var (
	ErrContractNotFound        = errors.New("contract not found")
	ErrNotContractParty        = errors.New("not a party to this contract")
	ErrAlreadyAccepted         = errors.New("contract already accepted by this party")
	ErrDeadlineExpired         = errors.New("acceptance deadline has expired")
	ErrContractNotActive       = errors.New("contract is not active")
	ErrMilestoneNotFound       = errors.New("milestone not found")
	ErrMaxRevisions            = errors.New("maximum revision count reached")
	ErrInvalidStatusTransition = errors.New("invalid status transition")
	ErrDisputeNotFound         = errors.New("dispute not found")
	ErrDisputeAlreadyResolved  = errors.New("dispute is already resolved")
)

// Contract represents a contract between customer and provider.
type Contract struct {
	ID                 string
	ContractNumber     string
	JobID              string
	CustomerID         string
	ProviderID         string
	BidID              string
	AmountCents        int64
	PaymentTiming      string // upfront, milestone, completion, payment_plan, recurring
	TermsJSON          []byte
	ScheduleJSON       []byte
	Status             string // pending_acceptance, active, completed, cancelled, voided, disputed, abandoned, suspended
	CustomerAccepted   bool
	ProviderAccepted   bool
	AcceptanceDeadline time.Time
	AcceptedAt         *time.Time
	StartedAt          *time.Time
	CompletedAt        *time.Time
	CancelledAt        *time.Time
	CancelledBy        *string
	CancellationReason string
	CreatedAt          time.Time
	UpdatedAt          time.Time

	// Populated via JOINs
	Milestones   []Milestone
	ChangeOrders []ChangeOrder
}

// Milestone represents a milestone within a contract.
type Milestone struct {
	ID            string
	ContractID    string
	Description   string
	AmountCents   int64
	SortOrder     int
	Status        string // pending, in_progress, submitted, approved, disputed, revision_requested
	RevisionCount int
	RevisionNotes string
	SubmittedAt   *time.Time
	ApprovedAt    *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// ChangeOrder represents a proposed change to a contract.
type ChangeOrder struct {
	ID               string
	ContractID       string
	ProposedBy       string
	Description      string
	ChangesJSON      []byte
	AmountDeltaCents int64
	Status           string // proposed, accepted, rejected, expired
	AcceptedAt       *time.Time
	RejectedAt       *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// Dispute represents a dispute opened against a contract.
type Dispute struct {
	ID                string
	ContractID        string
	OpenedBy          string
	DisputeType       string // quality, incomplete_work, no_show, abandonment, payment, scope_disagreement, guarantee_claim, other
	Description       string
	EvidenceURLs      []string
	Status            string // open, under_review, resolved, escalated, closed
	ResolutionType    string // release_payment, partial_refund, full_refund, contract_terminated, dismissed, guarantee_invoked
	ResolutionNotes   string
	RefundAmountCents int64
	ResolvedBy        string
	FirstResponseAt   *time.Time
	ResolvedAt        *time.Time
	IsGuaranteeClaim  bool
	GuaranteeOutcome  string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// MilestoneInput holds input data for creating a milestone.
type MilestoneInput struct {
	Description string
	AmountCents int64
}

// ContractRepository defines persistence operations for contracts.
type ContractRepository interface {
	CreateContract(ctx context.Context, contract *Contract, milestones []MilestoneInput) (*Contract, error)
	GetContract(ctx context.Context, contractID string) (*Contract, error)
	AcceptContract(ctx context.Context, contractID string, userID string, isCustomer bool) (*Contract, error)
	StartWork(ctx context.Context, contractID string) (*Contract, error)
	ListContracts(ctx context.Context, userID string, statusFilter *string, page, pageSize int) ([]*Contract, *Pagination, error)
	SubmitMilestone(ctx context.Context, milestoneID string) (*Milestone, error)
	ApproveMilestone(ctx context.Context, milestoneID string) (*Milestone, error)
	RequestRevision(ctx context.Context, milestoneID string, notes string) (*Milestone, error)
	MarkComplete(ctx context.Context, contractID string) (*Contract, error)
	GetMilestone(ctx context.Context, milestoneID string) (*Milestone, error)
	UpdateJobStatus(ctx context.Context, jobID string, status string) error
	CancelContract(ctx context.Context, contractID string, userID string, reason string) (*Contract, error)
	ApproveCompletion(ctx context.Context, contractID string) (*Contract, error)
	GetContractsAwaitingApproval(ctx context.Context, olderThan time.Duration) ([]Contract, error)
	UpdateJobCompleted(ctx context.Context, jobID string) error

	// Disputes
	CreateDispute(ctx context.Context, dispute *Dispute) (*Dispute, error)
	GetDispute(ctx context.Context, disputeID string) (*Dispute, error)
	ListDisputes(ctx context.Context, contractID *string, userID *string, status *string, page, pageSize int) ([]*Dispute, *Pagination, error)
	ResolveDispute(ctx context.Context, disputeID, resolutionType, notes, resolvedBy string, refundAmountCents int64, guaranteeOutcome string) (*Dispute, error)
	InsertAuditLog(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any) error
	UpdateContractStatus(ctx context.Context, contractID string, status string) error
}
