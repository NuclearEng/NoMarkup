package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"

	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/account"
	"github.com/stripe/stripe-go/v82/customer"
)

// StripeDeleter performs the GDPR/CCPA Stripe-side erasure: deleting the
// Stripe Customer (customer-side billing identity) and Connect Express
// account (provider-side payout identity) for a user whose local DB cascade
// has already committed. Outcomes are coarse strings recorded verbatim in
// the user service's audit log; see docs/operations/gdpr-delete.md.
//
// The adapter is small on purpose. It owns:
//   - The retry/skip taxonomy ("deleted", "deleted_already_gone",
//     "skipped_open_invoices", "skipped_dispute", "skipped_balance",
//     "skipped_no_id"). Anything else bubbles up as an error and the
//     GDPR cron retries on the next tick.
//   - Dev-mode short-circuit: when the payment service is running with a
//     placeholder STRIPE_SECRET_KEY (development), no Stripe calls are
//     made — all outcomes are "skipped_no_client".
type StripeDeleter struct {
	devMode bool
	// customerClient and accountClient are split so tests can swap the
	// stripe.Backend per-resource. In production both share
	// stripe.GetBackend(stripe.APIBackend) via the customer/account package
	// helpers.
	customerClient customerDeleterClient
	accountClient  accountDeleterClient
}

// CustomerDeleter narrows stripe-go's customer.Client surface to the single
// method we need; tests in other packages provide a fake.
type CustomerDeleter interface {
	Del(id string, params *stripe.CustomerParams) (*stripe.Customer, error)
}

// AccountDeleter narrows stripe-go's account.Client surface for the same
// reason.
type AccountDeleter interface {
	Del(id string, params *stripe.AccountParams) (*stripe.Account, error)
}

// customerDeleterClient is the unexported alias kept for symmetry with the
// in-package fakes; new code should use CustomerDeleter.
type customerDeleterClient = CustomerDeleter
type accountDeleterClient = AccountDeleter

// NewStripeDeleter constructs a deleter against the live Stripe backend.
// In dev mode (no real Stripe key configured), every call short-circuits to
// "skipped_no_client" so local stacks can exercise the GDPR cron without
// touching Stripe.
func NewStripeDeleter(stripeSvc *StripeService) *StripeDeleter {
	dev := stripeSvc != nil && stripeSvc.IsDevMode()
	return &StripeDeleter{
		devMode:        dev,
		customerClient: customer.Client{B: stripe.GetBackend(stripe.APIBackend), Key: stripe.Key},
		accountClient:  account.Client{B: stripe.GetBackend(stripe.APIBackend), Key: stripe.Key},
	}
}

// newStripeDeleterWithClients is a test seam: callers pass in fakes that
// implement the per-resource Del methods.
func newStripeDeleterWithClients(devMode bool, c customerDeleterClient, a accountDeleterClient) *StripeDeleter {
	return &StripeDeleter{devMode: devMode, customerClient: c, accountClient: a}
}

// NewStripeDeleterForTest is exported for cross-package tests (e.g. the
// gRPC handler) that need to construct a deleter with fake Stripe clients.
// Production code must use NewStripeDeleter, which wires the real Stripe
// backend.
func NewStripeDeleterForTest(devMode bool, c CustomerDeleter, a AccountDeleter) *StripeDeleter {
	return newStripeDeleterWithClients(devMode, c, a)
}

// DeleteCustomer attempts to delete the Stripe Customer. The outcome string
// is what the user service records. A returned error means the operator
// should retry on the next cron tick — the caller (Erasure) must NOT roll
// back the local cascade.
func (d *StripeDeleter) DeleteCustomer(ctx context.Context, customerID string) (string, error) {
	if customerID == "" {
		return "skipped_no_id", nil
	}
	if d.devMode {
		slog.Info("dev mode: stub StripeDeleter.DeleteCustomer", "customer_id", customerID)
		return "skipped_no_client", nil
	}

	_, err := d.customerClient.Del(customerID, nil)
	if err == nil {
		return "deleted", nil
	}

	outcome, retry := classifyStripeDeleteErr(err, classifyKindCustomer)
	if !retry {
		return outcome, nil
	}
	return "", err
}

