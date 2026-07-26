package service

import (
	"context"
	"errors"
	"testing"
	"time"

	underwritingv1 "github.com/nomarkup/nomarkup/proto/underwriting/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Mock Payment Repository ---

type mockPaymentRepo struct {
	createPaymentFn               func(ctx context.Context, payment *domain.Payment) error
	getPaymentFn                  func(ctx context.Context, id string) (*domain.Payment, error)
	updatePaymentStatusFn         func(ctx context.Context, id string, status string) error
	claimPaymentStatusFn          func(ctx context.Context, id, fromStatus, toStatus string) error
	updateRefundCASFn             func(ctx context.Context, id string, expectedPrior, newTotal int64, refundReason string, refundedAt time.Time, stripeRefundID, status string) error
	withProviderAdvisoryLockFn    func(ctx context.Context, providerID string, fn func(ctx context.Context) error) error
	listPaymentsFn                func(ctx context.Context, userID string, statusFilter string, page, pageSize int) ([]*domain.Payment, int, error)
	getFeeConfigFn                func(ctx context.Context, categoryID string) (*domain.FeeConfig, error)
	getDefaultFeeConfigFn         func(ctx context.Context) (*domain.FeeConfig, error)
	findByStripePIFn              func(ctx context.Context, paymentIntentID string) (*domain.Payment, error)
	updateStripeFieldsFn          func(ctx context.Context, id string, paymentIntentID, chargeID, transferID string) error
	updateRefundFn                func(ctx context.Context, id string, refundAmountCents int64, refundReason string, refundedAt time.Time, stripeRefundID string, status string) error
	getStripeAccountIDFn          func(ctx context.Context, userID string) (string, error)
	setStripeAccountIDFn          func(ctx context.Context, userID string, stripeAccountID string) error
	setStripeOnboardingCompleteFn func(ctx context.Context, stripeAccountID string, complete bool) error
	// Expense methods
	createExpenseFn func(ctx context.Context, expense *domain.Expense) error
	listExpensesFn  func(ctx context.Context, providerID string, startDate, endDate *time.Time, page, pageSize int) ([]*domain.Expense, int64, int, error)
	deleteExpenseFn func(ctx context.Context, expenseID, providerID string) error
	// Advance methods
	createAdvanceFn             func(ctx context.Context, advance *domain.Advance) error
	listAdvancesFn              func(ctx context.Context, providerID string, statusFilter string, page, pageSize int) ([]*domain.Advance, int, error)
	getAdvanceFn                func(ctx context.Context, advanceID string) (*domain.Advance, error)
	updateAdvanceReviewFn       func(ctx context.Context, advanceID string, status string, reviewerID string, rejectionReason *string) (*domain.Advance, error)
	updateAdvanceDisbursementFn func(ctx context.Context, advanceID, stripeTransferID string) (*domain.Advance, error)
	getActiveAdvancesFn         func(ctx context.Context, providerID string) ([]*domain.Advance, error)
	getCreditLimitFn            func(ctx context.Context, providerID string) (*domain.CreditLimit, error)
	upsertCreditLimitFn         func(ctx context.Context, limit *domain.CreditLimit) error
	// Tax-form methods
	createTaxFormFn       func(ctx context.Context, tf *domain.TaxForm) error
	getTaxFormFn          func(ctx context.Context, providerID string, taxYear int) (*domain.TaxForm, error)
	listTaxFormsFn        func(ctx context.Context, providerID string) ([]*domain.TaxForm, error)
	getProviderEarningsFn func(ctx context.Context, providerID string, taxYear int) (int64, error)
	getProviderProfileFn  func(ctx context.Context, providerID string) (string, string, error)
	// Invoice methods
	getContractDetailFn        func(ctx context.Context, contractID string) (*domain.ContractDetail, error)
	getContractForPaymentFn    func(ctx context.Context, contractID string) (*domain.ContractForPayment, error)
	getMilestonesForContractFn func(ctx context.Context, contractID string) ([]*domain.MilestoneDetail, error)
	getPaymentsForContractFn   func(ctx context.Context, contractID string) ([]*domain.Payment, error)
	// Stripe customer ID + admin list/details/revenue
	getStripeCustomerIDFn    func(ctx context.Context, userID string) (string, error)
	adminListPaymentsFn      func(ctx context.Context, userID, statusFilter string, startTime, endTime *time.Time, page, pageSize int) ([]*domain.Payment, int, int64, int64, error)
	adminGetPaymentDetailsFn func(ctx context.Context, paymentID string) (*domain.Payment, error)
	getRevenueReportFn       func(ctx context.Context, startTime, endTime *time.Time, groupBy string) (*domain.RevenueReport, error)
	// Installment methods
	createInstallmentPlanFn               func(ctx context.Context, plan *domain.InstallmentPlan) error
	getInstallmentPlanFn                  func(ctx context.Context, planID string) (*domain.InstallmentPlan, error)
	hasActiveInstallmentPlanForContractFn func(ctx context.Context, contractID string) (bool, error)
	listInstallmentPlansFn                func(ctx context.Context, userID, statusFilter string, page, pageSize int) ([]*domain.InstallmentPlan, int, error)
	createScheduledInstallmentsFn         func(ctx context.Context, installments []domain.ScheduledInstallment) error
	getDueInstallmentsFn                  func(ctx context.Context, now time.Time) ([]domain.ScheduledInstallment, error)
	updateScheduledInstallmentStatusFn    func(ctx context.Context, instID, status string, piID *string) error
	updateInstallmentPlanStatusFn         func(ctx context.Context, planID, status string) error
	updateInstallmentPlanProviderPaidFn   func(ctx context.Context, planID, transferID string) error
	getScheduledInstallmentsForPlanFn     func(ctx context.Context, planID string) ([]domain.ScheduledInstallment, error)
	// Stripe event dedup methods.
	recordStripeEventStartFn   func(ctx context.Context, eventID, eventType string) (bool, error)
	markStripeEventProcessedFn func(ctx context.Context, eventID string) error
	// Instant payout methods.
	sumInstantPayoutsLast24hFn      func(ctx context.Context, providerID string) (int64, error)
	sumAllInstantPayoutsFn          func(ctx context.Context, providerID string) (int64, error)
	sumEligibleInstantPayoutCentsFn func(ctx context.Context, providerID string) (int64, error)
	lookupInstantPayoutByKeyFn      func(ctx context.Context, providerID, key string) (*domain.InstantPayout, bool, error)
	claimInstantPayoutFn            func(ctx context.Context, providerID string, amountCents, feeCents, netCents int64, key string) (*domain.InstantPayout, error)
	completeInstantPayoutFn         func(ctx context.Context, payoutID, stripePayoutID string) error
	failInstantPayoutFn             func(ctx context.Context, payoutID string) error
}

func (m *mockPaymentRepo) CreatePayment(ctx context.Context, payment *domain.Payment) error {
	return m.createPaymentFn(ctx, payment)
}
func (m *mockPaymentRepo) GetPayment(ctx context.Context, id string) (*domain.Payment, error) {
	return m.getPaymentFn(ctx, id)
}
func (m *mockPaymentRepo) UpdatePaymentStatus(ctx context.Context, id string, status string) error {
	if m.updatePaymentStatusFn != nil {
		return m.updatePaymentStatusFn(ctx, id, status)
	}
	return nil
}
func (m *mockPaymentRepo) ClaimPaymentStatus(ctx context.Context, id, fromStatus, toStatus string) error {
	if m.claimPaymentStatusFn != nil {
		return m.claimPaymentStatusFn(ctx, id, fromStatus, toStatus)
	}
	// Default: delegate to UpdatePaymentStatus when provided.
	if m.updatePaymentStatusFn != nil {
		return m.updatePaymentStatusFn(ctx, id, toStatus)
	}
	return nil
}
func (m *mockPaymentRepo) UpdateRefundCAS(ctx context.Context, id string, expectedPrior, newTotal int64, refundReason string, refundedAt time.Time, stripeRefundID, status string) error {
	if m.updateRefundCASFn != nil {
		return m.updateRefundCASFn(ctx, id, expectedPrior, newTotal, refundReason, refundedAt, stripeRefundID, status)
	}
	// Default: fall through to UpdateRefund when provided.
	if m.updateRefundFn != nil {
		return m.updateRefundFn(ctx, id, newTotal, refundReason, refundedAt, stripeRefundID, status)
	}
	return nil
}
func (m *mockPaymentRepo) WithProviderAdvisoryLock(ctx context.Context, providerID string, fn func(ctx context.Context) error) error {
	if m.withProviderAdvisoryLockFn != nil {
		return m.withProviderAdvisoryLockFn(ctx, providerID, fn)
	}
	return fn(ctx)
}
func (m *mockPaymentRepo) ListPayments(ctx context.Context, userID string, statusFilter string, page, pageSize int) ([]*domain.Payment, int, error) {
	if m.listPaymentsFn != nil {
		return m.listPaymentsFn(ctx, userID, statusFilter, page, pageSize)
	}
	return nil, 0, nil
}
func (m *mockPaymentRepo) GetFeeConfig(ctx context.Context, categoryID string) (*domain.FeeConfig, error) {
	return m.getFeeConfigFn(ctx, categoryID)
}
func (m *mockPaymentRepo) GetDefaultFeeConfig(ctx context.Context) (*domain.FeeConfig, error) {
	return m.getDefaultFeeConfigFn(ctx)
}
func (m *mockPaymentRepo) FindByStripePaymentIntentID(ctx context.Context, paymentIntentID string) (*domain.Payment, error) {
	return m.findByStripePIFn(ctx, paymentIntentID)
}
func (m *mockPaymentRepo) UpdateStripeFields(ctx context.Context, id string, paymentIntentID, chargeID, transferID string) error {
	return m.updateStripeFieldsFn(ctx, id, paymentIntentID, chargeID, transferID)
}
func (m *mockPaymentRepo) UpdateRefund(ctx context.Context, id string, refundAmountCents int64, refundReason string, refundedAt time.Time, stripeRefundID string, status string) error {
	return m.updateRefundFn(ctx, id, refundAmountCents, refundReason, refundedAt, stripeRefundID, status)
}
func (m *mockPaymentRepo) GetStripeAccountID(ctx context.Context, userID string) (string, error) {
	if m.getStripeAccountIDFn == nil {
		// Default to a connected account so tests that don't exercise the
		// payout-account path aren't forced to stub it (the BNPL create now
		// validates the account up front, before persisting the plan).
		return "acct_dev", nil
	}
	return m.getStripeAccountIDFn(ctx, userID)
}
func (m *mockPaymentRepo) SetStripeAccountID(ctx context.Context, userID string, stripeAccountID string) error {
	return m.setStripeAccountIDFn(ctx, userID, stripeAccountID)
}
func (m *mockPaymentRepo) SetStripeOnboardingComplete(ctx context.Context, stripeAccountID string, complete bool) error {
	if m.setStripeOnboardingCompleteFn != nil {
		return m.setStripeOnboardingCompleteFn(ctx, stripeAccountID, complete)
	}
	return nil
}
func (m *mockPaymentRepo) CreateExpense(ctx context.Context, expense *domain.Expense) error {
	if m.createExpenseFn != nil {
		return m.createExpenseFn(ctx, expense)
	}
	return nil
}
func (m *mockPaymentRepo) ListExpenses(ctx context.Context, providerID string, startDate, endDate *time.Time, page, pageSize int) ([]*domain.Expense, int64, int, error) {
	if m.listExpensesFn != nil {
		return m.listExpensesFn(ctx, providerID, startDate, endDate, page, pageSize)
	}
	return nil, 0, 0, nil
}
func (m *mockPaymentRepo) DeleteExpense(ctx context.Context, expenseID, providerID string) error {
	if m.deleteExpenseFn != nil {
		return m.deleteExpenseFn(ctx, expenseID, providerID)
	}
	return nil
}
func (m *mockPaymentRepo) CreateAdvance(ctx context.Context, advance *domain.Advance) error {
	if m.createAdvanceFn != nil {
		return m.createAdvanceFn(ctx, advance)
	}
	return nil
}
func (m *mockPaymentRepo) ListAdvances(ctx context.Context, providerID string, statusFilter string, page, pageSize int) ([]*domain.Advance, int, error) {
	if m.listAdvancesFn != nil {
		return m.listAdvancesFn(ctx, providerID, statusFilter, page, pageSize)
	}
	return nil, 0, nil
}
func (m *mockPaymentRepo) GetAdvance(ctx context.Context, advanceID string) (*domain.Advance, error) {
	if m.getAdvanceFn != nil {
		return m.getAdvanceFn(ctx, advanceID)
	}
	return nil, domain.ErrAdvanceNotFound
}
func (m *mockPaymentRepo) UpdateAdvanceReview(ctx context.Context, advanceID string, status string, reviewerID string, rejectionReason *string) (*domain.Advance, error) {
	if m.updateAdvanceReviewFn != nil {
		return m.updateAdvanceReviewFn(ctx, advanceID, status, reviewerID, rejectionReason)
	}
	return nil, domain.ErrAdvanceNotFound
}
func (m *mockPaymentRepo) GetStripeCustomerID(ctx context.Context, userID string) (string, error) {
	if m.getStripeCustomerIDFn != nil {
		return m.getStripeCustomerIDFn(ctx, userID)
	}
	return "", nil
}
func (m *mockPaymentRepo) AdminListPayments(ctx context.Context, userID, statusFilter string, startTime, endTime *time.Time, page, pageSize int) ([]*domain.Payment, int, int64, int64, error) {
	if m.adminListPaymentsFn != nil {
		return m.adminListPaymentsFn(ctx, userID, statusFilter, startTime, endTime, page, pageSize)
	}
	return nil, 0, 0, 0, nil
}
func (m *mockPaymentRepo) AdminGetPaymentDetails(ctx context.Context, paymentID string) (*domain.Payment, error) {
	if m.adminGetPaymentDetailsFn != nil {
		return m.adminGetPaymentDetailsFn(ctx, paymentID)
	}
	return nil, domain.ErrPaymentNotFound
}
func (m *mockPaymentRepo) UpdateFeeConfig(_ context.Context, _ *string, _, _ float64, _ int64, _ *int64, _ bool, _ float64, _ int64, _ *int64) (*domain.FeeConfig, error) {
	return nil, nil
}
func (m *mockPaymentRepo) GetDefaultPlatformBankAccount(_ context.Context) (*domain.PlatformBankAccount, error) {
	return nil, nil
}
func (m *mockPaymentRepo) InsertPlatformBankAccount(_ context.Context, _ *domain.PlatformBankAccount) error {
	return nil
}
func (m *mockPaymentRepo) SoftDeletePlatformBankAccount(_ context.Context, _ string) error {
	return nil
}
func (m *mockPaymentRepo) GetRevenueReport(ctx context.Context, startTime, endTime *time.Time, groupBy string) (*domain.RevenueReport, error) {
	if m.getRevenueReportFn != nil {
		return m.getRevenueReportFn(ctx, startTime, endTime, groupBy)
	}
	return nil, nil
}

// Installment plan methods (satisfy interface — hookable via fn fields).
func (m *mockPaymentRepo) CreateInstallmentPlan(ctx context.Context, plan *domain.InstallmentPlan) error {
	if m.createInstallmentPlanFn != nil {
		return m.createInstallmentPlanFn(ctx, plan)
	}
	return nil
}
func (m *mockPaymentRepo) GetInstallmentPlan(ctx context.Context, planID string) (*domain.InstallmentPlan, error) {
	if m.getInstallmentPlanFn != nil {
		return m.getInstallmentPlanFn(ctx, planID)
	}
	return nil, domain.ErrInstallmentPlanNotFound
}
func (m *mockPaymentRepo) HasActiveInstallmentPlanForContract(ctx context.Context, contractID string) (bool, error) {
	if m.hasActiveInstallmentPlanForContractFn != nil {
		return m.hasActiveInstallmentPlanForContractFn(ctx, contractID)
	}
	return false, nil
}
func (m *mockPaymentRepo) ListInstallmentPlans(ctx context.Context, userID, statusFilter string, page, pageSize int) ([]*domain.InstallmentPlan, int, error) {
	if m.listInstallmentPlansFn != nil {
		return m.listInstallmentPlansFn(ctx, userID, statusFilter, page, pageSize)
	}
	return nil, 0, nil
}
func (m *mockPaymentRepo) CreateScheduledInstallments(ctx context.Context, installments []domain.ScheduledInstallment) error {
	if m.createScheduledInstallmentsFn != nil {
		return m.createScheduledInstallmentsFn(ctx, installments)
	}
	return nil
}
func (m *mockPaymentRepo) GetDueInstallments(ctx context.Context, now time.Time) ([]domain.ScheduledInstallment, error) {
	if m.getDueInstallmentsFn != nil {
		return m.getDueInstallmentsFn(ctx, now)
	}
	return nil, nil
}
func (m *mockPaymentRepo) UpdateScheduledInstallmentStatus(ctx context.Context, instID, status string, piID *string) error {
	if m.updateScheduledInstallmentStatusFn != nil {
		return m.updateScheduledInstallmentStatusFn(ctx, instID, status, piID)
	}
	return nil
}
func (m *mockPaymentRepo) UpdateInstallmentPlanStatus(ctx context.Context, planID, status string) error {
	if m.updateInstallmentPlanStatusFn != nil {
		return m.updateInstallmentPlanStatusFn(ctx, planID, status)
	}
	return nil
}
func (m *mockPaymentRepo) UpdateInstallmentPlanProviderPaid(ctx context.Context, planID, transferID string) error {
	if m.updateInstallmentPlanProviderPaidFn != nil {
		return m.updateInstallmentPlanProviderPaidFn(ctx, planID, transferID)
	}
	return nil
}
func (m *mockPaymentRepo) GetScheduledInstallmentsForPlan(ctx context.Context, planID string) ([]domain.ScheduledInstallment, error) {
	if m.getScheduledInstallmentsForPlanFn != nil {
		return m.getScheduledInstallmentsForPlanFn(ctx, planID)
	}
	return nil, nil
}

// Advance + credit-limit stubs (satisfy interface — hookable via fn fields).
func (m *mockPaymentRepo) UpdateAdvanceDisbursement(ctx context.Context, advanceID, stripeTransferID string) (*domain.Advance, error) {
	if m.updateAdvanceDisbursementFn != nil {
		return m.updateAdvanceDisbursementFn(ctx, advanceID, stripeTransferID)
	}
	return nil, domain.ErrAdvanceNotFound
}
func (m *mockPaymentRepo) UpdateAdvanceRepayment(_ context.Context, _, _ string, _ int64) (*domain.Advance, error) {
	return nil, domain.ErrAdvanceNotFound
}
func (m *mockPaymentRepo) GetActiveAdvancesForProvider(ctx context.Context, providerID string) ([]*domain.Advance, error) {
	if m.getActiveAdvancesFn != nil {
		return m.getActiveAdvancesFn(ctx, providerID)
	}
	return nil, nil
}
func (m *mockPaymentRepo) GetCreditLimit(ctx context.Context, providerID string) (*domain.CreditLimit, error) {
	if m.getCreditLimitFn != nil {
		return m.getCreditLimitFn(ctx, providerID)
	}
	return nil, nil
}
func (m *mockPaymentRepo) UpsertCreditLimit(ctx context.Context, limit *domain.CreditLimit) error {
	if m.upsertCreditLimitFn != nil {
		return m.upsertCreditLimitFn(ctx, limit)
	}
	return nil
}

// Underwriting feature-gathering stubs (satisfy the interface).
func (m *mockPaymentRepo) GetUnderwritingEarnings(ctx context.Context, providerID string, asOf time.Time) (t30, t90, t365 int64, activeMonths int, err error) {
	return 0, 0, 0, 0, nil
}
func (m *mockPaymentRepo) GetProviderDisputeRate90d(ctx context.Context, providerID string, asOf time.Time) (float64, error) {
	return 0, nil
}

// Tax-form stubs (satisfy interface — hookable via fn fields).
func (m *mockPaymentRepo) CreateTaxForm(ctx context.Context, tf *domain.TaxForm) error {
	if m.createTaxFormFn != nil {
		return m.createTaxFormFn(ctx, tf)
	}
	return nil
}
func (m *mockPaymentRepo) GetTaxForm(ctx context.Context, providerID string, taxYear int) (*domain.TaxForm, error) {
	if m.getTaxFormFn != nil {
		return m.getTaxFormFn(ctx, providerID, taxYear)
	}
	return nil, nil
}
func (m *mockPaymentRepo) ListTaxForms(ctx context.Context, providerID string) ([]*domain.TaxForm, error) {
	if m.listTaxFormsFn != nil {
		return m.listTaxFormsFn(ctx, providerID)
	}
	return nil, nil
}
func (m *mockPaymentRepo) GetProviderEarningsForYear(ctx context.Context, providerID string, taxYear int) (int64, error) {
	if m.getProviderEarningsFn != nil {
		return m.getProviderEarningsFn(ctx, providerID, taxYear)
	}
	return 0, nil
}
func (m *mockPaymentRepo) UpdateTaxFormStatus(_ context.Context, _, _ string, _ *string) error {
	return nil
}

// Invoice-related stubs (satisfy interface — hookable via fn fields).
func (m *mockPaymentRepo) GetContractDetail(ctx context.Context, contractID string) (*domain.ContractDetail, error) {
	if m.getContractDetailFn != nil {
		return m.getContractDetailFn(ctx, contractID)
	}
	return nil, nil
}
func (m *mockPaymentRepo) GetContractForPayment(ctx context.Context, contractID string) (*domain.ContractForPayment, error) {
	if m.getContractForPaymentFn != nil {
		return m.getContractForPaymentFn(ctx, contractID)
	}
	// Default fixture matches the common CreatePayment test inputs (cust-1 paying
	// prov-1) with a high enough cap that legitimate amounts reconcile. Tests that
	// exercise reconciliation failures override getContractForPaymentFn.
	return &domain.ContractForPayment{
		ID:          contractID,
		CustomerID:  "cust-1",
		ProviderID:  "prov-1",
		AmountCents: 100_000_000,
		Status:      "active",
	}, nil
}
func (m *mockPaymentRepo) GetMilestonesForContract(ctx context.Context, contractID string) ([]*domain.MilestoneDetail, error) {
	if m.getMilestonesForContractFn != nil {
		return m.getMilestonesForContractFn(ctx, contractID)
	}
	return nil, nil
}
func (m *mockPaymentRepo) GetPaymentsForContract(ctx context.Context, contractID string) ([]*domain.Payment, error) {
	if m.getPaymentsForContractFn != nil {
		return m.getPaymentsForContractFn(ctx, contractID)
	}
	return nil, nil
}
func (m *mockPaymentRepo) GetProviderProfile(ctx context.Context, providerID string) (string, string, error) {
	if m.getProviderProfileFn != nil {
		return m.getProviderProfileFn(ctx, providerID)
	}
	return "", "", nil
}

// Stripe event dedup stubs. Tests that exercise HandleWebhook should override
// recordStripeEventStartFn and markStripeEventProcessedFn directly on the
// mock struct.
func (m *mockPaymentRepo) RecordStripeEventStart(ctx context.Context, eventID, eventType string) (bool, error) {
	if m.recordStripeEventStartFn != nil {
		return m.recordStripeEventStartFn(ctx, eventID, eventType)
	}
	return false, nil
}
func (m *mockPaymentRepo) MarkStripeEventProcessed(ctx context.Context, eventID string) error {
	if m.markStripeEventProcessedFn != nil {
		return m.markStripeEventProcessedFn(ctx, eventID)
	}
	return nil
}

func (m *mockPaymentRepo) SumInstantPayoutsLast24h(ctx context.Context, providerID string) (int64, error) {
	if m.sumInstantPayoutsLast24hFn != nil {
		return m.sumInstantPayoutsLast24hFn(ctx, providerID)
	}
	return 0, nil
}
func (m *mockPaymentRepo) SumAllInstantPayouts(ctx context.Context, providerID string) (int64, error) {
	if m.sumAllInstantPayoutsFn != nil {
		return m.sumAllInstantPayoutsFn(ctx, providerID)
	}
	return 0, nil
}
func (m *mockPaymentRepo) SumEligibleInstantPayoutCents(ctx context.Context, providerID string) (int64, error) {
	if m.sumEligibleInstantPayoutCentsFn != nil {
		return m.sumEligibleInstantPayoutCentsFn(ctx, providerID)
	}
	return 0, nil
}
func (m *mockPaymentRepo) LookupInstantPayoutByKey(ctx context.Context, providerID, key string) (*domain.InstantPayout, bool, error) {
	if m.lookupInstantPayoutByKeyFn != nil {
		return m.lookupInstantPayoutByKeyFn(ctx, providerID, key)
	}
	return nil, false, nil
}
func (m *mockPaymentRepo) ClaimInstantPayout(ctx context.Context, providerID string, amountCents, feeCents, netCents int64, key string) (*domain.InstantPayout, error) {
	if m.claimInstantPayoutFn != nil {
		return m.claimInstantPayoutFn(ctx, providerID, amountCents, feeCents, netCents, key)
	}
	return &domain.InstantPayout{
		ID: "ip-mock", ProviderID: providerID,
		AmountCents: amountCents, FeeCents: feeCents, NetCents: netCents,
		IdempotencyKey: key, Status: "pending",
	}, nil
}
func (m *mockPaymentRepo) CompleteInstantPayout(ctx context.Context, payoutID, stripePayoutID string) error {
	if m.completeInstantPayoutFn != nil {
		return m.completeInstantPayoutFn(ctx, payoutID, stripePayoutID)
	}
	return nil
}
func (m *mockPaymentRepo) FailInstantPayout(ctx context.Context, payoutID string) error {
	if m.failInstantPayoutFn != nil {
		return m.failInstantPayoutFn(ctx, payoutID)
	}
	return nil
}

// --- Mock Stripe Service ---

type mockStripeService struct {
	createPaymentIntentFn  func(ctx context.Context, amountCents int64, currency string, providerAccountID string, platformFeeCents int64, idempotencyKey string) (string, string, error)
	capturePaymentIntentFn func(ctx context.Context, paymentIntentID string) error
	createTransferFn       func(ctx context.Context, amountCents int64, currency string, destinationAccountID string, paymentIntentID string) (string, error)
	createRefundFn         func(ctx context.Context, paymentIntentID string, amountCents int64) (string, error)
}

// --- helpers ---

func defaultFeeConfig() *domain.FeeConfig {
	return &domain.FeeConfig{
		ID:                  "fc-default",
		FeePercentage:       0.05,
		GuaranteePercentage: 0.02,
		MinFeeCents:         100,
		Active:              true,
	}
}

func newTestPaymentService(repo *mockPaymentRepo, stripe *mockStripeService) *PaymentService {
	// We need to work with a real StripeService for the PaymentService.
	// Since tests mock at the repo level and StripeService is a concrete struct,
	// we'll create a dev-mode StripeService which provides stubs.
	ss := &StripeService{devMode: true}
	svc := NewPaymentService(repo, ss)
	// Wire a healthy default underwriter + trust source so advance-flow tests
	// (which only need the available-credit guard to clear) work. Tests that
	// exercise specific underwriting outcomes override these.
	svc.SetUnderwriter(healthyUnderwriter())
	svc.SetTrustSource(healthyTrust())
	return svc
}

// mockUnderwriter / mockTrustSource let tests control the underwriting decision
// without standing up the Rust engine.
type mockUnderwriter struct {
	fn func(ctx context.Context, f *underwritingv1.ProviderFeatures) (*underwritingv1.UnderwriteResponse, error)
}

func (m *mockUnderwriter) Underwrite(ctx context.Context, f *underwritingv1.ProviderFeatures) (*underwritingv1.UnderwriteResponse, error) {
	return m.fn(ctx, f)
}

type mockTrustSource struct {
	fn func(ctx context.Context, providerID string) (overall, feedback, fraud float64, tier string, err error)
}

func (m *mockTrustSource) GetProviderTrust(ctx context.Context, providerID string) (float64, float64, float64, string, error) {
	return m.fn(ctx, providerID)
}

// healthyUnderwriter approves a generous line — used by advance-flow tests that
// only need the available-credit guard to pass.
func healthyUnderwriter() *mockUnderwriter {
	return &mockUnderwriter{fn: func(_ context.Context, _ *underwritingv1.ProviderFeatures) (*underwritingv1.UnderwriteResponse, error) {
		return &underwritingv1.UnderwriteResponse{
			Approved:             true,
			Tier:                 underwritingv1.UnderwritingTier_UNDERWRITING_TIER_ELITE,
			MaxCreditCents:       2_500_000,
			AvailableCreditCents: 2_500_000,
			FeeBps:               650,
			FactorRate:           1.065,
			HoldbackPct:          8,
			RiskScore:            0.02,
			BindingCap:           "absolute_max",
			DecisionHash:         "testhash",
			ModelVersion:         "uw-test",
		}, nil
	}}
}

func healthyTrust() *mockTrustSource {
	return &mockTrustSource{fn: func(_ context.Context, _ string) (float64, float64, float64, string, error) {
		return 0.95, 0.95, 1.0, "top_rated", nil
	}}
}

// --- CalculateFees tests ---

func TestPaymentService_CalculateFees(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name               string
		amountCents        int64
		categoryID         *string
		feeConfig          *domain.FeeConfig
		wantErr            error
		wantPlatformFee    int64
		wantGuaranteeFee   int64
		wantProviderPayout int64
		wantLeadGenFee     int64
	}{
		{
			name:        "standard_5_percent_fee",
			amountCents: 10000, // $100.00
			feeConfig: &domain.FeeConfig{
				FeePercentage:       0.05,
				GuaranteePercentage: 0.02,
				MinFeeCents:         100,
			},
			wantPlatformFee:    500,  // 5% of 10000
			wantGuaranteeFee:   200,  // 2% of 10000
			wantProviderPayout: 9300, // 10000 - 500 - 200
		},
		{
			name:        "minimum_fee_enforced",
			amountCents: 500, // $5.00 -> 5% = 25 cents, below min of 100
			feeConfig: &domain.FeeConfig{
				FeePercentage:       0.05,
				GuaranteePercentage: 0.02,
				MinFeeCents:         100,
			},
			wantPlatformFee:    100, // min fee
			wantGuaranteeFee:   10,  // 2% of 500
			wantProviderPayout: 390, // 500 - 100 - 10
		},
		{
			name:        "maximum_fee_cap",
			amountCents: 1000000, // $10,000
			feeConfig: func() *domain.FeeConfig {
				maxFee := int64(5000) // $50 cap
				return &domain.FeeConfig{
					FeePercentage:       0.05,
					GuaranteePercentage: 0.02,
					MinFeeCents:         100,
					MaxFeeCents:         &maxFee,
				}
			}(),
			wantPlatformFee:    5000,   // capped at max
			wantGuaranteeFee:   20000,  // 2% of 1000000
			wantProviderPayout: 975000, // 1000000 - 5000 - 20000
		},
		{
			name:        "lead_gen_disabled_no_extra_deduction",
			amountCents: 10000,
			feeConfig: &domain.FeeConfig{
				FeePercentage:       0.05,
				GuaranteePercentage: 0.02,
				MinFeeCents:         100,
				LeadGenEnabled:      false,
				LeadGenPercentage:   0.10,
			},
			wantPlatformFee:    500,
			wantGuaranteeFee:   200,
			wantLeadGenFee:     0,
			wantProviderPayout: 9300, // unchanged when lead-gen disabled
		},
		{
			name:        "lead_gen_enabled_percentage",
			amountCents: 10000,
			feeConfig: &domain.FeeConfig{
				FeePercentage:       0.05,
				GuaranteePercentage: 0.02,
				MinFeeCents:         100,
				LeadGenEnabled:      true,
				LeadGenPercentage:   0.10, // 10% = 1000
			},
			wantPlatformFee:    500,
			wantGuaranteeFee:   200,
			wantLeadGenFee:     1000,
			wantProviderPayout: 8300, // 10000 - 500 - 200 - 1000
		},
		{
			name:        "lead_gen_min_enforced",
			amountCents: 1000, // 10% = 100, below min 250
			feeConfig: &domain.FeeConfig{
				FeePercentage:       0.05,
				GuaranteePercentage: 0.02,
				MinFeeCents:         0,
				LeadGenEnabled:      true,
				LeadGenPercentage:   0.10,
				LeadGenMinFeeCents:  250,
			},
			wantPlatformFee:    50,
			wantGuaranteeFee:   20,
			wantLeadGenFee:     250, // min enforced
			wantProviderPayout: 680, // 1000 - 50 - 20 - 250
		},
		{
			name:        "lead_gen_max_capped",
			amountCents: 100000, // 10% = 10000, capped at 3000
			feeConfig: func() *domain.FeeConfig {
				cap := int64(3000)
				return &domain.FeeConfig{
					FeePercentage:       0.05,
					GuaranteePercentage: 0.02,
					MinFeeCents:         0,
					LeadGenEnabled:      true,
					LeadGenPercentage:   0.10,
					LeadGenMaxFeeCents:  &cap,
				}
			}(),
			wantPlatformFee:    5000,
			wantGuaranteeFee:   2000,
			wantLeadGenFee:     3000,  // capped
			wantProviderPayout: 90000, // 100000 - 5000 - 2000 - 3000
		},
		{
			name:        "zero_amount_returns_error",
			amountCents: 0,
			wantErr:     domain.ErrInvalidAmount,
		},
		{
			name:        "negative_amount_returns_error",
			amountCents: -100,
			wantErr:     domain.ErrInvalidAmount,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockPaymentRepo{
				getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
					if tt.feeConfig != nil {
						return tt.feeConfig, nil
					}
					return defaultFeeConfig(), nil
				},
				getFeeConfigFn: func(_ context.Context, _ string) (*domain.FeeConfig, error) {
					return nil, domain.ErrFeeConfigNotFound
				},
			}
			svc := newTestPaymentService(repo, nil)

			breakdown, err := svc.CalculateFees(context.Background(), tt.amountCents, tt.categoryID)

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr))
				return
			}

			require.NoError(t, err)
			require.NotNil(t, breakdown)
			assert.Equal(t, tt.wantPlatformFee, breakdown.PlatformFeeCents)
			assert.Equal(t, tt.wantGuaranteeFee, breakdown.GuaranteeFeeCents)
			assert.Equal(t, tt.wantLeadGenFee, breakdown.LeadGenFeeCents)
			assert.Equal(t, tt.wantProviderPayout, breakdown.ProviderPayoutCents)
			assert.Equal(t, tt.amountCents, breakdown.TotalCents)
		})
	}
}

