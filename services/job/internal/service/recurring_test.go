package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// recurringTestRepo stubs only the recurring + contract party paths used by FR-18 service methods.
type recurringTestRepo struct {
	domain.ContractRepository

	contract  *domain.Contract
	cfg       *domain.RecurringConfig
	instances map[string]*domain.RecurringInstance
}

func (r *recurringTestRepo) GetContract(_ context.Context, id string) (*domain.Contract, error) {
	if r.contract == nil || r.contract.ID != id {
		return nil, domain.ErrContractNotFound
	}
	c := *r.contract
	return &c, nil
}

func (r *recurringTestRepo) GetRecurringConfigByID(_ context.Context, id string) (*domain.RecurringConfig, error) {
	if r.cfg == nil || r.cfg.ID != id {
		return nil, domain.ErrRecurringNotFound
	}
	c := *r.cfg
	return &c, nil
}

func (r *recurringTestRepo) GetRecurringConfigByContract(_ context.Context, contractID string) (*domain.RecurringConfig, error) {
	if r.cfg == nil || r.cfg.ContractID != contractID {
		return nil, domain.ErrRecurringNotFound
	}
	c := *r.cfg
	return &c, nil
}

func (r *recurringTestRepo) UpdateRecurringConfig(_ context.Context, cfg *domain.RecurringConfig) (*domain.RecurringConfig, error) {
	if r.cfg == nil || r.cfg.ID != cfg.ID {
		return nil, domain.ErrRecurringNotFound
	}
	cp := *cfg
	r.cfg = &cp
	return &cp, nil
}

func (r *recurringTestRepo) GetRecurringInstance(_ context.Context, id string) (*domain.RecurringInstance, error) {
	if r.instances == nil {
		return nil, domain.ErrRecurringInstanceNotFound
	}
	inst, ok := r.instances[id]
	if !ok {
		return nil, domain.ErrRecurringInstanceNotFound
	}
	cp := *inst
	return &cp, nil
}

func (r *recurringTestRepo) UpdateRecurringInstance(_ context.Context, inst *domain.RecurringInstance) (*domain.RecurringInstance, error) {
	if r.instances == nil {
		return nil, domain.ErrRecurringInstanceNotFound
	}
	if _, ok := r.instances[inst.ID]; !ok {
		return nil, domain.ErrRecurringInstanceNotFound
	}
	cp := *inst
	r.instances[inst.ID] = &cp
	return &cp, nil
}

func (r *recurringTestRepo) ListRecurringInstances(_ context.Context, recurringID string, page, pageSize int) ([]*domain.RecurringInstance, *domain.Pagination, error) {
	var out []*domain.RecurringInstance
	for _, inst := range r.instances {
		if inst.RecurringID == recurringID {
			cp := *inst
			out = append(out, &cp)
		}
	}
	return out, &domain.Pagination{TotalCount: len(out), Page: page, PageSize: pageSize, TotalPages: 1}, nil
}

func (r *recurringTestRepo) CreateRecurringInstance(_ context.Context, inst *domain.RecurringInstance) (*domain.RecurringInstance, error) {
	if r.instances == nil {
		r.instances = map[string]*domain.RecurringInstance{}
	}
	cp := *inst
	if cp.ID == "" {
		cp.ID = fmt.Sprintf("inst-%d", len(r.instances)+1)
	}
	r.instances[cp.ID] = &cp
	return &cp, nil
}

func TestRequireContractPartyRejectsEmptyUserID(t *testing.T) {
	t.Parallel()
	const (
		customer = "cust-1"
		provider = "prov-1"
		contract = "ctr-1"
		recID    = "rec-1"
	)
	repo := &recurringTestRepo{
		contract: &domain.Contract{
			ID: contract, CustomerID: customer, ProviderID: provider, Status: "active",
		},
		cfg: &domain.RecurringConfig{
			ID: recID, ContractID: contract, Frequency: "weekly", RateCents: 7500,
			Status: "active", NextOccurrence: time.Now().UTC().AddDate(0, 0, 7),
		},
	}
	svc := NewContractService(repo, nil)

	// Empty userID must fail closed (no party-check skip).
	_, err := svc.GetRecurringConfig(context.Background(), contract, "")
	if !errors.Is(err, domain.ErrNotContractParty) {
		t.Fatalf("empty user GetRecurringConfig: want ErrNotContractParty, got %v", err)
	}
	_, err = svc.PauseRecurring(context.Background(), recID, "")
	if !errors.Is(err, domain.ErrNotContractParty) {
		t.Fatalf("empty user PauseRecurring: want ErrNotContractParty, got %v", err)
	}
	_, _, err = svc.ListRecurringInstances(context.Background(), recID, "", 1, 20)
	if !errors.Is(err, domain.ErrNotContractParty) {
		t.Fatalf("empty user ListRecurringInstances: want ErrNotContractParty, got %v", err)
	}
}

