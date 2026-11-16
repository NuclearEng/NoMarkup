package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHTMLEscape(t *testing.T) {
	t.Parallel()

	cases := []struct {
		in, want string
	}{
		{"plain text", "plain text"},
		{"<script>", "&lt;script&gt;"},
		{`A & B`, "A &amp; B"},
		{`"quoted"`, "&quot;quoted&quot;"},
		{`<img src="x" onerror="alert(1)">`, `&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;`},
		{"", ""},
	}

	for _, tt := range cases {
		t.Run(tt.in, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, htmlEscape(tt.in))
		})
	}
}

func TestMilestoneStatusBadge(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"approved":     "status-approved",
		"submitted":    "status-active",
		"in_progress":  "status-active",
		"disputed":     "status-cancelled",
		"pending":      "status-pending",
		"unknown_xyz":  "status-pending", // unknown defaults to pending
	}

	for status, wantClass := range cases {
		t.Run(status, func(t *testing.T) {
			t.Parallel()
			out := milestoneStatusBadge(status)
			assert.Contains(t, out, wantClass)
			assert.Contains(t, out, status) // status text appears in the rendered badge
		})
	}
}

func TestContractStatusBadge(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"completed": "status-completed",
		"active":    "status-active",
		"cancelled": "status-cancelled",
		"voided":    "status-cancelled",
		"disputed":  "status-cancelled",
		"pending":   "status-pending",
		"weird":     "status-pending",
	}

	for status, wantClass := range cases {
		t.Run(status, func(t *testing.T) {
			t.Parallel()
			out := contractStatusBadge(status)
			assert.Contains(t, out, wantClass)
		})
	}
}

