package service

import (
	"context"
	"fmt"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
)

// NotificationSender is the narrow surface the marketplace notifier needs.
// *client.NotificationClient satisfies it; tests substitute a recorder.
type NotificationSender interface {
	Send(ctx context.Context, userID string, notificationType notificationv1.NotificationType,
		title, body, actionURL string, data map[string]string) error
}

// marketplaceNotifier is the production MarketplaceNotifier: it turns escrow and
// payment events into user-facing notifications.
//
// Until this existed, MarketplaceService ran with noopMarketplaceNotifier in
// production — main.go never called SetNotifier — so all five notification
// methods were silent no-ops. A seller was never told their money was released,
// a seller was never told a dispute had been filed against them, and (with
// off-session collection now enabled) a buyer whose card failed would never be
// told either. That last one is the serious case: the buyer's only remaining
// signal would be an order silently expiring.
type marketplaceNotifier struct {
	sender NotificationSender
}

// NewMarketplaceNotifier builds a MarketplaceNotifier over a notification
// sender. Returns nil when sender is nil so callers can pass the result
// straight to SetNotifier, which ignores nil and keeps the no-op default.
func NewMarketplaceNotifier(sender NotificationSender) MarketplaceNotifier {
	if sender == nil {
		return nil
	}
	return &marketplaceNotifier{sender: sender}
}

// orderURL is the buyer/seller-facing deep link for an order.
func orderURL(orderID string) string { return "/orders/" + orderID }

func (n *marketplaceNotifier) NotifyPaymentReleased(ctx context.Context, sellerID, orderID string, amountCents int64) error {
	return n.sender.Send(ctx, sellerID,
		notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_RELEASED,
		"Payment released",
		fmt.Sprintf("The buyer confirmed pickup. %s is on its way to your account.", formatCents(amountCents)),
		orderURL(orderID),
		map[string]string{"order_id": orderID, "amount_cents": fmt.Sprintf("%d", amountCents)},
	)
}

func (n *marketplaceNotifier) NotifyAutoReleaseToBuyer(ctx context.Context, buyerID, orderID string) error {
	return n.sender.Send(ctx, buyerID,
		notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_RELEASED,
		"Order closed automatically",
		"You didn't confirm pickup or open a dispute, so this order closed and the seller has been paid.",
		orderURL(orderID),
		map[string]string{"order_id": orderID, "reason": "auto_release"},
	)
}

func (n *marketplaceNotifier) NotifyAutoReleaseToSeller(ctx context.Context, sellerID, orderID string, amountCents int64) error {
	return n.sender.Send(ctx, sellerID,
		notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_RELEASED,
		"Payment released",
		fmt.Sprintf("The dispute window closed with no dispute. %s is on its way to your account.", formatCents(amountCents)),
		orderURL(orderID),
		map[string]string{"order_id": orderID, "amount_cents": fmt.Sprintf("%d", amountCents), "reason": "auto_release"},
	)
}

func (n *marketplaceNotifier) NotifyDisputeFiled(ctx context.Context, sellerID, orderID, disputeID string) error {
	return n.sender.Send(ctx, sellerID,
		notificationv1.NotificationType_NOTIFICATION_TYPE_DISPUTE_OPENED,
		"A dispute was opened on your order",
		"The buyer opened a dispute. Payment is on hold until it's resolved.",
		orderURL(orderID),
		map[string]string{"order_id": orderID, "dispute_id": disputeID},
	)
}

func (n *marketplaceNotifier) NotifyDisputeResolved(ctx context.Context, userID, orderID, disputeID, resolution string) error {
	return n.sender.Send(ctx, userID,
		notificationv1.NotificationType_NOTIFICATION_TYPE_DISPUTE_RESOLVED,
		"Dispute resolved",
		disputeResolutionMessage(resolution),
		orderURL(orderID),
		map[string]string{"order_id": orderID, "dispute_id": disputeID, "resolution": resolution},
	)
}

// NotifyListingPaymentProblem tells the buyer an off-session charge did not
// complete, and what to do.
//
// SCA (ChargeOutcomeAuthenticationRequired) uses
// NOTIFICATION_TYPE_PAYMENT_AUTHENTICATION_REQUIRED so the UI can render an
// Authenticate CTA. Hard declines / expired cards stay on PAYMENT_FAILED.
// Data["outcome"] and Data["action_required"] remain for older clients.
func (n *marketplaceNotifier) NotifyListingPaymentProblem(ctx context.Context, buyerID, orderID string, outcome ChargeOutcome, buyerMessage string) error {
	title := "There's a problem with your payment"
	typ := notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_FAILED
	if outcome == ChargeOutcomeAuthenticationRequired {
		title = "Your bank needs you to confirm this payment"
		typ = notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_AUTHENTICATION_REQUIRED
	}
	return n.sender.Send(ctx, buyerID,
		typ,
		title,
		buyerMessage,
		orderURL(orderID),
		map[string]string{
			"order_id": orderID,
			"outcome":  string(outcome),
			// Lets older UI clients decide Authenticate vs Update card.
			"action_required": fmt.Sprintf("%t", outcome == ChargeOutcomeAuthenticationRequired),
		},
	)
}

func (n *marketplaceNotifier) NotifyListingPaymentCaptured(ctx context.Context, buyerID, orderID string, totalCents int64) error {
	return n.sender.Send(ctx, buyerID,
		notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_RECEIVED,
		"Payment received",
		fmt.Sprintf("We charged %s for the item you won. Arrange pickup with the seller.", formatCents(totalCents)),
		orderURL(orderID),
		map[string]string{"order_id": orderID, "total_cents": fmt.Sprintf("%d", totalCents)},
	)
}

// disputeResolutionMessage renders an admin resolution for a participant.
func disputeResolutionMessage(resolution string) string {
	switch resolution {
	case "refund_full":
		return "The dispute was resolved with a full refund to the buyer."
	case "refund_partial":
		return "The dispute was resolved with a partial refund to the buyer."
	case "release_to_seller":
		return "The dispute was resolved in the seller's favor and the payment was released."
	case "no_action":
		return "The dispute was reviewed and closed with no change to the payment."
	default:
		return "The dispute on your order was resolved."
	}
}

// formatCents renders integer cents as a dollar string for display ONLY.
//
// MONEY: this is a presentation helper and its output must never be parsed back
// into an amount. All arithmetic stays in integer cents (CLAUDE.md §5); the
// division here is integer division on the dollars and a separate remainder for
// the cents, so no float is involved at any point. Negative inputs are not
// expected (every caller passes a non-negative total) but are rendered
// sign-first rather than producing "$-1.-5".
func formatCents(cents int64) string {
	neg := cents < 0
	if neg {
		cents = -cents
	}
	s := fmt.Sprintf("$%d.%02d", cents/100, cents%100)
	if neg {
		return "-" + s
	}
	return s
}