func TestPaymentService_CalculateFees_with_category(t *testing.T) {
	t.Parallel()

	catID := "cat-plumbing"
	repo := &mockPaymentRepo{
		getFeeConfigFn: func(_ context.Context, categoryID string) (*domain.FeeConfig, error) {
			assert.Equal(t, "cat-plumbing", categoryID)
			return &domain.FeeConfig{
				FeePercentage:       0.03, // Lower fee for plumbing
				GuaranteePercentage: 0.01,
				MinFeeCents:         50,
			}, nil
		},
	}
	svc := newTestPaymentService(repo, nil)

	breakdown, err := svc.CalculateFees(context.Background(), 10000, &catID)

	require.NoError(t, err)
	assert.Equal(t, int64(300), breakdown.PlatformFeeCents)  // 3% of 10000
	assert.Equal(t, int64(100), breakdown.GuaranteeFeeCents) // 1% of 10000
	assert.Equal(t, int64(9600), breakdown.ProviderPayoutCents)
}

func TestPaymentService_CalculateFees_category_fallback_to_default(t *testing.T) {
	t.Parallel()

	catID := "cat-nonexistent"
	repo := &mockPaymentRepo{
		getFeeConfigFn: func(_ context.Context, _ string) (*domain.FeeConfig, error) {
			return nil, domain.ErrFeeConfigNotFound
		},
		getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
			return &domain.FeeConfig{
				FeePercentage:       0.05,
				GuaranteePercentage: 0.02,
				MinFeeCents:         100,
			}, nil
		},
	}
	svc := newTestPaymentService(repo, nil)

	breakdown, err := svc.CalculateFees(context.Background(), 10000, &catID)

	require.NoError(t, err)
	assert.Equal(t, int64(500), breakdown.PlatformFeeCents) // Default 5%
}

