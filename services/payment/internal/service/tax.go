package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// GenerateTaxForm creates or updates a 1099-NEC tax form for a provider and year.
func (s *PaymentService) GenerateTaxForm(ctx context.Context, providerID string, taxYear int) (*domain.TaxForm, error) {
	if providerID == "" {
		return nil, fmt.Errorf("generate tax form: provider_id is required")
	}

	currentYear := time.Now().Year()
	if taxYear < 2020 || taxYear > currentYear {
		return nil, fmt.Errorf("generate tax form: invalid tax year %d", taxYear)
	}

	// Get total provider earnings for the year.
	totalEarnings, err := s.repo.GetProviderEarningsForYear(ctx, providerID, taxYear)
	if err != nil {
		return nil, fmt.Errorf("generate tax form: %w", err)
	}

	// Get provider profile (legal name, address).
	businessName, serviceAddress, err := s.repo.GetProviderProfile(ctx, providerID)
	if err != nil {
		slog.Warn("failed to get provider profile for tax form, using defaults",
			"provider_id", providerID,
			"error", err,
		)
		businessName = "Provider"
		serviceAddress = ""
	}

	if serviceAddress == "" {
		serviceAddress = "Address on file"
	}

	// Build the download URL.
	pdfURL := fmt.Sprintf("/api/v1/providers/me/tax-forms/%d/download", taxYear)

	tf := &domain.TaxForm{
		ID:                      uuid.New().String(),
		ProviderID:              providerID,
		TaxYear:                 taxYear,
		FormType:                "1099-nec",
		ProviderLegalName:       businessName,
		ProviderAddress:         serviceAddress,
		TotalCompensationCents:  totalEarnings,
		FederalTaxWithheldCents: 0,
		StateTaxWithheldCents:   0,
		PlatformEIN:             "88-1234567",
		PlatformName:            "NoMarkup Inc.",
		PDFURL:                  &pdfURL,
		Status:                  "generated",
	}

	if err := s.repo.CreateTaxForm(ctx, tf); err != nil {
		return nil, fmt.Errorf("generate tax form: %w", err)
	}

	slog.Info("tax form generated",
		"tax_form_id", tf.ID,
		"provider_id", providerID,
		"tax_year", taxYear,
		"total_compensation_cents", totalEarnings,
	)

	return tf, nil
}

// GetTaxForm retrieves a tax form by provider and year.
func (s *PaymentService) GetTaxForm(ctx context.Context, providerID string, taxYear int) (*domain.TaxForm, error) {
	if providerID == "" {
		return nil, fmt.Errorf("get tax form: provider_id is required")
	}
	return s.repo.GetTaxForm(ctx, providerID, taxYear)
}

// ListTaxForms returns all tax forms for a provider.
func (s *PaymentService) ListTaxForms(ctx context.Context, providerID string) ([]*domain.TaxForm, error) {
	if providerID == "" {
		return nil, fmt.Errorf("list tax forms: provider_id is required")
	}
	return s.repo.ListTaxForms(ctx, providerID)
}

// GenerateTaxFormHTML produces a professional HTML earnings statement for a given tax form.
func (s *PaymentService) GenerateTaxFormHTML(ctx context.Context, providerID string, taxYear int) (string, error) {
	tf, err := s.repo.GetTaxForm(ctx, providerID, taxYear)
	if err != nil {
		return "", fmt.Errorf("generate tax form html: %w", err)
	}

	dollars := formatCentsToDollars(tf.TotalCompensationCents)
	fedWithheld := formatCentsToDollars(tf.FederalTaxWithheldCents)
	stateWithheld := formatCentsToDollars(tf.StateTaxWithheldCents)

	taxIDDisplay := "****"
	if tf.ProviderTaxIDLast4 != nil && *tf.ProviderTaxIDLast4 != "" {
		taxIDDisplay = "***-**-" + *tf.ProviderTaxIDLast4
	}

	generatedDate := tf.CreatedAt.Format("January 2, 2006")

	html := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>1099-NEC Earnings Statement — Tax Year %d</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; background: #fff; padding: 40px; max-width: 800px; margin: 0 auto; }
  .header { border-bottom: 3px solid #1a1a1a; padding-bottom: 20px; margin-bottom: 30px; }
  .header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  .header .subtitle { font-size: 14px; color: #666; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 8px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 30px; }
  .info-box { background: #f8f8f8; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; }
  .info-box .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 4px; }
  .info-box .value { font-size: 15px; font-weight: 500; }
  .earnings-table { width: 100%%; border-collapse: collapse; margin-top: 8px; }
  .earnings-table th { text-align: left; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #666; padding: 8px 12px; border-bottom: 2px solid #1a1a1a; }
  .earnings-table td { padding: 12px; font-size: 15px; border-bottom: 1px solid #e5e5e5; }
  .earnings-table .amount { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .total-row td { border-bottom: none; border-top: 2px solid #1a1a1a; font-weight: 700; font-size: 16px; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888; }
  .notice { background: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #92400e; margin-top: 24px; }
  @media print { body { padding: 20px; } .notice { background: #fff; border-color: #999; color: #333; } }
</style>
</head>
<body>
<div class="header">
  <h1>Nonemployee Compensation Statement</h1>
  <div class="subtitle">Form 1099-NEC Summary — Tax Year %d</div>
</div>

<div class="info-grid">
  <div class="info-box">
    <div class="label">Payer</div>
    <div class="value">%s</div>
    <div style="font-size: 13px; color: #666; margin-top: 4px;">EIN: %s</div>
  </div>
  <div class="info-box">
    <div class="label">Recipient</div>
    <div class="value">%s</div>
    <div style="font-size: 13px; color: #666; margin-top: 4px;">TIN: %s</div>
    <div style="font-size: 13px; color: #666;">%s</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Compensation Summary</div>
  <table class="earnings-table">
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>1. Nonemployee Compensation</td>
        <td class="amount">%s</td>
      </tr>
      <tr>
        <td>4. Federal Income Tax Withheld</td>
        <td class="amount">%s</td>
      </tr>
      <tr>
        <td>5. State Income Tax Withheld</td>
        <td class="amount">%s</td>
      </tr>
    </tbody>
  </table>
</div>

<div class="notice">
  This is an earnings statement generated by %s for your records. It summarizes the total compensation paid to you during tax year %d. Please consult a tax professional for filing guidance. This document is not a substitute for the official IRS Form 1099-NEC.
</div>

<div class="footer">
  <p>Generated on %s by %s</p>
  <p>Document ID: %s</p>
</div>
</body>
</html>`,
		tf.TaxYear, tf.TaxYear,
		tf.PlatformName, tf.PlatformEIN,
		tf.ProviderLegalName, taxIDDisplay, tf.ProviderAddress,
		dollars, fedWithheld, stateWithheld,
		tf.PlatformName, tf.TaxYear,
		generatedDate, tf.PlatformName, tf.ID,
	)

	return html, nil
}

// formatCentsToDollars converts cents to a formatted dollar string.
func formatCentsToDollars(cents int64) string {
	dollars := cents / 100
	remainder := cents % 100
	if remainder < 0 {
		remainder = -remainder
	}
	return fmt.Sprintf("$%d.%02d", dollars, remainder)
}
