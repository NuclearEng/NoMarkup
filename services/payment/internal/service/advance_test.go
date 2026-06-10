package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	underwritingv1 "github.com/nomarkup/nomarkup/proto/underwriting/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- computeAdvanceFeeCents ---

func TestComputeAdvanceFeeCents(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		amountCents int64
		termDays    int
		wantCents   int64
	}{
		{
			// $1,000 × 3% APR × (30/365) = $2.4658 → 247 cents (rounded)
			name:        "standard_30_day_term",
			amountCents: 100000,
			termDays:    30,
			wantCents:   247,
		},
		{
			// $10,000 × 3% APR × (30/365) = $24.6575 → 2466 cents (rounded)
			name:        "ten_thousand_30_day",
			amountCents: 1000000,
			termDays:    30,
			wantCents:   2466,
		},
		{
			// Zero term defaults to 30 days, same as above.
			name:        "zero_term_uses_default_30",
			amountCents: 100000,
			termDays:    0,
			wantCents:   247,
		},
		{
			// Negative term defaults to 30 days.
			name:        "negative_term_uses_default_30",
			amountCents: 100000,
			termDays:    -5,
			wantCents:   247,
		},
		{
			// Full year at 3% APR → exactly 3% of principal.
			name:        "365_day_term_yields_full_apr",
			amountCents: 100000,
			termDays:    365,
			wantCents:   3000,
		},
		{
			name:        "zero_amount",
			amountCents: 0,
			termDays:    30,
			wantCents:   0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := computeAdvanceFeeCents(tt.amountCents, tt.termDays)
			assert.Equal(t, tt.wantCents, got)
		})
	}
}

// --- RequestAdvance ---

