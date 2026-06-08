package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// InstallmentService handles BNPL installment plan business logic.
type InstallmentService struct {
	repo   domain.PaymentRepository
	stripe *StripeService
}

// NewInstallmentService creates a new InstallmentService.
func NewInstallmentService(repo domain.PaymentRepository, stripe *StripeService) *InstallmentService {
	return &InstallmentService{repo: repo, stripe: stripe}
}

// feeRateForCount returns the BNPL fee rate for a given installment count.
func feeRateForCount(count int) (float64, error) {
	switch count {
	case 3:
		return 0.03, nil // 3%
	case 6:
		return 0.05, nil // 5%
	default:
		return 0, domain.ErrInvalidInstallmentCount
	}
}

// CreateInstallmentPlan creates a BNPL installment plan, pays the provider
// in full immediately, and charges the customer's first installment.
func (s *InstallmentService) CreateInstallmentPlan(ctx context.Context, input domain.CreateInstallmentPlanInput) (*domain.InstallmentPlan, string, error) {
	// Validate installment count.
	if input.InstallmentCount != 3 && input.InstallmentCount != 6 {
		return nil, "", fmt.Errorf("create installment plan: %w", domain.ErrInvalidInstallmentCount)
	}

	if input.TotalAmountCents <= 0 {
		return nil, "", fmt.Errorf("create installment plan: %w", domain.ErrInvalidAmount)
	}

	// Calculate fee.
	feeRate, err := feeRateForCount(input.InstallmentCount)
	if err != nil {
		return nil, "", fmt.Errorf("create installment plan fee rate: %w", err)
	}

	bnplFeeCents := int64(float64(input.TotalAmountCents) * feeRate)
	totalWithFeeCents := input.TotalAmountCents + bnplFeeCents

	// Calculate per-installment amount. Distribute evenly, adjust last for rounding.
	count := int64(input.InstallmentCount)
	perInstallmentCents := totalWithFeeCents / count

	planID := uuid.New().String()

	plan := &domain.InstallmentPlan{
		ID:                  planID,
		ContractID:          input.ContractID,
		CustomerID:          input.CustomerID,
		ProviderID:          input.ProviderID,
		TotalAmountCents:    input.TotalAmountCents,
		BNPLFeeCents:        bnplFeeCents,
		TotalWithFeeCents:   totalWithFeeCents,
		InstallmentCount:    input.InstallmentCount,
		PerInstallmentCents: perInstallmentCents,
		FeeRate:             feeRate,
		Status:              "active",
	}

	// Validate the provider can actually receive the immediate payout BEFORE
	// persisting anything. A provider without Stripe onboarding (ErrStripeAccountNotFound)
	// would otherwise fail AFTER the plan + installments are written, leaving an
	// orphaned 'active' plan that hides the BNPL selector and shows no schedule —
	// the customer gets stuck. Fail fast here so no rows are written on that path.
	providerAccountID, err := s.repo.GetStripeAccountID(ctx, input.ProviderID)
	if err != nil {
		slog.Error("failed to get provider stripe account for BNPL transfer",
			"provider_id", input.ProviderID, "error", err)
		return nil, "", fmt.Errorf("create installment plan provider account: %w", err)
	}

	// Create the installment plan record.
	if err := s.repo.CreateInstallmentPlan(ctx, plan); err != nil {
		return nil, "", fmt.Errorf("create installment plan db: %w", err)
	}

	// Create scheduled installments with due dates 30 days apart.
	now := time.Now()
	installments := make([]domain.ScheduledInstallment, 0, input.InstallmentCount)
	for i := 0; i < input.InstallmentCount; i++ {
		amount := perInstallmentCents
		// Adjust last installment for rounding remainder.
		if i == input.InstallmentCount-1 {
			alreadyAllocated := perInstallmentCents * int64(input.InstallmentCount-1)
			amount = totalWithFeeCents - alreadyAllocated
		}

		dueDate := now.AddDate(0, 0, 30*i) // first is due today (i=0)

		installments = append(installments, domain.ScheduledInstallment{
			ID:                uuid.New().String(),
			PlanID:            planID,
			InstallmentNumber: i + 1,
			AmountCents:       amount,
			DueDate:           dueDate,
			Status:            "scheduled",
			Attempts:          0,
		})
	}

	if err := s.repo.CreateScheduledInstallments(ctx, installments); err != nil {
		return nil, "", fmt.Errorf("create scheduled installments: %w", err)
	}

	// Pay provider in full immediately via platform transfer (account validated
	// up front, before any rows were written).
	transferID, err := s.stripe.CreatePlatformTransfer(ctx, input.TotalAmountCents, "usd", providerAccountID)
	if err != nil {
		slog.Error("failed to create platform transfer for BNPL",
			"plan_id", planID,
			"amount_cents", input.TotalAmountCents,
			"error", err,
		)
		return nil, "", fmt.Errorf("create installment plan provider transfer: %w", err)
	}

	if err := s.repo.UpdateInstallmentPlanProviderPaid(ctx, planID, transferID); err != nil {
		slog.Error("failed to update provider paid status",
			"plan_id", planID,
			"transfer_id", transferID,
			"error", err,
		)
		return nil, "", fmt.Errorf("create installment plan update provider paid: %w", err)
	}

	slog.Info("provider paid in full for BNPL plan",
		"plan_id", planID,
		"provider_id", input.ProviderID,
		"amount_cents", input.TotalAmountCents,
		"transfer_id", transferID,
	)

	// Charge first installment now.
	firstInstallment := installments[0]
	customerStripeID, err := s.repo.GetStripeCustomerID(ctx, input.CustomerID)
	if err != nil {
		slog.Warn("failed to get customer stripe id for first installment, using platform id",
			"customer_id", input.CustomerID,
			"error", err,
		)
		customerStripeID = input.CustomerID
	}

	metadata := map[string]string{
		"installment_plan_id":      planID,
		"scheduled_installment_id": firstInstallment.ID,
		"installment_number":       fmt.Sprintf("%d", firstInstallment.InstallmentNumber),
		"idempotency_key":          input.IdempotencyKey,
	}

	piID, clientSecret, err := s.stripe.CreateOffSessionPaymentIntent(
		ctx,
		firstInstallment.AmountCents,
		"usd",
		customerStripeID,
		input.PaymentMethodID,
		metadata,
	)
	if err != nil {
		slog.Error("failed to charge first installment",
			"plan_id", planID,
			"installment_id", firstInstallment.ID,
			"error", err,
		)
		// Mark as processing — event handler will resolve.
		_ = s.repo.UpdateScheduledInstallmentStatus(ctx, firstInstallment.ID, "processing", nil)
		return nil, "", fmt.Errorf("create installment plan first charge: %w", err)
	}

	// Mark first installment as paid.
	if err := s.repo.UpdateScheduledInstallmentStatus(ctx, firstInstallment.ID, "paid", &piID); err != nil {
		slog.Error("failed to mark first installment as paid",
			"plan_id", planID,
			"installment_id", firstInstallment.ID,
			"error", err,
		)
	}

	slog.Info("first installment charged for BNPL plan",
		"plan_id", planID,
		"installment_id", firstInstallment.ID,
		"amount_cents", firstInstallment.AmountCents,
		"pi_id", piID,
	)

	// Re-fetch the plan to get the latest state.
	updatedPlan, err := s.repo.GetInstallmentPlan(ctx, planID)
	if err != nil {
		return nil, "", fmt.Errorf("create installment plan refetch: %w", err)
	}

	return updatedPlan, clientSecret, nil
}

