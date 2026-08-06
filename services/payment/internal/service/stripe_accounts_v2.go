package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/nomarkup/nomarkup/services/payment/internal/observability"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/accountsession"
)

// Stripe Accounts v2 (Connect marketplace) uses a pinned preview/major API
// version that supports /v2/core/accounts. The payment service's default
// stripe-go API version may lag; v2 calls set Stripe-Version explicitly.
// See connect-recommend-plan.md and stripe-best-practices (Accounts v2).
const stripeAccountsV2APIVersion = "2026-07-29.dahlia"

// accountsV2Enabled reports whether new connected accounts should be created
// via Accounts v2 (recipient + Express dashboard + platform responsibilities).
// Default ON. Set STRIPE_ACCOUNTS_V2=false to force legacy Express v1 creates.
func accountsV2Enabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("STRIPE_ACCOUNTS_V2")))
	if v == "" {
		return true
	}
	return v != "0" && v != "false" && v != "no" && v != "off"
}

// v2AccountCreateRequest is the JSON body for POST /v2/core/accounts.
// Shape matches Stripe's marketplace recipient path (separate charges + transfers).
type v2AccountCreateRequest struct {
	Dashboard    string                    `json:"dashboard"`
	DisplayName  string                    `json:"display_name,omitempty"`
	ContactEmail string                    `json:"contact_email,omitempty"`
	Defaults     v2AccountDefaults         `json:"defaults"`
	Configuration v2AccountConfiguration   `json:"configuration"`
	Identity     v2AccountIdentity         `json:"identity"`
	Metadata     map[string]string         `json:"metadata,omitempty"`
	Include      []string                  `json:"include,omitempty"`
}

type v2AccountDefaults struct {
	Currency        string                       `json:"currency,omitempty"`
	Responsibilities v2AccountResponsibilities   `json:"responsibilities"`
}

type v2AccountResponsibilities struct {
	FeesCollector   string `json:"fees_collector"`
	LossesCollector string `json:"losses_collector"`
}

type v2AccountConfiguration struct {
	Recipient *v2RecipientConfig `json:"recipient,omitempty"`
}

type v2RecipientConfig struct {
	Capabilities *v2RecipientCapabilities `json:"capabilities,omitempty"`
}

type v2RecipientCapabilities struct {
	StripeBalance *v2StripeBalanceCaps `json:"stripe_balance,omitempty"`
}

type v2StripeBalanceCaps struct {
	StripeTransfers *v2RequestedCap `json:"stripe_transfers,omitempty"`
}

type v2RequestedCap struct {
	Requested bool `json:"requested"`
}

type v2AccountIdentity struct {
	Country string `json:"country,omitempty"`
}

type v2AccountResponse struct {
	ID        string `json:"id"`
	Dashboard string `json:"dashboard"`
	Object    string `json:"object"`
	// Nested configuration is optional and only present when requested via include.
	Configuration *struct {
		Recipient *struct {
			Capabilities *struct {
				StripeBalance *struct {
					StripeTransfers *struct {
						Status string `json:"status"`
					} `json:"stripe_transfers"`
					Payouts *struct {
						Status string `json:"status"`
					} `json:"payouts"`
				} `json:"stripe_balance"`
			} `json:"capabilities"`
		} `json:"recipient"`
	} `json:"configuration"`
}

