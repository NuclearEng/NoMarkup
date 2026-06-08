package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// GenerateInvoice creates an HTML invoice for a contract.
func (s *PaymentService) GenerateInvoice(ctx context.Context, contractID string) (string, error) {
	if contractID == "" {
		return "", fmt.Errorf("generate invoice: contract_id is required")
	}

	// Fetch contract details.
	contract, err := s.repo.GetContractDetail(ctx, contractID)
	if err != nil {
		return "", fmt.Errorf("generate invoice: %w", err)
	}

	// Fetch milestones.
	milestones, err := s.repo.GetMilestonesForContract(ctx, contractID)
	if err != nil {
		slog.Warn("failed to fetch milestones for invoice",
			"contract_id", contractID,
			"error", err,
		)
	}

	// Fetch payments.
	payments, err := s.repo.GetPaymentsForContract(ctx, contractID)
	if err != nil {
		slog.Warn("failed to fetch payments for invoice",
			"contract_id", contractID,
			"error", err,
		)
	}

	// Generate invoice number from contract ID.
	invoiceNum := "INV-" + strings.ToUpper(contractID[:8])

	// Compute payment totals from RECORDED payments (the actual money that has
	// moved). totalPaid only counts settled/in-escrow payments.
	var totalPaid, totalPlatformFee, totalGuaranteeFee, totalProviderPayout int64
	var hasRecordedFees bool
	for _, p := range payments {
		if p.Status == "completed" || p.Status == "released" || p.Status == "escrow" {
			totalPaid += p.AmountCents
			totalPlatformFee += p.PlatformFeeCents
			totalGuaranteeFee += p.GuaranteeFeeCents
			totalProviderPayout += p.ProviderPayoutCents
			hasRecordedFees = true
		}
	}

	// The fee breakdown shown on the invoice. Prefer the ACTUAL recorded
	// breakdown when a payment exists. Otherwise (unpaid contract) fall back to
	// the PROJECTED breakdown computed from the active fee config, so the
	// customer/provider can see exactly what the fees will be before paying —
	// rather than a misleading all-zero summary.
	platformFeeCents := totalPlatformFee
	guaranteeFeeCents := totalGuaranteeFee
	providerPayoutCents := totalProviderPayout
	var leadGenFeeCents int64
	feesAreProjected := false

	if !hasRecordedFees && contract.AmountCents > 0 {
		// Project from the active (default) fee config. The same CalculateFees
		// logic used at payment time, so projected matches what will be charged.
		// ContractDetail carries no category, so we use the default config.
		if breakdown, feeErr := s.CalculateFees(ctx, contract.AmountCents, nil); feeErr != nil {
			slog.Warn("failed to project fees for unpaid invoice; showing config-free fallback",
				"contract_id", contractID,
				"error", feeErr,
			)
		} else {
			platformFeeCents = breakdown.PlatformFeeCents
			guaranteeFeeCents = breakdown.GuaranteeFeeCents
			providerPayoutCents = breakdown.ProviderPayoutCents
			leadGenFeeCents = breakdown.LeadGenFeeCents
			feesAreProjected = true
		}
	}

	// Build line items HTML.
	var lineItemsHTML strings.Builder
	if len(milestones) > 0 {
		for i, m := range milestones {
			statusBadge := milestoneStatusBadge(m.Status)
			lineItemsHTML.WriteString(fmt.Sprintf(`
      <tr>
        <td>%d</td>
        <td>%s</td>
        <td>%s</td>
        <td class="amount">%s</td>
      </tr>`, i+1, htmlEscape(m.Description), statusBadge, formatCentsToDollars(m.AmountCents)))
		}
	} else {
		// No milestones, show a single line item for the contract amount.
		lineItemsHTML.WriteString(fmt.Sprintf(`
      <tr>
        <td>1</td>
        <td>%s</td>
        <td>%s</td>
        <td class="amount">%s</td>
      </tr>`, htmlEscape(contract.JobTitle), contractStatusBadge(contract.Status), formatCentsToDollars(contract.AmountCents)))
	}

	// Build payments HTML.
	var paymentsHTML strings.Builder
	for _, p := range payments {
		if p.Status == "completed" || p.Status == "released" || p.Status == "escrow" {
			dateStr := p.CreatedAt.Format("Jan 2, 2006")
			paymentsHTML.WriteString(fmt.Sprintf(`
      <tr>
        <td>%s</td>
        <td>%s</td>
        <td class="amount">%s</td>
      </tr>`, dateStr, p.Status, formatCentsToDollars(p.AmountCents)))
		}
	}

	if paymentsHTML.Len() == 0 {
		paymentsHTML.WriteString(`
      <tr>
        <td colspan="3" style="text-align: center; color: #888; padding: 16px;">No payments recorded</td>
      </tr>`)
	}

	// Contract date.
	contractDate := contract.CreatedAt.Format("January 2, 2006")
	generatedDate := time.Now().Format("January 2, 2006")

	// Status display.
	outstanding := contract.AmountCents - totalPaid
	if outstanding < 0 {
		outstanding = 0
	}

	// Payment status stamp.
	statusStamp := `<div class="stamp paid">Paid</div>`
	if outstanding > 0 {
		statusStamp = `<div class="stamp due">Balance Due</div>`
	}

	// Optional lead-gen fee line (only when it applies to this contract).
	var leadGenRowHTML string
	if leadGenFeeCents > 0 {
		leadGenRowHTML = fmt.Sprintf(`
    <div class="summary-item">
      <span class="label">Lead-Gen Fee</span>
      <span class="value">%s</span>
    </div>`, formatCentsToDollars(leadGenFeeCents))
	}

	// When the contract is unpaid, the fee figures are projected from the active
	// fee config (not yet charged). Make that explicit so the numbers aren't
	// mistaken for settled amounts.
	var feeNoteHTML string
	if feesAreProjected {
		feeNoteHTML = `
    <div style="font-size: 12px; color: #888; margin-top: 8px;">
      Platform, guarantee, and payout figures are projected from the current fee schedule and apply once this contract is paid.
    </div>`
	}

	html := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Invoice %s</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; background: #fff; padding: 40px; max-width: 800px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a1a1a; padding-bottom: 20px; margin-bottom: 30px; }
  .header h1 { font-size: 28px; font-weight: 700; }
  .invoice-meta { text-align: right; }
  .invoice-meta .invoice-num { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
  .invoice-meta .date { font-size: 13px; color: #666; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 30px; }
  .party { background: #f8f8f8; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; }
  .party .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 4px; }
  .party .name { font-size: 15px; font-weight: 600; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 8px; }
  table { width: 100%%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #666; padding: 8px 12px; border-bottom: 2px solid #1a1a1a; }
  td { padding: 10px 12px; font-size: 14px; border-bottom: 1px solid #e5e5e5; }
  .amount { text-align: right; font-variant-numeric: tabular-nums; }
  .summary { margin-top: 30px; }
  .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .summary-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
  .summary-item .label { color: #666; font-size: 14px; }
  .summary-item .value { font-weight: 600; font-size: 14px; font-variant-numeric: tabular-nums; }
  .summary-item.total { border-bottom: none; border-top: 2px solid #1a1a1a; padding-top: 12px; }
  .summary-item.total .label, .summary-item.total .value { font-size: 16px; font-weight: 700; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .status-completed { background: #dcfce7; color: #166534; }
  .status-active, .status-approved { background: #dbeafe; color: #1e40af; }
  .status-pending { background: #fef3c7; color: #92400e; }
  .status-cancelled { background: #fee2e2; color: #991b1b; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888; line-height: 1.6; }
  .brand { display: flex; align-items: baseline; gap: 2px; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
  .brand .mark { color: #c9a84c; }
  .tagline { font-size: 12px; color: #888; margin-top: 2px; }
  .stamp { display: inline-block; margin-top: 10px; padding: 4px 12px; border-radius: 6px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border: 2px solid; }
  .stamp.paid { color: #166534; border-color: #16653433; background: #dcfce7; }
  .stamp.due { color: #991b1b; border-color: #991b1b33; background: #fee2e2; }
  @page { size: A4; margin: 18mm; }
  @media print {
    body { padding: 0; max-width: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .section, .summary, table tr { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="brand">No<span class="mark">Markup</span></div>
    <div class="tagline">Service Marketplace · Escrow-secured payments</div>
    <h1 style="margin-top:14px;">Invoice</h1>
    <div style="font-size: 14px; color: #666; margin-top: 4px;">%s</div>
  </div>
  <div class="invoice-meta">
    <div class="invoice-num">%s</div>
    <div class="date">Contract Date: %s</div>
    <div class="date">Generated: %s</div>
    %s
  </div>
</div>

<div class="parties">
  <div class="party">
    <div class="label">Bill To (Customer)</div>
    <div class="name">%s</div>
  </div>
  <div class="party">
    <div class="label">Service Provider</div>
    <div class="name">%s</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Line Items</div>
  <table>
    <thead>
      <tr>
        <th style="width: 40px;">#</th>
        <th>Description</th>
        <th>Status</th>
        <th style="text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>%s
    </tbody>
  </table>
</div>

<div class="section">
  <div class="section-title">Payment History</div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Status</th>
        <th style="text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>%s
    </tbody>
  </table>
</div>

<div class="summary">
  <div class="section-title">Summary</div>
  <div style="max-width: 350px; margin-left: auto;">
    <div class="summary-item">
      <span class="label">Contract Total</span>
      <span class="value">%s</span>
    </div>
    <div class="summary-item">
      <span class="label">Platform Fee</span>
      <span class="value">%s</span>
    </div>
    <div class="summary-item">
      <span class="label">Guarantee Fee</span>
      <span class="value">%s</span>
    </div>%s
    <div class="summary-item">
      <span class="label">Provider Payout</span>
      <span class="value">%s</span>
    </div>
    <div class="summary-item">
      <span class="label">Total Paid</span>
      <span class="value">%s</span>
    </div>
    <div class="summary-item total">
      <span class="label">Outstanding</span>
      <span class="value">%s</span>
    </div>%s
  </div>
</div>

<div class="footer">
  <p>Contract %s · Payment terms: %s · Funds held in escrow and released on completion.</p>
  <p>Paid securely through NoMarkup. Questions? billing@nomarkup.com</p>
  <p>NoMarkup Inc. · This invoice was generated electronically and is valid without signature.</p>
</div>
</body>
</html>`,
		invoiceNum,
		htmlEscape(contract.JobTitle),
		invoiceNum, contractDate, generatedDate, statusStamp,
		htmlEscape(contract.CustomerName),
		htmlEscape(contract.ProviderName),
		lineItemsHTML.String(),
		paymentsHTML.String(),
		formatCentsToDollars(contract.AmountCents),
		formatCentsToDollars(platformFeeCents),
		formatCentsToDollars(guaranteeFeeCents),
		leadGenRowHTML,
		formatCentsToDollars(providerPayoutCents),
		formatCentsToDollars(totalPaid),
		formatCentsToDollars(outstanding),
		feeNoteHTML,
		contract.ContractNumber, contract.PaymentTiming,
	)

	slog.Info("invoice generated",
		"contract_id", contractID,
		"invoice_num", invoiceNum,
	)

	return html, nil
}

// htmlEscape escapes basic HTML special characters.
func htmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}

func milestoneStatusBadge(status string) string {
	class := "status-pending"
	switch status {
	case "approved":
		class = "status-approved"
	case "submitted":
		class = "status-active"
	case "in_progress":
		class = "status-active"
	case "disputed":
		class = "status-cancelled"
	}
	return fmt.Sprintf(`<span class="status-badge %s">%s</span>`, class, htmlEscape(status))
}

func contractStatusBadge(status string) string {
	class := "status-pending"
	switch status {
	case "completed":
		class = "status-completed"
	case "active":
		class = "status-active"
	case "cancelled", "voided", "disputed":
		class = "status-cancelled"
	}
	return fmt.Sprintf(`<span class="status-badge %s">%s</span>`, class, htmlEscape(status))
}