// --- CreatePayment tests ---

func TestPaymentService_CreatePayment(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		input      domain.CreatePaymentInput
		wantErr    error
		wantStatus string
	}{
		{
			name: "successful_creation",
			input: domain.CreatePaymentInput{
				ContractID:     "contract-1",
				CustomerID:     "cust-1",
				ProviderID:     "prov-1",
				AmountCents:    10000,
				IdempotencyKey: "idem-1",
			},
			wantStatus: "pending",
		},
		{
			name: "zero_amount_returns_error",
			input: domain.CreatePaymentInput{
				ContractID:  "contract-1",
				CustomerID:  "cust-1",
				ProviderID:  "prov-1",
				AmountCents: 0,
			},
			wantErr: domain.ErrInvalidAmount,
		},
		{
			name: "negative_amount_returns_error",
			input: domain.CreatePaymentInput{
				ContractID:  "contract-1",
				CustomerID:  "cust-1",
				ProviderID:  "prov-1",
				AmountCents: -500,
			},
			wantErr: domain.ErrInvalidAmount,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var storedPayment *domain.Payment
			repo := &mockPaymentRepo{
				getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
					return defaultFeeConfig(), nil
				},
				getFeeConfigFn: func(_ context.Context, _ string) (*domain.FeeConfig, error) {
					return nil, domain.ErrFeeConfigNotFound
				},
				getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
					return "acct_prov_1", nil
				},
				createPaymentFn: func(_ context.Context, payment *domain.Payment) error {
					storedPayment = payment
					return nil
				},
				updateStripeFieldsFn: func(_ context.Context, _, _, _, _ string) error {
					return nil
				},
				getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
					if storedPayment != nil {
						return storedPayment, nil
					}
					return nil, domain.ErrPaymentNotFound
				},
			}
			svc := newTestPaymentService(repo, nil)

			payment, clientSecret, err := svc.CreatePayment(context.Background(), tt.input)

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr))
				return
			}

			require.NoError(t, err)
			require.NotNil(t, payment)
			assert.NotEmpty(t, payment.ID)
			assert.Equal(t, "pending", payment.Status)
			assert.NotEmpty(t, clientSecret)
			assert.Equal(t, tt.input.CustomerID, payment.CustomerID)
			assert.Equal(t, tt.input.ProviderID, payment.ProviderID)
			assert.Equal(t, tt.input.AmountCents, payment.AmountCents)
			assert.Greater(t, payment.PlatformFeeCents, int64(0))
		})
	}
}