// createConnectedAccountV2 creates a marketplace recipient account via Accounts v2.
// Dashboard: express · fees/losses: application · recipient stripe_transfers requested.
// Does NOT request merchant/card_payments (longer onboarding, unnecessary for escrow payouts).
func (s *StripeService) createConnectedAccountV2(ctx context.Context, email, businessName string) (string, error) {
	display := businessName
	if display == "" {
		display = "NoMarkup provider"
	}
	body := v2AccountCreateRequest{
		Dashboard:    "express",
		DisplayName:  display,
		ContactEmail: email,
		Defaults: v2AccountDefaults{
			Currency: "usd",
			Responsibilities: v2AccountResponsibilities{
				FeesCollector:   "application",
				LossesCollector: "application",
			},
		},
		Configuration: v2AccountConfiguration{
			Recipient: &v2RecipientConfig{
				Capabilities: &v2RecipientCapabilities{
					StripeBalance: &v2StripeBalanceCaps{
						StripeTransfers: &v2RequestedCap{Requested: true},
					},
				},
			},
		},
		// US marketplace MVP; expand when multi-country ships.
		Identity: v2AccountIdentity{Country: "us"},
		Metadata: map[string]string{
			"platform":      "nomarkup",
			"accounts_api":  "v2",
			"charge_model":  "separate_charges_transfers",
		},
		Include: []string{"configuration.recipient", "defaults", "identity"},
	}

	var out v2AccountResponse
	if err := s.callStripeV2JSON(ctx, http.MethodPost, "/v2/core/accounts", body, stripeIdempotencyKey("connect-account-v2", email), &out); err != nil {
		return "", fmt.Errorf("create stripe account v2: %w", err)
	}
	if out.ID == "" {
		return "", fmt.Errorf("create stripe account v2: empty account id in response")
	}
	slog.Info("created connect account via accounts v2",
		"account_id", out.ID,
		"dashboard", out.Dashboard,
		"email", email,
	)
	return out.ID, nil
}

// getConnectedAccountV2Capabilities loads recipient capability statuses for gating transfers.
func (s *StripeService) getConnectedAccountV2Capabilities(ctx context.Context, accountID string) (transfersStatus, payoutsStatus string, err error) {
	path := "/v2/core/accounts/" + accountID + "?include=" +
		"configuration.recipient"
	var out v2AccountResponse
	if err := s.callStripeV2JSON(ctx, http.MethodGet, path, nil, "", &out); err != nil {
		return "", "", err
	}
	if out.Configuration != nil &&
		out.Configuration.Recipient != nil &&
		out.Configuration.Recipient.Capabilities != nil &&
		out.Configuration.Recipient.Capabilities.StripeBalance != nil {
		bal := out.Configuration.Recipient.Capabilities.StripeBalance
		if bal.StripeTransfers != nil {
			transfersStatus = bal.StripeTransfers.Status
		}
		if bal.Payouts != nil {
			payoutsStatus = bal.Payouts.Status
		}
	}
	return transfersStatus, payoutsStatus, nil
}

// callStripeV2JSON performs a JSON request against the Stripe API with the Accounts v2
// Stripe-Version pin. Uses the same bounded HTTP client as the rest of the service.
func (s *StripeService) callStripeV2JSON(ctx context.Context, method, path string, body any, idempotencyKey string, dest any) error {
	key := os.Getenv("STRIPE_SECRET_KEY")
	if key == "" {
		return fmt.Errorf("stripe v2 call: STRIPE_SECRET_KEY missing")
	}

	var bodyReader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("stripe v2 call: marshal: %w", err)
		}
		bodyReader = bytes.NewReader(raw)
	}

	url := "https://api.stripe.com" + path
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return fmt.Errorf("stripe v2 call: new request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Stripe-Version", stripeAccountsV2APIVersion)
	req.Header.Set("Content-Type", "application/json")
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}

	client := &http.Client{Timeout: stripeAttemptTimeout}
	// Prefer the SDK's configured backend transport if available (idle conns).
	if bc := newStripeBackendConfig(); bc != nil && bc.HTTPClient != nil {
		client = bc.HTTPClient
	}

	_, err = observability.TraceStripeCall(ctx, "V2."+method+" "+path, func(ctx context.Context) (struct{}, error) {
		req = req.WithContext(ctx)
		resp, doErr := client.Do(req)
		if doErr != nil {
			return struct{}{}, doErr
		}
		defer resp.Body.Close()
		respBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if readErr != nil {
			return struct{}{}, readErr
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return struct{}{}, fmt.Errorf("stripe v2 HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
		}
		if dest != nil && len(respBody) > 0 {
			if uErr := json.Unmarshal(respBody, dest); uErr != nil {
				return struct{}{}, fmt.Errorf("stripe v2 decode: %w", uErr)
			}
		}
		return struct{}{}, nil
	})
	return err
}

