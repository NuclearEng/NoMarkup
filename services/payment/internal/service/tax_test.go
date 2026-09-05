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

func TestFormatCentsToDollars(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name  string
		cents int64
		want  string
	}{
		{"zero", 0, "$0.00"},
		{"one_cent", 1, "$0.01"},
		{"ninety_nine_cents", 99, "$0.99"},
		{"one_dollar", 100, "$1.00"},
		{"large", 1234567, "$12345.67"},
		{"negative", -100, "$-1.00"},
		{"negative_with_remainder", -150, "$-1.50"},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, formatCentsToDollars(tt.cents))
		})
	}
}

func TestPaymentService_GenerateTaxForm(t *testing.T) {
	t.Parallel()

	currentYear := time.Now().Year()

	t.Run("happy_path_uses_repo_data", func(t *testing.T) {
		t.Parallel()
		var captured *domain.TaxForm
		repo := &mockPaymentRepo{
			getProviderEarningsFn: func(_ context.Context, providerID string, year int) (int64, error) {
				assert.Equal(t, "prov-1", providerID)
				assert.Equal(t, currentYear-1, year)
				return 5234500, nil // $52,345.00
			},
			getProviderProfileFn: func(_ context.Context, _ string) (string, string, error) {
				return "Acme HVAC LLC", "123 Pine St, Seattle WA 98101", nil
			},
			createTaxFormFn: func(_ context.Context, tf *domain.TaxForm) error {
				captured = tf
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)

		tf, err := svc.GenerateTaxForm(context.Background(), "prov-1", currentYear-1)
		require.NoError(t, err)
		require.NotNil(t, tf)
		assert.Equal(t, int64(5234500), tf.TotalCompensationCents)
		assert.Equal(t, "Acme HVAC LLC", tf.ProviderLegalName)
		assert.Equal(t, "123 Pine St, Seattle WA 98101", tf.ProviderAddress)
		assert.Equal(t, "1099-nec", tf.FormType)
		assert.Equal(t, "generated", tf.Status)
		assert.Equal(t, testPlatformEIN, tf.PlatformEIN)
		assert.NotEmpty(t, tf.ID)
		require.NotNil(t, tf.PDFURL)
		assert.Contains(t, *tf.PDFURL, "/tax-forms/")
		require.NotNil(t, captured)
		assert.Equal(t, tf.ID, captured.ID)
	})

	t.Run("falls_back_when_provider_profile_missing", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getProviderEarningsFn: func(_ context.Context, _ string, _ int) (int64, error) { return 75000, nil },
			getProviderProfileFn: func(_ context.Context, _ string) (string, string, error) {
				return "", "", errors.New("profile not found")
			},
		}
		svc := newTestPaymentService(repo, nil)
		tf, err := svc.GenerateTaxForm(context.Background(), "prov-1", currentYear-1)
		require.NoError(t, err)
		assert.Equal(t, "Provider", tf.ProviderLegalName)
		assert.Equal(t, "Address on file", tf.ProviderAddress)
	})

	t.Run("uses_default_address_when_profile_address_blank", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getProviderEarningsFn: func(_ context.Context, _ string, _ int) (int64, error) { return 75000, nil },
			getProviderProfileFn: func(_ context.Context, _ string) (string, string, error) {
				return "Solo Plumbing", "", nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		tf, err := svc.GenerateTaxForm(context.Background(), "prov-1", currentYear-1)
		require.NoError(t, err)
		assert.Equal(t, "Solo Plumbing", tf.ProviderLegalName)
		assert.Equal(t, "Address on file", tf.ProviderAddress)
	})

	t.Run("missing_provider_id", func(t *testing.T) {
		t.Parallel()
		svc := newTestPaymentService(&mockPaymentRepo{}, nil)
		_, err := svc.GenerateTaxForm(context.Background(), "", currentYear-1)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "provider_id is required")
	})

	t.Run("rejects_year_before_2020", func(t *testing.T) {
		t.Parallel()
		svc := newTestPaymentService(&mockPaymentRepo{}, nil)
		_, err := svc.GenerateTaxForm(context.Background(), "prov-1", 2019)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid tax year")
	})

	t.Run("rejects_future_year", func(t *testing.T) {
		t.Parallel()
		svc := newTestPaymentService(&mockPaymentRepo{}, nil)
		_, err := svc.GenerateTaxForm(context.Background(), "prov-1", currentYear+1)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid tax year")
	})

	t.Run("propagates_earnings_query_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getProviderEarningsFn: func(_ context.Context, _ string, _ int) (int64, error) {
				return 0, errors.New("db down")
			},
		}
		svc := newTestPaymentService(repo, nil)
		_, err := svc.GenerateTaxForm(context.Background(), "prov-1", currentYear-1)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "db down")
	})

	t.Run("propagates_create_tax_form_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getProviderEarningsFn: func(_ context.Context, _ string, _ int) (int64, error) { return 75000, nil },
			createTaxFormFn: func(_ context.Context, _ *domain.TaxForm) error {
				return errors.New("unique violation")
			},
		}
		svc := newTestPaymentService(repo, nil)
		_, err := svc.GenerateTaxForm(context.Background(), "prov-1", currentYear-1)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "unique violation")
	})

	t.Run("gates_below_600_dollar_irs_threshold", func(t *testing.T) {
		t.Parallel()
		createCalled := false
		repo := &mockPaymentRepo{
			// $599.99 — one cent below the $600 (60000-cent) IRS 1099-NEC threshold.
			getProviderEarningsFn: func(_ context.Context, _ string, _ int) (int64, error) { return 59999, nil },
			createTaxFormFn: func(_ context.Context, _ *domain.TaxForm) error {
				createCalled = true
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		_, err := svc.GenerateTaxForm(context.Background(), "prov-1", currentYear-1)
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrBelow1099Threshold)
		assert.False(t, createCalled, "must not persist a 1099 below the $600 threshold")
	})

	t.Run("allows_exactly_600_dollar_threshold", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getProviderEarningsFn: func(_ context.Context, _ string, _ int) (int64, error) { return 60000, nil },
			getProviderProfileFn: func(_ context.Context, _ string) (string, string, error) {
				return "Edge Co", "1 Edge St", nil
			},
			createTaxFormFn: func(_ context.Context, _ *domain.TaxForm) error { return nil },
		}
		svc := newTestPaymentService(repo, nil)
		tf, err := svc.GenerateTaxForm(context.Background(), "prov-1", currentYear-1)
		require.NoError(t, err)
		assert.Equal(t, int64(60000), tf.TotalCompensationCents)
		assert.Equal(t, testPlatformEIN, tf.PlatformEIN)
	})

	t.Run("uses_injected_platform_ein", func(t *testing.T) {
		t.Parallel()
		const injected = "98-7654321"
		repo := &mockPaymentRepo{
			getProviderEarningsFn: func(_ context.Context, _ string, _ int) (int64, error) { return 75000, nil },
			createTaxFormFn:       func(_ context.Context, _ *domain.TaxForm) error { return nil },
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetPlatformEIN(injected)
		tf, err := svc.GenerateTaxForm(context.Background(), "prov-1", currentYear-1)
		require.NoError(t, err)
		assert.Equal(t, injected, tf.PlatformEIN)
	})

	t.Run("rejects_unusable_platform_ein", func(t *testing.T) {
		t.Parallel()
		cases := []struct {
			name string
			ein  string
		}{
			{"missing", ""},
			{"whitespace", "  \t "},
			{"dummy", dummyPlatformEIN},
			{"dummy_padded", "  " + dummyPlatformEIN + "  "},
			{"no_hyphen", "123456789"},
			{"letters", "AB-1234567"},
			{"too_short", "12-345678"},
			{"too_long", "12-34567890"},
			{"missing_hyphen_digit", "1-23456789"},
		}
		for _, tt := range cases {
			t.Run(tt.name, func(t *testing.T) {
				t.Parallel()
				createCalled := false
				repo := &mockPaymentRepo{
					getProviderEarningsFn: func(_ context.Context, _ string, _ int) (int64, error) {
						return 75000, nil
					},
					createTaxFormFn: func(_ context.Context, _ *domain.TaxForm) error {
						createCalled = true
						return nil
					},
				}
				svc := newTestPaymentService(repo, nil)
				svc.SetPlatformEIN(tt.ein)
				_, err := svc.GenerateTaxForm(context.Background(), "prov-1", currentYear-1)
				require.Error(t, err)
				assert.ErrorIs(t, err, domain.ErrPlatformEINNotConfigured)
				assert.False(t, createCalled, "must not persist a 1099 with an unusable platform EIN")
			})
		}
	})
}