// TestPaymentService_CreatePayment_LeadGenLedgerReconciles is the regression
// guard for the money-ledger invariant: the persisted payment split
// (platform_fee + guarantee_fee + provider_payout) MUST equal amount_cents so
// the payments table self-reconciles with no cents created or destroyed. The
// payments row has no lead_gen_fee_cents column, so when lead-gen is enabled the
// lead-gen slice is folded into the stored platform fee. Real Stripe money
// movement (platform retains platform+guarantee+leadgen) is unchanged.
func TestPaymentService_CreatePayment_LeadGenLedgerReconciles(t *testing.T) {
	t.Parallel()

	var stored *domain.Payment
	repo := &mockPaymentRepo{
		getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
			return &domain.FeeConfig{
				ID:                  "fc-leadgen",
				FeePercentage:       0.08, // 800 on 10000
				GuaranteePercentage: 0.02, // 200 on 10000
				MinFeeCents:         100,
				LeadGenEnabled:      true,
				LeadGenPercentage:   0.10, // 1000 on 10000
				Active:              true,
			}, nil
		},
		getFeeConfigFn: func(_ context.Context, _ string) (*domain.FeeConfig, error) {
			return nil, domain.ErrFeeConfigNotFound
		},
		getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
			return "acct_prov_1", nil
		},
		createPaymentFn: func(_ context.Context, p *domain.Payment) error {
			stored = p
			return nil
		},
		updateStripeFieldsFn: func(_ context.Context, _, _, _, _ string) error { return nil },
		getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
			if stored != nil {
				return stored, nil
			}
			return nil, domain.ErrPaymentNotFound
		},
	}
	svc := newTestPaymentService(repo, nil)

	payment, _, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:     "contract-1",
		CustomerID:     "cust-1",
		ProviderID:     "prov-1",
		AmountCents:    10000,
		IdempotencyKey: "idem-leadgen",
	})
	require.NoError(t, err)
	require.NotNil(t, stored)

	// The persisted split must sum to amount_cents exactly — no cents lost to the
	// lead-gen slice. platform(800)+leadgen(1000)=1800 folded, guarantee=200,
	// payout=8000 → 1800+200+8000 = 10000.
	assert.Equal(t, int64(1800), stored.PlatformFeeCents)
	assert.Equal(t, int64(200), stored.GuaranteeFeeCents)
	assert.Equal(t, int64(8000), stored.ProviderPayoutCents)
	assert.Equal(t,
		payment.AmountCents,
		stored.PlatformFeeCents+stored.GuaranteeFeeCents+stored.ProviderPayoutCents,
		"persisted payment split must reconcile to amount_cents",
	)
}