// CreateAccountSession mints a single-use client_secret for Connect embedded
// components (account_onboarding, notification_banner, account_management, payouts).
// Prefer this over redirect Account Links for in-app provider onboarding.
func (s *StripeService) CreateAccountSession(ctx context.Context, accountID string) (clientSecret string, expiresAt time.Time, err error) {
	if accountID == "" {
		return "", time.Time{}, fmt.Errorf("create account session: account id required")
	}
	if s.devMode {
		slog.Info("dev mode: stub CreateAccountSession", "accountID", accountID)
		return "acs_dev_secret_" + accountID, time.Now().Add(time.Hour), nil
	}

	params := &stripe.AccountSessionParams{
		Account: stripe.String(accountID),
		Components: &stripe.AccountSessionComponentsParams{
			AccountOnboarding: &stripe.AccountSessionComponentsAccountOnboardingParams{
				Enabled: stripe.Bool(true),
			},
			NotificationBanner: &stripe.AccountSessionComponentsNotificationBannerParams{
				Enabled: stripe.Bool(true),
			},
			AccountManagement: &stripe.AccountSessionComponentsAccountManagementParams{
				Enabled: stripe.Bool(true),
			},
			Payouts: &stripe.AccountSessionComponentsPayoutsParams{
				Enabled: stripe.Bool(true),
			},
			// Payments/disputes have reduced fidelity under separate charges —
			// still enable so providers see what Stripe surfaces.
			Payments: &stripe.AccountSessionComponentsPaymentsParams{
				Enabled: stripe.Bool(true),
			},
		},
	}

	sess, err := observability.TraceStripeCall(ctx, "AccountSession.Create", func(ctx context.Context) (*stripe.AccountSession, error) {
		params.Context = ctx
		return accountsession.New(params)
	})
	if err != nil {
		return "", time.Time{}, fmt.Errorf("create account session: %w", err)
	}
	if sess.ClientSecret == "" {
		return "", time.Time{}, fmt.Errorf("create account session: empty client_secret")
	}
	// SDK exposes ExpiresAt as int64 unix when present.
	if sess.ExpiresAt > 0 {
		expiresAt = time.Unix(sess.ExpiresAt, 0)
	}
	return sess.ClientSecret, expiresAt, nil
}

// EnsureTransferDestinationReady fail-closes before CreateTransfer when the
// connected account cannot receive stripe_transfers (Accounts v2) or legacy
// transfers capability is inactive. Dev mode always succeeds.
func (s *StripeService) EnsureTransferDestinationReady(ctx context.Context, accountID string) error {
	if accountID == "" {
		return fmt.Errorf("transfer destination: %w", domain.ErrStripeAccountNotFound)
	}
	if s.devMode {
		return nil
	}

	status, err := s.GetAccountStatus(ctx, accountID)
	if err != nil {
		return fmt.Errorf("transfer destination readiness: %w", err)
	}
	if status.TransfersReady {
		return nil
	}
	// Allow legacy Express accounts that only expose payouts_enabled until
	// capability objects catch up (webhook lag). Prefer TransfersReady.
	if status.PayoutsEnabled && status.DetailsSubmitted {
		slog.Warn("transfer destination: transfers capability not active; allowing via legacy payouts_enabled",
			"account_id", accountID,
			"transfers_status", status.StripeTransfersStatus,
		)
		return nil
	}
	return fmt.Errorf("%w: account %s transfers_status=%q payouts_enabled=%v",
		domain.ErrTransfersNotReady, accountID, status.StripeTransfersStatus, status.PayoutsEnabled)
}