// DeleteConnectAccount attempts to delete the provider's Connect Express
// account. Same outcome semantics as DeleteCustomer.
func (d *StripeDeleter) DeleteConnectAccount(ctx context.Context, accountID string) (string, error) {
	if accountID == "" {
		return "skipped_no_id", nil
	}
	if d.devMode {
		slog.Info("dev mode: stub StripeDeleter.DeleteConnectAccount", "account_id", accountID)
		return "skipped_no_client", nil
	}

	_, err := d.accountClient.Del(accountID, nil)
	if err == nil {
		return "deleted", nil
	}

	outcome, retry := classifyStripeDeleteErr(err, classifyKindAccount)
	if !retry {
		return outcome, nil
	}
	return "", err
}

type classifyKind int

const (
	classifyKindCustomer classifyKind = iota
	classifyKindAccount
)

// classifyStripeDeleteErr maps a stripe-go error to (outcome, shouldRetry).
//
// The mapping below intentionally checks both the typed Stripe error code
// and the plain message text. Stripe occasionally surfaces equivalent
// conditions under different codes between API versions ("balance_invalid",
// "account_balance_invalid", etc.), and several of the conditions we care
// about (open invoices on customer.del) come back as
// invalid_request_error with a free-text message rather than a stable code.
//
// retry=false ⇒ outcome is recorded and we move on. The local DB row's
// deletion_finalized_at stays set, so the cron will not re-process it.
//
// retry=true ⇒ caller bubbles the error up. The user service logs it but
// still keeps the cascade committed; the operator must intervene (or it
// gets retried on the next tick of the cron — though in practice once the
// cascade has run, future ticks won't pick the user up again because
// deletion_finalized_at is non-NULL).
func classifyStripeDeleteErr(err error, kind classifyKind) (outcome string, shouldRetry bool) {
	if err == nil {
		return "deleted", false
	}

	var sErr *stripe.Error
	if errors.As(err, &sErr) {
		// 404 — already gone is a happy outcome.
		if sErr.HTTPStatusCode == 404 ||
			sErr.Code == stripe.ErrorCodeResourceMissing {
			return "deleted_already_gone", false
		}

		msg := strings.ToLower(sErr.Msg)
		switch kind {
		case classifyKindCustomer:
			if strings.Contains(msg, "open invoice") || strings.Contains(msg, "open balance") {
				return "skipped_open_invoices", false
			}
			if strings.Contains(msg, "dispute") {
				return "skipped_dispute", false
			}
		case classifyKindAccount:
			if strings.Contains(msg, "balance") ||
				strings.Contains(msg, "active subscription") ||
				sErr.Code == stripe.ErrorCodeBalanceInvalidParameter {
				return "skipped_balance", false
			}
		}
	}

	// Plain-string fallback for non-typed errors (e.g. wrapped errors from
	// network layers below the SDK). Keep the same recognition rules so a
	// transient "open invoice" string still maps to a skipped-outcome
	// rather than a transient retry.
	msg := strings.ToLower(err.Error())
	switch kind {
	case classifyKindCustomer:
		if strings.Contains(msg, "404") ||
			strings.Contains(msg, "no such customer") {
			return "deleted_already_gone", false
		}
		if strings.Contains(msg, "open invoice") || strings.Contains(msg, "open balance") {
			return "skipped_open_invoices", false
		}
		if strings.Contains(msg, "dispute") {
			return "skipped_dispute", false
		}
	case classifyKindAccount:
		if strings.Contains(msg, "404") ||
			strings.Contains(msg, "no such account") {
			return "deleted_already_gone", false
		}
		if strings.Contains(msg, "balance") || strings.Contains(msg, "active subscription") {
			return "skipped_balance", false
		}
	}

	return "", true // unrecognized — let caller bubble the error
}