// --- ProcessPayment tests ---

func TestPaymentService_ProcessPayment(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		payment    *domain.Payment
		wantErr    error
		wantStatus string
	}{
		{
			name: "successful_processing",
			payment: &domain.Payment{
				ID:                    "pay-1",
				Status:                "pending",
				StripePaymentIntentID: "pi_123",
			},
			wantStatus: "escrow",
		},
		{
			name: "already_processed_returns_error",
			payment: &domain.Payment{
				ID:     "pay-2",
				Status: "escrow",
			},
			wantErr: domain.ErrPaymentAlreadyProcessed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			currentStatus := tt.payment.Status
			repo := &mockPaymentRepo{
				getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
					p := *tt.payment
					p.Status = currentStatus
					return &p, nil
				},
				updatePaymentStatusFn: func(_ context.Context, _ string, status string) error {
					currentStatus = status
					return nil
				},
			}
			svc := newTestPaymentService(repo, nil)

			payment, err := svc.ProcessPayment(context.Background(), tt.payment.ID, "pm_test")

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr))
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.wantStatus, payment.Status)
		})
	}
}

// --- ReleaseEscrow tests ---

func TestPaymentService_ReleaseEscrow(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		payment    *domain.Payment
		wantErr    error
		wantStatus string
	}{
		{
			name: "successful_release",
			payment: &domain.Payment{
				ID:                    "pay-1",
				Status:                "escrow",
				ProviderID:            "prov-1",
				ProviderPayoutCents:   9300,
				StripePaymentIntentID: "pi_123",
			},
			wantStatus: "released",
		},
		{
			name: "not_in_escrow_returns_error",
			payment: &domain.Payment{
				ID:     "pay-2",
				Status: "pending",
			},
			wantErr: domain.ErrInvalidStatus,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			currentStatus := tt.payment.Status
			repo := &mockPaymentRepo{
				getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
					p := *tt.payment
					p.Status = currentStatus
					return &p, nil
				},
				updatePaymentStatusFn: func(_ context.Context, _ string, status string) error {
					currentStatus = status
					return nil
				},
				getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
					return "acct_prov_1", nil
				},
				updateStripeFieldsFn: func(_ context.Context, _, _, _, _ string) error {
					return nil
				},
			}
			svc := newTestPaymentService(repo, nil)

			payment, err := svc.ReleaseEscrow(context.Background(), tt.payment.ID, "job completed", ReleaseActor{IsAdmin: true})

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr))
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.wantStatus, payment.Status)
		})
	}
}