// ProcessDueInstallments finds all installments due today or earlier and charges them.
func (s *InstallmentService) ProcessDueInstallments(ctx context.Context) error {
	today := time.Now()

	dueInstallments, err := s.repo.GetDueInstallments(ctx, today)
	if err != nil {
		return fmt.Errorf("process due installments fetch: %w", err)
	}

	if len(dueInstallments) == 0 {
		slog.Info("no due installments to process")
		return nil
	}

	slog.Info("processing due installments", "count", len(dueInstallments))

	for _, inst := range dueInstallments {
		if err := s.processOneInstallment(ctx, inst); err != nil {
			slog.Error("failed to process installment",
				"installment_id", inst.ID,
				"plan_id", inst.PlanID,
				"error", err,
			)
			// Continue processing other installments.
		}
	}

	return nil
}

func (s *InstallmentService) processOneInstallment(ctx context.Context, inst domain.ScheduledInstallment) error {
	// Get the plan to find the customer info.
	plan, err := s.repo.GetInstallmentPlan(ctx, inst.PlanID)
	if err != nil {
		return fmt.Errorf("get plan for installment %s: %w", inst.ID, err)
	}

	// Mark as processing.
	if err := s.repo.UpdateScheduledInstallmentStatus(ctx, inst.ID, "processing", nil); err != nil {
		return fmt.Errorf("mark installment processing: %w", err)
	}

	// Get customer Stripe ID.
	customerStripeID, err := s.repo.GetStripeCustomerID(ctx, plan.CustomerID)
	if err != nil {
		slog.Warn("failed to get customer stripe id for installment, using platform id",
			"customer_id", plan.CustomerID,
			"error", err,
		)
		customerStripeID = plan.CustomerID
	}

	metadata := map[string]string{
		"installment_plan_id":      inst.PlanID,
		"scheduled_installment_id": inst.ID,
		"installment_number":       fmt.Sprintf("%d", inst.InstallmentNumber),
	}

	// Attempt charge with empty payment method (Stripe uses the customer's default).
	piID, _, err := s.stripe.CreateOffSessionPaymentIntent(
		ctx,
		inst.AmountCents,
		"usd",
		customerStripeID,
		"", // uses customer's default payment method
		metadata,
	)
	if err != nil {
		slog.Error("installment charge failed",
			"installment_id", inst.ID,
			"plan_id", inst.PlanID,
			"attempt", inst.Attempts+1,
			"error", err,
		)

		// Update as failed. The repo method handles retrying logic (increments attempts,
		// sets retrying if < 3 attempts, failed if >= 3).
		if updateErr := s.repo.UpdateScheduledInstallmentStatus(ctx, inst.ID, "failed", nil); updateErr != nil {
			slog.Error("failed to update installment status after charge failure",
				"installment_id", inst.ID,
				"error", updateErr,
			)
		}

		// Check if this was the 3rd attempt — if so, default the plan.
		if inst.Attempts+1 >= 3 {
			slog.Warn("installment plan defaulted due to max retry attempts",
				"plan_id", inst.PlanID,
				"installment_id", inst.ID,
			)
			if planErr := s.repo.UpdateInstallmentPlanStatus(ctx, inst.PlanID, "defaulted"); planErr != nil {
				slog.Error("failed to default installment plan",
					"plan_id", inst.PlanID,
					"error", planErr,
				)
			}
		}

		return fmt.Errorf("installment charge failed: %w", err)
	}

	// Charge succeeded — mark as paid.
	if err := s.repo.UpdateScheduledInstallmentStatus(ctx, inst.ID, "paid", &piID); err != nil {
		return fmt.Errorf("mark installment paid: %w", err)
	}

	slog.Info("installment charged successfully",
		"installment_id", inst.ID,
		"plan_id", inst.PlanID,
		"amount_cents", inst.AmountCents,
		"pi_id", piID,
	)

	// Check if all installments for this plan are paid.
	if err := s.checkPlanCompletion(ctx, inst.PlanID); err != nil {
		slog.Error("failed to check plan completion",
			"plan_id", inst.PlanID,
			"error", err,
		)
	}

	return nil
}

