package service

import (
	"context"
	"fmt"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// GetPlatformBankAccount returns the current default platform payout bank
// account, or (nil, nil) if none is configured.
func (s *PaymentService) GetPlatformBankAccount(ctx context.Context) (*domain.PlatformBankAccount, error) {
	return s.repo.GetDefaultPlatformBankAccount(ctx)
}

// SetPlatformBankAccount attaches a new external bank account to the platform's
// own Stripe account from a client-tokenized bank_account token, then persists
// the returned non-sensitive metadata as the new default. The previous default
// is soft-deleted within InsertPlatformBankAccount's transaction.
//
// adminID, when non-empty, is recorded as set_by_admin_id for audit purposes.
func (s *PaymentService) SetPlatformBankAccount(ctx context.Context, token, holderName, holderType, adminID string) (*domain.PlatformBankAccount, error) {
	if token == "" {
		return nil, fmt.Errorf("set platform bank account: %w", domain.ErrInvalidAmount)
	}
	if holderType == "" {
		holderType = "company"
	}

	ext, err := s.stripe.CreatePlatformExternalBankAccount(ctx, token, holderName, holderType)
	if err != nil {
		return nil, fmt.Errorf("set platform bank account: %w", err)
	}

	acct := &domain.PlatformBankAccount{
		StripeExternalAccountID: ext.ID,
		AccountHolderType:       holderType,
		Last4:                   ext.Last4,
		Currency:                ext.Currency,
		Country:                 ext.Country,
		Status:                  ext.Status,
		IsDefault:               true,
	}
	if ext.BankName != "" {
		bn := ext.BankName
		acct.BankName = &bn
	}
	if holderName != "" {
		hn := holderName
		acct.AccountHolderName = &hn
	}
	if ext.RoutingLast4 != "" {
		rl := ext.RoutingLast4
		acct.RoutingLast4 = &rl
	}
	if acct.Currency == "" {
		acct.Currency = "usd"
	}
	if acct.Country == "" {
		acct.Country = "US"
	}
	if acct.Status == "" {
		acct.Status = "new"
	}
	if adminID != "" {
		a := adminID
		acct.SetByAdminID = &a
	}

	if err := s.repo.InsertPlatformBankAccount(ctx, acct); err != nil {
		return nil, fmt.Errorf("set platform bank account: %w", err)
	}

	return acct, nil
}

// DeletePlatformBankAccount soft-deletes the stored platform bank account and
// detaches the external account from Stripe (best-effort: if the local row is
// missing, the not-found error is returned before touching Stripe).
func (s *PaymentService) DeletePlatformBankAccount(ctx context.Context, id string) error {
	if id == "" {
		return fmt.Errorf("delete platform bank account: %w", domain.ErrPlatformBankAccountNotFound)
	}

	// Resolve the external account id (if this is the current default) so we can
	// detach it from Stripe after the local soft-delete succeeds.
	var externalID string
	if existing, err := s.repo.GetDefaultPlatformBankAccount(ctx); err == nil && existing != nil && existing.ID == id {
		externalID = existing.StripeExternalAccountID
	}

	if err := s.repo.SoftDeletePlatformBankAccount(ctx, id); err != nil {
		return fmt.Errorf("delete platform bank account: %w", err)
	}

	if externalID != "" {
		if err := s.stripe.DeletePlatformExternalBankAccount(ctx, externalID); err != nil {
			// The local row is already retired; surface the Stripe error so the
			// caller knows the external account may still exist on Stripe.
			return fmt.Errorf("delete platform bank account: %w", err)
		}
	}

	return nil
}