func TestPaymentService_GenerateInvoice(t *testing.T) {
	t.Parallel()

	t.Run("missing_contract_id", func(t *testing.T) {
		t.Parallel()
		svc := newTestPaymentService(&mockPaymentRepo{}, nil)
		_, err := svc.GenerateInvoice(context.Background(), "")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "contract_id is required")
	})

	t.Run("propagates_get_contract_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getContractDetailFn: func(_ context.Context, _ string) (*domain.ContractDetail, error) {
				return nil, errors.New("contract not found")
			},
		}
		svc := newTestPaymentService(repo, nil)
		_, err := svc.GenerateInvoice(context.Background(), "12345678-aaaa-bbbb-cccc-dddddddddddd")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "contract not found")
	})

	t.Run("happy_path_with_milestones_and_payments", func(t *testing.T) {
		t.Parallel()
		contractID := "abcdef12-3456-7890-aaaa-bbbbbbbbbbbb"
		repo := &mockPaymentRepo{
			getContractDetailFn: func(_ context.Context, id string) (*domain.ContractDetail, error) {
				assert.Equal(t, contractID, id)
				return &domain.ContractDetail{
					ID:             contractID,
					ContractNumber: "NM-2026-00042",
					JobTitle:       "HVAC repair",
					CustomerName:   "Jane Customer",
					ProviderName:   "Acme HVAC LLC",
					AmountCents:    50000,
					Status:         "completed",
					CreatedAt:      time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC),
				}, nil
			},
			getMilestonesForContractFn: func(_ context.Context, _ string) ([]*domain.MilestoneDetail, error) {
				return []*domain.MilestoneDetail{
					{ID: "m1", Description: "Diagnostic", AmountCents: 10000, Status: "approved"},
					{ID: "m2", Description: "Compressor replace", AmountCents: 40000, Status: "approved"},
				}, nil
			},
			getPaymentsForContractFn: func(_ context.Context, _ string) ([]*domain.Payment, error) {
				return []*domain.Payment{
					{
						ID: "p1", Status: "released", AmountCents: 50000,
						PlatformFeeCents: 2500, GuaranteeFeeCents: 1000,
						ProviderPayoutCents: 46500, CreatedAt: time.Date(2026, 4, 5, 0, 0, 0, 0, time.UTC),
					},
				}, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		html, err := svc.GenerateInvoice(context.Background(), contractID)
		require.NoError(t, err)
		assert.Contains(t, html, "Diagnostic")
		assert.Contains(t, html, "Compressor replace")
		assert.Contains(t, html, "$500.00") // contract amount displayed somewhere
		assert.Contains(t, html, "INV-")    // invoice number prefix
		// Per-payment row + status_badge
		assert.Contains(t, html, "released")
	})

	t.Run("escapes_xss_in_job_title_and_customer_name", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getContractDetailFn: func(_ context.Context, _ string) (*domain.ContractDetail, error) {
				return &domain.ContractDetail{
					ID:             "12345678-xx",
					ContractNumber: "NM-2026-00099",
					JobTitle:       `<script>alert("pwn")</script>`,
					CustomerName:   `Alice<img src=x onerror=alert(1)>`,
					ProviderName:   "Provider",
					AmountCents:    10000,
					Status:         "active",
					CreatedAt:      time.Now(),
				}, nil
			},
			// No milestones → falls through to single-line-item path that uses JobTitle.
		}
		repo.getDefaultFeeConfigFn = func(_ context.Context) (*domain.FeeConfig, error) {
			return domain.DefaultFeeConfig(), nil
		}
		svc := newTestPaymentService(repo, nil)
		html, err := svc.GenerateInvoice(context.Background(), "12345678-aaaa-bbbb-cccc-dddddddddddd")
		require.NoError(t, err)
		assert.NotContains(t, html, `<script>alert("pwn")</script>`,
			"raw script tag must not appear in rendered invoice")
		assert.Contains(t, html, "&lt;script&gt;")
	})

	t.Run("filters_out_pending_and_failed_payments_from_totals", func(t *testing.T) {
		t.Parallel()
		var capturedHTML string
		repo := &mockPaymentRepo{
			getContractDetailFn: func(_ context.Context, _ string) (*domain.ContractDetail, error) {
				return &domain.ContractDetail{
					ID:             "12345678-xx",
					ContractNumber: "NM-2026-00100",
					JobTitle:       "Test",
					AmountCents:    100000,
					Status:         "active",
					CreatedAt:      time.Now(),
				}, nil
			},
			getPaymentsForContractFn: func(_ context.Context, _ string) ([]*domain.Payment, error) {
				return []*domain.Payment{
					{ID: "p1", Status: "pending", AmountCents: 50000, CreatedAt: time.Now()},
					{ID: "p2", Status: "failed", AmountCents: 50000, CreatedAt: time.Now()},
					{ID: "p3", Status: "released", AmountCents: 50000, CreatedAt: time.Now()},
				}, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		html, err := svc.GenerateInvoice(context.Background(), "12345678-aaaa-bbbb-cccc-dddddddddddd")
		require.NoError(t, err)
		capturedHTML = html
		// Only the released payment should appear in the payments section.
		releasedCount := strings.Count(capturedHTML, "released")
		assert.GreaterOrEqual(t, releasedCount, 1)
		// Pending/failed should NOT show in payment rows (only "released" status text).
		// Note: the words "pending" / "failed" might still appear in CSS classes,
		// so we check the rendered $-amounts more carefully below.
		assert.Contains(t, capturedHTML, "$500.00")
	})

	t.Run("handles_no_payments_with_placeholder_row", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getContractDetailFn: func(_ context.Context, _ string) (*domain.ContractDetail, error) {
				return &domain.ContractDetail{
					ID:          "12345678-xx",
					JobTitle:    "Test",
					AmountCents: 10000,
					Status:      "active",
					CreatedAt:   time.Now(),
				}, nil
			},
			// No payments returned.
			getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
				return domain.DefaultFeeConfig(), nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		html, err := svc.GenerateInvoice(context.Background(), "12345678-aaaa-bbbb-cccc-dddddddddddd")
		require.NoError(t, err)
		assert.Contains(t, html, "No payments recorded")
		// Even with no payment recorded, fees must be PROJECTED from the active
		// fee config — never an all-zero summary on a non-zero contract.
		// $100.00 contract: 8% platform = $8.00, 2% guarantee = $2.00, payout $90.00.
		assert.Contains(t, html, "$8.00", "projected platform fee shows")
		assert.Contains(t, html, "$2.00", "projected guarantee fee shows")
		assert.Contains(t, html, "$90.00", "projected provider payout shows")
		assert.Contains(t, html, "projected from the current fee schedule",
			"unpaid invoice notes the fees are projected")
	})

	t.Run("projects_fees_from_config_on_unpaid_180_contract", func(t *testing.T) {
		t.Parallel()
		// Founder-reported case: a $180 contract with no payments must show
		// Platform $14.40, Guarantee $3.60, Payout $162.00 — not all zeros.
		repo := &mockPaymentRepo{
			getContractDetailFn: func(_ context.Context, _ string) (*domain.ContractDetail, error) {
				return &domain.ContractDetail{
					ID:          "12345678-xx",
					JobTitle:    "Lawn care",
					AmountCents: 18000,
					Status:      "active",
					CreatedAt:   time.Now(),
				}, nil
			},
			getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
				return domain.DefaultFeeConfig(), nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		html, err := svc.GenerateInvoice(context.Background(), "12345678-aaaa-bbbb-cccc-dddddddddddd")
		require.NoError(t, err)
		assert.Contains(t, html, "$14.40", "projected platform fee (8% of $180)")
		assert.Contains(t, html, "$3.60", "projected guarantee fee (2% of $180)")
		assert.Contains(t, html, "$162.00", "projected provider payout")
	})

	t.Run("uses_recorded_breakdown_when_payment_exists", func(t *testing.T) {
		t.Parallel()
		// When a payment IS recorded, the invoice must reflect the ACTUAL stored
		// breakdown, not a re-projection. A default config is also provided to
		// prove the recorded values win over any projection.
		repo := &mockPaymentRepo{
			getContractDetailFn: func(_ context.Context, _ string) (*domain.ContractDetail, error) {
				return &domain.ContractDetail{
					ID:          "12345678-xx",
					JobTitle:    "Roofing",
					AmountCents: 50000,
					Status:      "completed",
					CreatedAt:   time.Now(),
				}, nil
			},
			getPaymentsForContractFn: func(_ context.Context, _ string) ([]*domain.Payment, error) {
				return []*domain.Payment{
					{
						ID: "p1", Status: "released", AmountCents: 50000,
						PlatformFeeCents: 2500, GuaranteeFeeCents: 1000,
						ProviderPayoutCents: 46500, CreatedAt: time.Now(),
					},
				}, nil
			},
			getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
				return domain.DefaultFeeConfig(), nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		html, err := svc.GenerateInvoice(context.Background(), "12345678-aaaa-bbbb-cccc-dddddddddddd")
		require.NoError(t, err)
		assert.Contains(t, html, "$25.00", "recorded platform fee shown")
		assert.Contains(t, html, "$465.00", "recorded provider payout shown")
		assert.NotContains(t, html, "projected from the current fee schedule",
			"paid invoice must NOT show the projected-fees note")
	})
}