// checkPlanCompletion checks if all installments for a plan are paid and marks it completed.
func (s *InstallmentService) checkPlanCompletion(ctx context.Context, planID string) error {
	installments, err := s.repo.GetScheduledInstallmentsForPlan(ctx, planID)
	if err != nil {
		return fmt.Errorf("check plan completion: %w", err)
	}

	allPaid := true
	for _, inst := range installments {
		if inst.Status != "paid" {
			allPaid = false
			break
		}
	}

	if allPaid {
		slog.Info("all installments paid, completing plan", "plan_id", planID)
		if err := s.repo.UpdateInstallmentPlanStatus(ctx, planID, "completed"); err != nil {
			return fmt.Errorf("complete plan: %w", err)
		}
	}

	return nil
}

// GetInstallmentPlan retrieves an installment plan by ID, enforcing ownership.
//
// A BNPL plan is private to its two parties: the customer who owes the
// installments and the provider who was paid. The caller (identified by
// callerUserID, taken from the gateway's verified JWT claims) may read a plan
// only if they are that customer or provider, or an admin. To avoid leaking the
// existence of a plan to unrelated users (IDOR enumeration), an unauthorized
// caller gets ErrInstallmentPlanNotFound — the same response as a missing id —
// rather than a distinguishable forbidden error.
func (s *InstallmentService) GetInstallmentPlan(ctx context.Context, planID, callerUserID string, callerIsAdmin bool) (*domain.InstallmentPlan, error) {
	plan, err := s.repo.GetInstallmentPlan(ctx, planID)
	if err != nil {
		return nil, err
	}

	if !callerIsAdmin && callerUserID != plan.CustomerID && callerUserID != plan.ProviderID {
		slog.Warn("installment plan access denied: caller is not owner",
			"plan_id", planID,
			"caller_user_id", callerUserID,
		)
		return nil, domain.ErrInstallmentPlanNotFound
	}

	return plan, nil
}

// ListInstallmentPlans lists installment plans for a user.
func (s *InstallmentService) ListInstallmentPlans(ctx context.Context, userID string, statusFilter string, page, pageSize int) ([]*domain.InstallmentPlan, int, error) {
	return s.repo.ListInstallmentPlans(ctx, userID, statusFilter, page, pageSize)
}

// ConfirmInstallmentPaymentSucceeded is called from the payment event handler when a
// payment_intent.succeeded event includes installment metadata. It marks the
// installment as paid and checks plan completion.
func (s *InstallmentService) ConfirmInstallmentPaymentSucceeded(ctx context.Context, planID, installmentID, paymentIntentID string) error {
	if err := s.repo.UpdateScheduledInstallmentStatus(ctx, installmentID, "paid", &paymentIntentID); err != nil {
		return fmt.Errorf("confirm installment payment succeeded: %w", err)
	}

	slog.Info("installment payment confirmed via event",
		"plan_id", planID,
		"installment_id", installmentID,
		"pi_id", paymentIntentID,
	)

	// Check if all installments for this plan are now paid.
	return s.checkPlanCompletion(ctx, planID)
}