// --- CreateRefund tests ---

func TestPaymentService_CreateRefund(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		payment     *domain.Payment
		refundCents int64
		wantErr     error
		wantStatus  string
	}{
		{
			name: "full_refund",
			payment: &domain.Payment{
				ID:                    "pay-1",
				Status:                "escrow",
				AmountCents:           10000,
				StripePaymentIntentID: "pi_123",
			},
			refundCents: 0, // 0 means full refund
			wantStatus:  "refunded",
		},
		{
			name: "partial_refund",
			payment: &domain.Payment{
				ID:                    "pay-2",
				Status:                "released",
				AmountCents:           10000,
				StripePaymentIntentID: "pi_456",
			},
			refundCents: 5000,
			wantStatus:  "partially_refunded",
		},
		{
			name: "invalid_status_returns_error",
			payment: &domain.Payment{
				ID:     "pay-3",
				Status: "pending",
			},
			refundCents: 0,
			wantErr:     domain.ErrInvalidStatus,
		},
		{
			name: "over_refund_exceeding_amount_rejected",
			payment: &domain.Payment{
				ID:                    "pay-4",
				Status:                "completed",
				AmountCents:           60000,
				StripePaymentIntentID: "pi_over",
			},
			refundCents: 999999, // far more than the 60000 held
			wantErr:     domain.ErrInvalidAmount,
		},
		{
			name: "negative_refund_rejected",
			payment: &domain.Payment{
				ID:                    "pay-5",
				Status:                "escrow",
				AmountCents:           10000,
				StripePaymentIntentID: "pi_neg",
			},
			refundCents: -100,
			wantErr:     domain.ErrInvalidAmount,
		},
		{
			name: "refund_capped_at_remaining_after_prior_partial",
			payment: &domain.Payment{
				ID:                    "pay-6",
				Status:                "escrow",
				AmountCents:           10000,
				RefundAmountCents:     7000, // 3000 remaining
				StripePaymentIntentID: "pi_partial",
			},
			refundCents: 5000, // would push cumulative to 12000 > 10000
			wantErr:     domain.ErrInvalidAmount,
		},
		{
			name: "remaining_partial_refund_accumulates_to_full",
			payment: &domain.Payment{
				ID:                    "pay-7",
				Status:                "escrow",
				AmountCents:           10000,
				RefundAmountCents:     6000, // 4000 remaining
				StripePaymentIntentID: "pi_acc",
			},
			refundCents: 4000, // exactly remaining -> cumulative 10000 -> fully refunded
			wantStatus:  "refunded",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			currentStatus := tt.payment.Status
			repo := &mockPaymentRepo{
				getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
					p := *tt.payment
					p.Status = currentStatus
					return &p, nil
				},
				updateRefundFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _ string, status string) error {
					currentStatus = status
					return nil
				},
			}
			svc := newTestPaymentService(repo, nil)

			payment, err := svc.CreateRefund(context.Background(), tt.payment.ID, tt.refundCents, "customer requested", ReleaseActor{IsAdmin: true})

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr))
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.wantStatus, payment.Status)
		})
	}
}