func TestPauseResumeRecurring(t *testing.T) {
	t.Parallel()
	const (
		customer = "cust-1"
		provider = "prov-1"
		contract = "ctr-1"
		recID    = "rec-1"
	)
	repo := &recurringTestRepo{
		contract: &domain.Contract{
			ID: contract, CustomerID: customer, ProviderID: provider, Status: "active",
		},
		cfg: &domain.RecurringConfig{
			ID: recID, ContractID: contract, Frequency: "weekly", RateCents: 7500,
			Status: "active", NextOccurrence: time.Now().UTC().AddDate(0, 0, 7),
		},
	}
	svc := NewContractService(repo, nil)

	// Non-party cannot pause.
	_, err := svc.PauseRecurring(context.Background(), recID, "stranger")
	if !errors.Is(err, domain.ErrNotContractParty) {
		t.Fatalf("pause non-party: want ErrNotContractParty, got %v", err)
	}

	paused, err := svc.PauseRecurring(context.Background(), recID, customer)
	if err != nil {
		t.Fatalf("pause: %v", err)
	}
	if paused.Status != "paused" {
		t.Fatalf("pause status: got %s", paused.Status)
	}
	if paused.PausedAt == nil || paused.PauseMaxDate == nil {
		t.Fatal("pause should set paused_at and pause_max_date")
	}

	// Cannot pause again while paused.
	_, err = svc.PauseRecurring(context.Background(), recID, customer)
	if !errors.Is(err, domain.ErrRecurringNotActive) {
		t.Fatalf("double pause: want ErrRecurringNotActive, got %v", err)
	}

	resumed, err := svc.ResumeRecurring(context.Background(), recID, provider)
	if err != nil {
		t.Fatalf("resume: %v", err)
	}
	if resumed.Status != "active" {
		t.Fatalf("resume status: got %s", resumed.Status)
	}
	if resumed.PausedAt != nil {
		t.Fatal("resume should clear paused_at")
	}
}

func TestCompleteAndApproveRecurringInstance(t *testing.T) {
	t.Parallel()
	const (
		customer = "cust-1"
		provider = "prov-1"
		contract = "ctr-1"
		recID    = "rec-1"
		instID   = "inst-1"
	)
	repo := &recurringTestRepo{
		contract: &domain.Contract{
			ID: contract, CustomerID: customer, ProviderID: provider, Status: "active",
		},
		cfg: &domain.RecurringConfig{
			ID: recID, ContractID: contract, Frequency: "weekly", RateCents: 7500,
			Status: "active", AutoApprove: false,
			NextOccurrence: time.Now().UTC().AddDate(0, 0, 7),
		},
		instances: map[string]*domain.RecurringInstance{
			instID: {
				ID: instID, RecurringID: recID, ContractID: contract,
				Status: "scheduled", AmountCents: 7500,
				OccurrenceDate: time.Now().UTC(),
			},
		},
	}
	svc := NewContractService(repo, nil)

	// Customer cannot complete.
	_, err := svc.CompleteRecurringInstance(context.Background(), instID, customer)
	if !errors.Is(err, domain.ErrNotContractParty) {
		t.Fatalf("customer complete: want ErrNotContractParty, got %v", err)
	}

	done, err := svc.CompleteRecurringInstance(context.Background(), instID, provider)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if done.Status != "completed" || done.CompletedAt == nil {
		t.Fatalf("complete state: %+v", done)
	}

	// Provider cannot approve.
	_, err = svc.ApproveRecurringInstance(context.Background(), instID, provider)
	if !errors.Is(err, domain.ErrNotContractParty) {
		t.Fatalf("provider approve: want ErrNotContractParty, got %v", err)
	}

	approved, err := svc.ApproveRecurringInstance(context.Background(), instID, customer)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if approved.ApprovedAt == nil {
		t.Fatal("approve should set approved_at")
	}
}

func TestCancelRecurringSetsNotice(t *testing.T) {
	t.Parallel()
	const (
		customer = "cust-1"
		provider = "prov-1"
		contract = "ctr-1"
		recID    = "rec-1"
	)
	next := time.Now().UTC().AddDate(0, 0, 7)
	y, m, d := next.Date()
	next = time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	repo := &recurringTestRepo{
		contract: &domain.Contract{
			ID: contract, CustomerID: customer, ProviderID: provider, Status: "active",
		},
		cfg: &domain.RecurringConfig{
			ID: recID, ContractID: contract, Frequency: "weekly", RateCents: 7500,
			Status: "active", NextOccurrence: next,
		},
	}
	svc := NewContractService(repo, nil)

	cancelled, err := svc.CancelRecurring(context.Background(), recID, customer)
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if cancelled.Status != "cancelled" {
		t.Fatalf("status: %s", cancelled.Status)
	}
	if cancelled.NoticePeriodEnd == nil || !cancelled.NoticePeriodEnd.Equal(next) {
		t.Fatalf("notice_period_end want %v got %v", next, cancelled.NoticePeriodEnd)
	}
	if cancelled.CancelledBy == nil || *cancelled.CancelledBy != customer {
		t.Fatalf("cancelled_by: %v", cancelled.CancelledBy)
	}
}