func TestPaymentService_RequestAdvance(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		providerID  string
		contractID  string
		amountCents int64
		repoErr     error
		wantErr     bool
		errContains string
	}{
		{
			name:        "happy_path",
			providerID:  "prov-1",
			contractID:  "contract-1",
			amountCents: 50000,
		},
		{
			name:        "missing_provider_id",
			providerID:  "",
			contractID:  "contract-1",
			amountCents: 50000,
			wantErr:     true,
			errContains: "provider_id is required",
		},
		{
			name:        "missing_contract_id",
			providerID:  "prov-1",
			contractID:  "",
			amountCents: 50000,
			wantErr:     true,
			errContains: "contract_id is required",
		},
		{
			name:        "zero_amount_rejected",
			providerID:  "prov-1",
			contractID:  "contract-1",
			amountCents: 0,
			wantErr:     true,
			errContains: "invalid amount",
		},
		{
			name:        "negative_amount_rejected",
			providerID:  "prov-1",
			contractID:  "contract-1",
			amountCents: -100,
			wantErr:     true,
			errContains: "invalid amount",
		},
		{
			name:        "repo_failure_propagates",
			providerID:  "prov-1",
			contractID:  "contract-1",
			amountCents: 50000,
			repoErr:     errors.New("db down"),
			wantErr:     true,
			errContains: "db down",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var captured *domain.Advance
			repo := &mockPaymentRepo{
				// RequestAdvance computes the borrower's business credit score
				// first (reads payments + advance history), then enforces the
				// available-credit guard via ComputeCreditLimit. Stub the payment
				// history with enough released earnings that the computed
				// max_advance (= (earnings/6)/2) comfortably clears the 50000
				// requested amount, and keep the score grade-eligible.
				listPaymentsFn: func(_ context.Context, _, _ string, _, _ int) ([]*domain.Payment, int, error) {
					// (1,000,000/6)/2 = 83,333 cents max_advance ≥ 50,000 requested.
					return []*domain.Payment{{ProviderPayoutCents: 1_000_000}}, 1, nil
				},
				listAdvancesFn: func(_ context.Context, _, _ string, _, _ int) ([]*domain.Advance, int, error) {
					return nil, 0, nil
				},
				// No outstanding advances → full max_advance is available.
				getActiveAdvancesFn: func(_ context.Context, _ string) ([]*domain.Advance, error) {
					return nil, nil
				},
				upsertCreditLimitFn: func(_ context.Context, _ *domain.CreditLimit) error {
					return nil
				},
				// ComputeCreditLimit re-fetches the persisted limit and writes the
				// derived max/outstanding onto it, so this only needs to be
				// non-nil to avoid the nil-pointer deref.
				getCreditLimitFn: func(_ context.Context, providerID string) (*domain.CreditLimit, error) {
					return &domain.CreditLimit{ProviderID: providerID}, nil
				},
				createAdvanceFn: func(_ context.Context, advance *domain.Advance) error {
					if tt.repoErr != nil {
						return tt.repoErr
					}
					captured = advance
					return nil
				},
			}
			svc := newTestPaymentService(repo, nil)

			adv, err := svc.RequestAdvance(context.Background(), tt.providerID, tt.contractID, tt.amountCents)

			if tt.wantErr {
				require.Error(t, err)
				if tt.errContains != "" {
					assert.True(t, strings.Contains(err.Error(), tt.errContains),
						"expected error to contain %q, got %v", tt.errContains, err)
				}
				return
			}

			require.NoError(t, err)
			require.NotNil(t, adv)
			assert.Equal(t, tt.providerID, adv.ProviderID)
			assert.Equal(t, tt.contractID, adv.ContractID)
			assert.Equal(t, tt.amountCents, adv.AdvanceAmountCents)
			assert.Equal(t, "requested", adv.Status)
			assert.NotEmpty(t, adv.ID)
			// Fee math is independently tested above; just sanity-check it was applied.
			assert.Greater(t, adv.FeeCents, int64(0))
			require.NotNil(t, captured)
			assert.Equal(t, adv.ID, captured.ID)
		})
	}

	// Over-lending guard: a request exceeding available credit (max_advance −
	// outstanding) must be rejected with ErrInsufficientCredit BEFORE any
	// advance is booked. Here max_advance ≈ 83,333 but 80,000 is already
	// outstanding, leaving ≈ 3,333 available against a 50,000 request.
	t.Run("rejects_request_over_available_credit", func(t *testing.T) {
		t.Parallel()

		var createCalled bool
		repo := &mockPaymentRepo{
			listPaymentsFn: func(_ context.Context, _, _ string, _, _ int) ([]*domain.Payment, int, error) {
				return []*domain.Payment{{ProviderPayoutCents: 1_000_000}}, 1, nil
			},
			listAdvancesFn: func(_ context.Context, _, _ string, _, _ int) ([]*domain.Advance, int, error) {
				return nil, 0, nil
			},
			// One active advance with 80,000 still outstanding eats most of the
			// max_advance line, leaving available < the 50,000 requested.
			getActiveAdvancesFn: func(_ context.Context, _ string) ([]*domain.Advance, error) {
				return []*domain.Advance{{AdvanceAmountCents: 80_000, FeeCents: 0, RepaidCents: 0}}, nil
			},
			upsertCreditLimitFn: func(_ context.Context, _ *domain.CreditLimit) error {
				return nil
			},
			getCreditLimitFn: func(_ context.Context, providerID string) (*domain.CreditLimit, error) {
				return &domain.CreditLimit{ProviderID: providerID}, nil
			},
			createAdvanceFn: func(_ context.Context, _ *domain.Advance) error {
				createCalled = true
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		// Engine grants an $830 line; with $800 outstanding only $30 is available,
		// below the $500 requested → the over-credit guard must fire.
		svc.SetUnderwriter(&mockUnderwriter{fn: func(_ context.Context, _ *underwritingv1.ProviderFeatures) (*underwritingv1.UnderwriteResponse, error) {
			return &underwritingv1.UnderwriteResponse{Approved: true, MaxCreditCents: 83_000, AvailableCreditCents: 3_000, FactorRate: 1.1}, nil
		}})

		adv, err := svc.RequestAdvance(context.Background(), "prov-1", "contract-1", 50_000)
		require.Error(t, err)
		assert.Nil(t, adv)
		assert.True(t, errors.Is(err, ErrInsufficientCredit),
			"expected ErrInsufficientCredit, got %v", err)
		assert.False(t, createCalled, "advance must not be booked when over available credit")
	})
}

// --- ReviewAdvance ---

func TestPaymentService_ReviewAdvance(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		advanceID     string
		reviewerID    string
		action        string
		reason        string
		wantErr       bool
		errContains   string
		wantStatus    string
		wantHasReason bool
	}{
		{
			name:       "approve_happy",
			advanceID:  "adv-1",
			reviewerID: "admin-1",
			action:     "approve",
			wantStatus: "approved",
		},
		{
			name:          "reject_with_reason",
			advanceID:     "adv-1",
			reviewerID:    "admin-1",
			action:        "reject",
			reason:        "insufficient history",
			wantStatus:    "rejected",
			wantHasReason: true,
		},
		{
			name:       "reject_without_reason",
			advanceID:  "adv-1",
			reviewerID: "admin-1",
			action:     "reject",
			wantStatus: "rejected",
		},
		{
			name:        "missing_advance_id",
			advanceID:   "",
			reviewerID:  "admin-1",
			action:      "approve",
			wantErr:     true,
			errContains: "advance_id is required",
		},
		{
			name:        "missing_reviewer_id",
			advanceID:   "adv-1",
			reviewerID:  "",
			action:      "approve",
			wantErr:     true,
			errContains: "reviewer_id is required",
		},
		{
			name:        "invalid_action",
			advanceID:   "adv-1",
			reviewerID:  "admin-1",
			action:      "maybe",
			wantErr:     true,
			errContains: "must be 'approve' or 'reject'",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var capturedStatus string
			var capturedReason *string
			repo := &mockPaymentRepo{
				updateAdvanceReviewFn: func(_ context.Context, advanceID, status, reviewerID string, rejectionReason *string) (*domain.Advance, error) {
					capturedStatus = status
					capturedReason = rejectionReason
					return &domain.Advance{ID: advanceID, Status: status, ReviewedBy: &reviewerID}, nil
				},
			}
			svc := newTestPaymentService(repo, nil)

			adv, err := svc.ReviewAdvance(context.Background(), tt.advanceID, tt.reviewerID, tt.action, tt.reason)

			if tt.wantErr {
				require.Error(t, err)
				assert.True(t, strings.Contains(err.Error(), tt.errContains),
					"expected error to contain %q, got %v", tt.errContains, err)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.wantStatus, adv.Status)
			assert.Equal(t, tt.wantStatus, capturedStatus)
			if tt.wantHasReason {
				require.NotNil(t, capturedReason)
				assert.Equal(t, tt.reason, *capturedReason)
			} else {
				assert.Nil(t, capturedReason)
			}
		})
	}
}

