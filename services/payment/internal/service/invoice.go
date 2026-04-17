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

	// Compute payment totals.
	var totalPaid, totalPlatformFee, totalGuaranteeFee, totalProviderPayout int64
	for _, p := range payments {
		if p.Status == "completed" || p.Status == "released" || p.Status == "escrow" {
			totalPaid += p.AmountCents
			totalPlatformFee += p.PlatformFeeCents
			totalGuaranteeFee += p.GuaranteeFeeCents
			totalProviderPayout += p.ProviderPayoutCents
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
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>Invoice</h1>
    <div style="font-size: 14px; color: #666; margin-top: 4px;">%s</div>
  </div>
  <div class="invoice-meta">
    <div class="invoice-num">%s</div>
    <div class="date">Contract Date: %s</div>
    <div class="date">Generated: %s</div>
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
    </div>
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
    </div>
  </div>
</div>

<div class="footer">
  <p>Contract: %s | Payment Terms: %s</p>
  <p>Generated by NoMarkup Inc.</p>
</div>
</body>
</html>`,
		invoiceNum,
		htmlEscape(contract.JobTitle),
		invoiceNum, contractDate, generatedDate,
		htmlEscape(contract.CustomerName),
		htmlEscape(contract.ProviderName),
		lineItemsHTML.String(),
		paymentsHTML.String(),
		formatCentsToDollars(contract.AmountCents),
		formatCentsToDollars(totalPlatformFee),
		formatCentsToDollars(totalGuaranteeFee),
		formatCentsToDollars(totalProviderPayout),
		formatCentsToDollars(totalPaid),
		formatCentsToDollars(outstanding),
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