func TestListRecurringInstancesRollForward(t *testing.T) {
	t.Parallel()
	const (
		customer = "cust-1"
		provider = "prov-1"
		contract = "ctr-1"
		recID    = "rec-1"
	)
	// Next occurrence is today — list should create scheduled instances.
	today := time.Now().UTC()
	y, m, d := today.Date()
	occ := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	repo := &recurringTestRepo{
		contract: &domain.Contract{
			ID: contract, CustomerID: customer, ProviderID: provider, Status: "active",
		},
		cfg: &domain.RecurringConfig{
			ID: recID, ContractID: contract, Frequency: "weekly", RateCents: 5000,
			Status: "active", NextOccurrence: occ,
		},
		instances: map[string]*domain.RecurringInstance{},
	}
	svc := NewContractService(repo, nil)
	list, _, err := svc.ListRecurringInstances(context.Background(), recID, customer, 1, 50)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) == 0 {
		t.Fatal("expected roll-forward to create at least one instance")
	}
	if len(repo.instances) == 0 {
		t.Fatal("repo should hold created instances")
	}
	// Snapshot occurrence dates from the first batch.
	firstDates := map[string]int{}
	for _, inst := range repo.instances {
		key := inst.OccurrenceDate.UTC().Format("2006-01-02")
		firstDates[key]++
	}
	for key, n := range firstDates {
		if n != 1 {
			t.Fatalf("first batch already duplicated date %s (%d)", key, n)
		}
	}
	// NextOccurrence should have advanced past the seed date.
	if !repo.cfg.NextOccurrence.After(occ) {
		t.Fatalf("next_occurrence not advanced: %v", repo.cfg.NextOccurrence)
	}
	// Re-list may create later horizon slots, but must not duplicate dates already present.
	if _, _, err := svc.ListRecurringInstances(context.Background(), recID, customer, 1, 50); err != nil {
		t.Fatalf("list again: %v", err)
	}
	dateCounts := map[string]int{}
	for _, inst := range repo.instances {
		key := inst.OccurrenceDate.UTC().Format("2006-01-02")
		dateCounts[key]++
	}
	for key, n := range dateCounts {
		if n != 1 {
			t.Fatalf("roll-forward duplicated occurrence_date %s (%d rows)", key, n)
		}
	}
	for key := range firstDates {
		if dateCounts[key] != 1 {
			t.Fatalf("lost first-batch date %s on re-list", key)
		}
	}
}

func TestListRecurringInstancesRollForwardSkipsPaused(t *testing.T) {
	t.Parallel()
	const (
		customer = "cust-1"
		provider = "prov-1"
		contract = "ctr-1"
		recID    = "rec-1"
	)
	today := time.Now().UTC()
	y, m, d := today.Date()
	occ := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	repo := &recurringTestRepo{
		contract: &domain.Contract{
			ID: contract, CustomerID: customer, ProviderID: provider, Status: "active",
		},
		cfg: &domain.RecurringConfig{
			ID: recID, ContractID: contract, Frequency: "weekly", RateCents: 5000,
			Status: "paused", NextOccurrence: occ,
		},
		instances: map[string]*domain.RecurringInstance{},
	}
	svc := NewContractService(repo, nil)
	list, _, err := svc.ListRecurringInstances(context.Background(), recID, customer, 1, 50)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("paused config must not roll-forward instances, got %d", len(list))
	}
	if len(repo.instances) != 0 {
		t.Fatalf("repo should stay empty while paused, got %d", len(repo.instances))
	}
}

func TestNextOccurrenceFrom(t *testing.T) {
	t.Parallel()
	from := time.Date(2026, 7, 1, 15, 0, 0, 0, time.UTC)
	if got := nextOccurrenceFrom(from, "weekly"); !got.Equal(time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("weekly: %v", got)
	}
	if got := nextOccurrenceFrom(from, "biweekly"); !got.Equal(time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("biweekly: %v", got)
	}
	if got := nextOccurrenceFrom(from, "monthly"); !got.Equal(time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("monthly: %v", got)
	}
}