// --- DisburseAdvance ---

func TestPaymentService_DisburseAdvance(t *testing.T) {
	t.Parallel()

	t.Run("happy_path_transfers_and_updates", func(t *testing.T) {
		t.Parallel()
		var disbursementUpdate string
		repo := &mockPaymentRepo{
			getAdvanceFn: func(_ context.Context, _ string) (*domain.Advance, error) {
				return &domain.Advance{
					ID:                 "adv-1",
					ProviderID:         "prov-1",
					AdvanceAmountCents: 50000,
					Status:             "approved",
				}, nil
			},
			getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
				return "acct_prov_1", nil
			},
			updateAdvanceDisbursementFn: func(_ context.Context, advanceID, transferID string) (*domain.Advance, error) {
				disbursementUpdate = transferID
				return &domain.Advance{ID: advanceID, Status: "disbursed"}, nil
			},
		}
		svc := newTestPaymentService(repo, nil)

		adv, transferID, err := svc.DisburseAdvance(context.Background(), "adv-1", "admin-1")
		require.NoError(t, err)
		assert.Equal(t, "disbursed", adv.Status)
		assert.NotEmpty(t, transferID)
		assert.Equal(t, transferID, disbursementUpdate)
		// Dev-mode StripeService returns "tr_platform_dev_<uuid>" for platform transfers.
		assert.True(t, strings.HasPrefix(transferID, "tr_platform_dev_"),
			"expected dev transfer prefix, got %q", transferID)
	})

	t.Run("rejects_unapproved_advance", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getAdvanceFn: func(_ context.Context, _ string) (*domain.Advance, error) {
				return &domain.Advance{ID: "adv-1", Status: "requested"}, nil
			},
		}
		svc := newTestPaymentService(repo, nil)

		_, _, err := svc.DisburseAdvance(context.Background(), "adv-1", "admin-1")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not in approved status")
	})

	t.Run("rejects_already_disbursed_advance", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getAdvanceFn: func(_ context.Context, _ string) (*domain.Advance, error) {
				return &domain.Advance{ID: "adv-1", Status: "disbursed"}, nil
			},
		}
		svc := newTestPaymentService(repo, nil)

		_, _, err := svc.DisburseAdvance(context.Background(), "adv-1", "admin-1")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not in approved status")
	})

	t.Run("missing_advance_id", func(t *testing.T) {
		t.Parallel()
		svc := newTestPaymentService(&mockPaymentRepo{}, nil)
		_, _, err := svc.DisburseAdvance(context.Background(), "", "admin-1")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "advance_id is required")
	})

	t.Run("missing_admin_id", func(t *testing.T) {
		t.Parallel()
		svc := newTestPaymentService(&mockPaymentRepo{}, nil)
		_, _, err := svc.DisburseAdvance(context.Background(), "adv-1", "")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "admin_id is required")
	})

	t.Run("propagates_get_advance_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getAdvanceFn: func(_ context.Context, _ string) (*domain.Advance, error) {
				return nil, errors.New("db down")
			},
		}
		svc := newTestPaymentService(repo, nil)
		_, _, err := svc.DisburseAdvance(context.Background(), "adv-1", "admin-1")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "db down")
	})

	t.Run("propagates_get_stripe_account_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getAdvanceFn: func(_ context.Context, _ string) (*domain.Advance, error) {
				return &domain.Advance{ID: "adv-1", Status: "approved", AdvanceAmountCents: 50000}, nil
			},
			getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
				return "", errors.New("not connected")
			},
		}
		svc := newTestPaymentService(repo, nil)
		_, _, err := svc.DisburseAdvance(context.Background(), "adv-1", "admin-1")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not connected")
	})
}