// --- Escrow state transition tests ---

func TestPaymentService_EscrowStateTransitions(t *testing.T) {
	t.Parallel()

	// Test valid transitions: pending -> processing -> escrow -> released
	tests := []struct {
		name           string
		initialStatus  string
		operation      string
		wantNextStatus string
		wantErr        bool
	}{
		{name: "pending_to_escrow_via_process", initialStatus: "pending", operation: "process", wantNextStatus: "escrow"},
		{name: "escrow_to_released", initialStatus: "escrow", operation: "release", wantNextStatus: "released"},
		{name: "escrow_to_refunded", initialStatus: "escrow", operation: "refund", wantNextStatus: "refunded"},
		{name: "released_to_refunded", initialStatus: "released", operation: "refund", wantNextStatus: "refunded"},
		// Invalid transitions
		{name: "pending_cannot_release", initialStatus: "pending", operation: "release", wantErr: true},
		{name: "pending_cannot_refund", initialStatus: "pending", operation: "refund", wantErr: true},
		{name: "escrow_cannot_process_again", initialStatus: "escrow", operation: "process", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			currentStatus := tt.initialStatus
			payment := &domain.Payment{
				ID:                    "pay-state",
				Status:                tt.initialStatus,
				AmountCents:           10000,
				ProviderID:            "prov-1",
				ProviderPayoutCents:   9300,
				StripePaymentIntentID: "pi_test",
			}

			repo := &mockPaymentRepo{
				getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
					p := *payment
					p.Status = currentStatus
					return &p, nil
				},
				updatePaymentStatusFn: func(_ context.Context, _ string, status string) error {
					currentStatus = status
					return nil
				},
				getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
					return "acct_prov_1", nil
				},
				updateStripeFieldsFn: func(_ context.Context, _, _, _, _ string) error {
					return nil
				},
				updateRefundFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _ string, status string) error {
					currentStatus = status
					return nil
				},
			}
			svc := newTestPaymentService(repo, nil)
			ctx := context.Background()

			var err error
			switch tt.operation {
			case "process":
				_, err = svc.ProcessPayment(ctx, payment.ID, "pm_test")
			case "release":
				_, err = svc.ReleaseEscrow(ctx, payment.ID, "completed", ReleaseActor{IsAdmin: true})
			case "refund":
				_, err = svc.CreateRefund(ctx, payment.ID, 0, "requested", ReleaseActor{IsAdmin: true})
			}

			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.wantNextStatus, currentStatus)
		})
	}
}