func TestPaymentService_GetTaxForm(t *testing.T) {
	t.Parallel()

	t.Run("missing_provider_id", func(t *testing.T) {
		t.Parallel()
		svc := newTestPaymentService(&mockPaymentRepo{}, nil)
		_, err := svc.GetTaxForm(context.Background(), "", 2025)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "provider_id is required")
	})

	t.Run("delegates_to_repo", func(t *testing.T) {
		t.Parallel()
		expected := &domain.TaxForm{ID: "tf-1", TaxYear: 2025}
		repo := &mockPaymentRepo{
			getTaxFormFn: func(_ context.Context, providerID string, year int) (*domain.TaxForm, error) {
				assert.Equal(t, "prov-1", providerID)
				assert.Equal(t, 2025, year)
				return expected, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		got, err := svc.GetTaxForm(context.Background(), "prov-1", 2025)
		require.NoError(t, err)
		assert.Equal(t, expected, got)
	})
}

func TestPaymentService_ListTaxForms(t *testing.T) {
	t.Parallel()

	t.Run("missing_provider_id", func(t *testing.T) {
		t.Parallel()
		svc := newTestPaymentService(&mockPaymentRepo{}, nil)
		_, err := svc.ListTaxForms(context.Background(), "")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "provider_id is required")
	})

	t.Run("delegates_to_repo", func(t *testing.T) {
		t.Parallel()
		expected := []*domain.TaxForm{{ID: "tf-1"}, {ID: "tf-2"}}
		repo := &mockPaymentRepo{
			listTaxFormsFn: func(_ context.Context, _ string) ([]*domain.TaxForm, error) {
				return expected, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		got, err := svc.ListTaxForms(context.Background(), "prov-1")
		require.NoError(t, err)
		assert.Equal(t, expected, got)
	})
}

func TestPaymentService_GenerateTaxFormHTML(t *testing.T) {
	t.Parallel()

	t.Run("masks_full_tax_id_when_only_last_4_provided", func(t *testing.T) {
		t.Parallel()
		last4 := "1234"
		repo := &mockPaymentRepo{
			getTaxFormFn: func(_ context.Context, _ string, _ int) (*domain.TaxForm, error) {
				return &domain.TaxForm{
					ID:                      "tf-1",
					TaxYear:                 2025,
					ProviderLegalName:       "Acme",
					ProviderAddress:         "123 Pine St",
					ProviderTaxIDLast4:      &last4,
					TotalCompensationCents:  500000,
					FederalTaxWithheldCents: 0,
					StateTaxWithheldCents:   0,
					PlatformEIN:             "88-1234567",
					PlatformName:            "NoMarkup Inc.",
					CreatedAt:               time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC),
				}, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		html, err := svc.GenerateTaxFormHTML(context.Background(), "prov-1", 2025)
		require.NoError(t, err)
		assert.Contains(t, html, "***-**-1234")
		assert.NotContains(t, html, "1234567890")
		assert.Contains(t, html, "$5000.00") // 500000 cents
		assert.Contains(t, html, "Form 1099-NEC Summary")
		assert.Contains(t, html, "88-1234567",
			"HTML may render an already-stored EIN; generate-path dummy rejection does not apply here")
	})

	t.Run("renders_stored_ein_even_when_service_ein_unset", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getTaxFormFn: func(_ context.Context, _ string, _ int) (*domain.TaxForm, error) {
				return &domain.TaxForm{
					ID:                "tf-stored",
					TaxYear:           2025,
					ProviderLegalName: "Acme",
					ProviderAddress:   "123 Pine St",
					PlatformEIN:       testPlatformEIN,
					PlatformName:      "NoMarkup Inc.",
					CreatedAt:         time.Now(),
				}, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetPlatformEIN("")
		html, err := svc.GenerateTaxFormHTML(context.Background(), "prov-1", 2025)
		require.NoError(t, err)
		assert.Contains(t, html, testPlatformEIN)
	})

	t.Run("hides_tax_id_when_unknown", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getTaxFormFn: func(_ context.Context, _ string, _ int) (*domain.TaxForm, error) {
				return &domain.TaxForm{
					ID:                "tf-1",
					TaxYear:           2025,
					ProviderLegalName: "Acme",
					ProviderAddress:   "Address",
					PlatformName:      "NoMarkup Inc.",
					CreatedAt:         time.Now(),
				}, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		html, err := svc.GenerateTaxFormHTML(context.Background(), "prov-1", 2025)
		require.NoError(t, err)
		assert.Contains(t, html, "TIN: ****")
		assert.False(t, strings.Contains(html, "***-**-"),
			"unredacted partial mask should not appear when last4 unknown")
	})

	t.Run("propagates_get_form_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getTaxFormFn: func(_ context.Context, _ string, _ int) (*domain.TaxForm, error) {
				return nil, errors.New("not found")
			},
		}
		svc := newTestPaymentService(repo, nil)
		_, err := svc.GenerateTaxFormHTML(context.Background(), "prov-1", 2025)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})

	t.Run("escapes_xss_in_provider_legal_name_and_address", func(t *testing.T) {
		// Regression: provider-controlled display name was previously
		// interpolated into the rendered tax form HTML without escaping,
		// allowing <script> injection into a downloadable document.
		t.Parallel()
		repo := &mockPaymentRepo{
			getTaxFormFn: func(_ context.Context, _ string, _ int) (*domain.TaxForm, error) {
				return &domain.TaxForm{
					ID:                "tf-evil",
					TaxYear:           2025,
					ProviderLegalName: `<script>alert("pwn")</script>`,
					ProviderAddress:   `<img src=x onerror=alert(1)>`,
					PlatformName:      `Acme<script>x</script>`,
					PlatformEIN:       `88-1234567`,
					CreatedAt:         time.Now(),
				}, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		html, err := svc.GenerateTaxFormHTML(context.Background(), "prov-1", 2025)
		require.NoError(t, err)
		assert.NotContains(t, html, `<script>alert("pwn")</script>`,
			"raw script tag in provider legal name must not appear in rendered tax HTML")
		assert.NotContains(t, html, `<img src=x onerror=alert(1)>`,
			"raw img-onerror payload in provider address must not appear in rendered tax HTML")
		assert.NotContains(t, html, `<script>x</script>`,
			"raw script tag in platform name must not appear")
		// Escaped form should be present.
		assert.Contains(t, html, `&lt;script&gt;`)
	})
}