// --- ListAdvances + GetAdvance proxies ---

func TestPaymentService_ListAdvances(t *testing.T) {
	t.Parallel()
	expected := []*domain.Advance{{ID: "adv-1"}, {ID: "adv-2"}}
	repo := &mockPaymentRepo{
		listAdvancesFn: func(_ context.Context, providerID, statusFilter string, page, pageSize int) ([]*domain.Advance, int, error) {
			assert.Equal(t, "prov-1", providerID)
			assert.Equal(t, "approved", statusFilter)
			return expected, 25, nil
		},
	}
	svc := newTestPaymentService(repo, nil)
	got, total, err := svc.ListAdvances(context.Background(), "prov-1", "approved", 1, 50)
	require.NoError(t, err)
	assert.Equal(t, expected, got)
	assert.Equal(t, 25, total)
}

func TestPaymentService_GetAdvance(t *testing.T) {
	t.Parallel()

	t.Run("happy_path", func(t *testing.T) {
		t.Parallel()
		expected := &domain.Advance{ID: "adv-1"}
		repo := &mockPaymentRepo{
			getAdvanceFn: func(_ context.Context, _ string) (*domain.Advance, error) {
				return expected, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		got, err := svc.GetAdvance(context.Background(), "adv-1")
		require.NoError(t, err)
		assert.Equal(t, expected, got)
	})

	t.Run("missing_id", func(t *testing.T) {
		t.Parallel()
		svc := newTestPaymentService(&mockPaymentRepo{}, nil)
		_, err := svc.GetAdvance(context.Background(), "")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "advance_id is required")
	})
}

// --- ComputeCreditLimit ---

func TestPaymentService_ComputeCreditLimit(t *testing.T) {
	t.Parallel()

	// The underwriting MATH is exhaustively tested in the Rust engine's proptest
	// suite. These Go tests verify the WIRING: feature-gather → engine → mapping,
	// and the fail-closed paths.

	baseRepo := func(captured **domain.CreditLimit) *mockPaymentRepo {
		return &mockPaymentRepo{
			listPaymentsFn: func(_ context.Context, _, _ string, _, _ int) ([]*domain.Payment, int, error) {
				return []*domain.Payment{{ProviderPayoutCents: 500000}}, 1, nil
			},
			listAdvancesFn: func(_ context.Context, _, _ string, _, _ int) ([]*domain.Advance, int, error) {
				return nil, 0, nil
			},
			getActiveAdvancesFn: func(_ context.Context, _ string) ([]*domain.Advance, error) {
				return []*domain.Advance{{AdvanceAmountCents: 1000000, FeeCents: 25000, RepaidCents: 0}}, nil
			},
			upsertCreditLimitFn: func(_ context.Context, limit *domain.CreditLimit) error {
				*captured = limit
				return nil
			},
			getCreditLimitFn: func(_ context.Context, _ string) (*domain.CreditLimit, error) {
				return *captured, nil
			},
		}
	}

	t.Run("maps_engine_decision", func(t *testing.T) {
		t.Parallel()
		var captured *domain.CreditLimit
		svc := newTestPaymentService(baseRepo(&captured), nil)
		svc.SetUnderwriter(&mockUnderwriter{fn: func(_ context.Context, _ *underwritingv1.ProviderFeatures) (*underwritingv1.UnderwriteResponse, error) {
			return &underwritingv1.UnderwriteResponse{
				Approved:             true,
				Tier:                 underwritingv1.UnderwritingTier_UNDERWRITING_TIER_PREMIUM,
				MaxCreditCents:       300000,
				AvailableCreditCents: 175000,
				FeeBps:               850,
				FactorRate:           1.085,
				HoldbackPct:          10,
				RiskScore:            0.07,
				BindingCap:           "risk_multiple",
				DecisionHash:         "abc123",
				ModelVersion:         "uw-v1.0.0",
				Reasons: []*underwritingv1.DecisionReason{
					{Code: "REPAYMENT", Label: "On-time repayment history", Contribution: -1.04},
				},
			}, nil
		}})

		limit, err := svc.ComputeCreditLimit(context.Background(), "prov-1")
		require.NoError(t, err)
		assert.True(t, limit.Approved)
		assert.Equal(t, "premium", limit.Tier)
		assert.Equal(t, int64(300000), limit.MaxAdvanceCents)
		assert.Equal(t, int64(175000), limit.AvailableAdvanceCents)
		assert.Equal(t, int32(850), limit.FeeBps)
		assert.InDelta(t, 1.085, limit.FactorRate, 0.0001)
		assert.Equal(t, int32(10), limit.HoldbackPct)
		assert.InDelta(t, 0.07, limit.RiskScore, 0.0001)
		assert.Equal(t, "risk_multiple", limit.BindingCap)
		assert.Equal(t, "abc123", limit.DecisionHash)
		assert.Equal(t, "uw-v1.0.0", limit.ModelVersion)
		require.Len(t, limit.Reasons, 1)
		assert.Equal(t, "REPAYMENT", limit.Reasons[0].Code)
	})

	t.Run("gathers_outstanding_and_trust_features", func(t *testing.T) {
		t.Parallel()
		var captured *domain.CreditLimit
		var gotFeatures *underwritingv1.ProviderFeatures
		svc := newTestPaymentService(baseRepo(&captured), nil)
		svc.SetTrustSource(&mockTrustSource{fn: func(_ context.Context, _ string) (float64, float64, float64, string, error) {
			return 0.8, 0.81, 0.99, "trusted", nil
		}})
		svc.SetUnderwriter(&mockUnderwriter{fn: func(_ context.Context, f *underwritingv1.ProviderFeatures) (*underwritingv1.UnderwriteResponse, error) {
			gotFeatures = f
			return &underwritingv1.UnderwriteResponse{Approved: true, MaxCreditCents: 100000, AvailableCreditCents: 100000, FactorRate: 1.1}, nil
		}})

		_, err := svc.ComputeCreditLimit(context.Background(), "prov-1")
		require.NoError(t, err)
		require.NotNil(t, gotFeatures)
		// Outstanding = principal+fee-repaid = 1_025_000, sourced server-side.
		assert.Equal(t, int64(1025000), gotFeatures.OutstandingAdvanceCents)
		// Trust dimensions flow from the trust source.
		assert.InDelta(t, 0.8, gotFeatures.TrustOverall, 0.0001)
		assert.InDelta(t, 0.99, gotFeatures.TrustFraud, 0.0001)
		assert.Equal(t, "trusted", gotFeatures.TrustTier)
	})

	t.Run("fail_closed_without_engine", func(t *testing.T) {
		t.Parallel()
		var captured *domain.CreditLimit
		// Construct directly so NO underwriter/trust is wired.
		svc := NewPaymentService(baseRepo(&captured), &StripeService{devMode: true})

		limit, err := svc.ComputeCreditLimit(context.Background(), "prov-1")
		require.NoError(t, err)
		assert.False(t, limit.Approved)
		assert.Equal(t, "ineligible", limit.Tier)
		assert.Equal(t, int64(0), limit.MaxAdvanceCents)
		assert.Contains(t, limit.BindingGate, "UNAVAILABLE")
	})

	t.Run("fail_closed_on_trust_error", func(t *testing.T) {
		t.Parallel()
		var captured *domain.CreditLimit
		svc := newTestPaymentService(baseRepo(&captured), nil)
		svc.SetTrustSource(&mockTrustSource{fn: func(_ context.Context, _ string) (float64, float64, float64, string, error) {
			return 0, 0, 0, "", errors.New("trust engine down")
		}})

		limit, err := svc.ComputeCreditLimit(context.Background(), "prov-1")
		require.NoError(t, err)
		assert.False(t, limit.Approved)
		assert.Equal(t, int64(0), limit.MaxAdvanceCents)
		assert.Contains(t, limit.BindingGate, "UNAVAILABLE")
	})

	t.Run("missing_provider_id", func(t *testing.T) {
		t.Parallel()
		svc := newTestPaymentService(&mockPaymentRepo{}, nil)
		_, err := svc.ComputeCreditLimit(context.Background(), "")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "provider_id is required")
	})
}