// --- GetPayment tests ---

func TestPaymentService_GetPayment(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		repoFn  func(ctx context.Context, id string) (*domain.Payment, error)
		wantErr bool
	}{
		{
			name: "found",
			repoFn: func(_ context.Context, id string) (*domain.Payment, error) {
				return &domain.Payment{ID: id, Status: "pending"}, nil
			},
		},
		{
			name: "not_found",
			repoFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return nil, domain.ErrPaymentNotFound
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockPaymentRepo{getPaymentFn: tt.repoFn}
			svc := newTestPaymentService(repo, nil)

			payment, err := svc.GetPayment(context.Background(), "pay-1")

			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, "pay-1", payment.ID)
		})
	}
}

// --- GetFeeConfig tests ---

func TestPaymentService_GetFeeConfig(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		categoryID     *string
		catFeeConfig   *domain.FeeConfig
		catErr         error
		defaultConfig  *domain.FeeConfig
		defaultErr     error
		wantPercentage float64
	}{
		{
			name:       "nil_category_returns_default",
			categoryID: nil,
			defaultConfig: &domain.FeeConfig{
				FeePercentage: 0.05,
			},
			wantPercentage: 0.05,
		},
		{
			name: "category_found",
			categoryID: func() *string {
				s := "cat-1"
				return &s
			}(),
			catFeeConfig: &domain.FeeConfig{
				FeePercentage: 0.03,
			},
			wantPercentage: 0.03,
		},
		{
			name: "category_not_found_falls_back_to_default",
			categoryID: func() *string {
				s := "cat-unknown"
				return &s
			}(),
			catErr: domain.ErrFeeConfigNotFound,
			defaultConfig: &domain.FeeConfig{
				FeePercentage: 0.05,
			},
			wantPercentage: 0.05,
		},
		{
			// Fresh platform: no category config AND no default row persisted.
			// Must succeed with the standard default config (5%), not error —
			// otherwise the admin fee-config read 500s on a predictable
			// empty-state.
			name:           "nil_category_no_default_row_returns_standard_default",
			categoryID:     nil,
			defaultErr:     domain.ErrFeeConfigNotFound,
			wantPercentage: domain.DefaultFeeConfig().FeePercentage,
		},
		{
			name: "category_and_default_both_missing_returns_standard_default",
			categoryID: func() *string {
				s := "cat-unknown"
				return &s
			}(),
			catErr:         domain.ErrFeeConfigNotFound,
			defaultErr:     domain.ErrFeeConfigNotFound,
			wantPercentage: domain.DefaultFeeConfig().FeePercentage,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockPaymentRepo{
				getFeeConfigFn: func(_ context.Context, _ string) (*domain.FeeConfig, error) {
					if tt.catFeeConfig != nil {
						return tt.catFeeConfig, nil
					}
					if tt.catErr != nil {
						return nil, tt.catErr
					}
					return nil, domain.ErrFeeConfigNotFound
				},
				getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
					if tt.defaultErr != nil {
						return nil, tt.defaultErr
					}
					if tt.defaultConfig != nil {
						return tt.defaultConfig, nil
					}
					return defaultFeeConfig(), nil
				},
			}
			svc := newTestPaymentService(repo, nil)

			fc, err := svc.GetFeeConfig(context.Background(), tt.categoryID)

			require.NoError(t, err)
			assert.InDelta(t, tt.wantPercentage, fc.FeePercentage, 0.001)
		})
	}
}

// A real (non-missing-row) error from the default fee-config lookup must still
// propagate as an error — only the missing-row case falls back to defaults.
func TestPaymentService_GetFeeConfig_RealErrorPropagates(t *testing.T) {
	t.Parallel()

	dbErr := errors.New("connection refused")
	repo := &mockPaymentRepo{
		getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
			return nil, dbErr
		},
	}
	svc := newTestPaymentService(repo, nil)

	fc, err := svc.GetFeeConfig(context.Background(), nil)

	require.Error(t, err)
	assert.Nil(t, fc)
	assert.ErrorIs(t, err, dbErr)
}
