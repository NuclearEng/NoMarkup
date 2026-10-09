package service

import (
	"encoding/json"
	"strings"
)

// These helpers parse a payload that has already passed signature
// verification. Callers must run stripe.webhooks.constructEvent() and refuse
// the request before any id, price, or billing_reason from this file is used.

// flexStripeID accepts a Stripe id that is either a string or an expanded object.
type flexStripeID struct {
	ID string
}

func (f *flexStripeID) UnmarshalJSON(b []byte) error {
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	if b[0] == '"' {
		return json.Unmarshal(b, &f.ID)
	}
	var obj struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(b, &obj); err != nil {
		return err
	}
	f.ID = obj.ID
	return nil
}

type stripeEventObject struct {
	ID           string       `json:"id"`
	Subscription flexStripeID `json:"subscription"`
	Parent       struct {
		SubscriptionDetails struct {
			Subscription flexStripeID `json:"subscription"`
		} `json:"subscription_details"`
	} `json:"parent"`
	BillingReason string `json:"billing_reason"`
	Items         struct {
		Data []stripePriceCarrier `json:"data"`
	} `json:"items"`
	Lines struct {
		Data []stripeInvoiceLine `json:"data"`
	} `json:"lines"`
}

type stripePriceCarrier struct {
	Price flexStripeID `json:"price"`
	Plan  flexStripeID `json:"plan"`
	Pricing struct {
		PriceDetails struct {
			Price string `json:"price"`
		} `json:"price_details"`
	} `json:"pricing"`
}

type stripeInvoiceLine struct {
	Amount  int64        `json:"amount"`
	Price   flexStripeID `json:"price"`
	Plan    flexStripeID `json:"plan"`
	Pricing struct {
		PriceDetails struct {
			Price string `json:"price"`
		} `json:"price_details"`
	} `json:"pricing"`
	Parent struct {
		InvoiceItemDetails struct {
			Proration bool `json:"proration"`
		} `json:"invoice_item_details"`
		SubscriptionItemDetails struct {
			Proration bool `json:"proration"`
		} `json:"subscription_item_details"`
	} `json:"parent"`
}

func (c stripePriceCarrier) priceID() string {
	if id := c.Pricing.PriceDetails.Price; strings.HasPrefix(id, "price_") {
		return id
	}
	if strings.HasPrefix(c.Price.ID, "price_") {
		return c.Price.ID
	}
	if strings.HasPrefix(c.Plan.ID, "price_") {
		return c.Plan.ID
	}
	return ""
}

func (l stripeInvoiceLine) priceID() string {
	return stripePriceCarrier{Price: l.Price, Plan: l.Plan, Pricing: l.Pricing}.priceID()
}

func (l stripeInvoiceLine) proration() bool {
	return l.Parent.InvoiceItemDetails.Proration || l.Parent.SubscriptionItemDetails.Proration
}

// SubscriptionIDFromStripeObject reads a subscription id from one Stripe
// object. An invoice id is never returned.
func SubscriptionIDFromStripeObject(eventType string, objectJSON []byte) (string, bool) {
	var obj stripeEventObject
	if err := json.Unmarshal(objectJSON, &obj); err != nil {
		return "", false
	}
	if id := obj.Parent.SubscriptionDetails.Subscription.ID; strings.HasPrefix(id, "sub_") {
		return id, true
	}
	if id := obj.Subscription.ID; strings.HasPrefix(id, "sub_") {
		return id, true
	}
	if strings.HasPrefix(eventType, "customer.subscription.") && strings.HasPrefix(obj.ID, "sub_") {
		return obj.ID, true
	}
	return "", false
}

// SubscriptionIDFromStripeEvent reads the subscription id from a full event
// body. Invoice payloads put it on parent.subscription_details.subscription.
func SubscriptionIDFromStripeEvent(eventType string, payload []byte) (string, bool) {
	objectJSON := stripeEventObjectJSON(payload)
	if len(objectJSON) == 0 {
		return "", false
	}
	return SubscriptionIDFromStripeObject(eventType, objectJSON)
}

// ResolvedSubscriptionID picks the subscription id, or "" when an invoice or
// subscription event does not carry one. Callers must not fall back to an
// invoice id.
func ResolvedSubscriptionID(eventType string, payload []byte, objectID, legacySubscription string) string {
	if id, ok := SubscriptionIDFromStripeEvent(eventType, payload); ok {
		return id
	}
	if strings.HasPrefix(eventType, "invoice.") || strings.HasPrefix(eventType, "customer.subscription.") {
		return ""
	}
	if strings.HasPrefix(legacySubscription, "sub_") {
		return legacySubscription
	}
	if strings.HasPrefix(objectID, "sub_") {
		return objectID
	}
	return ""
}

// BillingReasonFromStripeObject returns an invoice billing_reason, or "".
func BillingReasonFromStripeObject(objectJSON []byte) string {
	var obj stripeEventObject
	if err := json.Unmarshal(objectJSON, &obj); err != nil {
		return ""
	}
	return obj.BillingReason
}

// BillingReasonFromStripeEvent returns billing_reason from a full event body.
func BillingReasonFromStripeEvent(payload []byte) string {
	return BillingReasonFromStripeObject(stripeEventObjectJSON(payload))
}

// PriceIDForTierSyncFromStripeObject returns the Stripe Price that should
// become the local plan after a paid invoice or an applied subscription
// update. A credit-only line is ignored so an unpaid upgrade cannot roll the
// local plan backward.
func PriceIDForTierSyncFromStripeObject(eventType string, objectJSON []byte) string {
	var obj stripeEventObject
	if err := json.Unmarshal(objectJSON, &obj); err != nil {
		return ""
	}
	if strings.HasPrefix(eventType, "customer.subscription.") {
		for _, item := range obj.Items.Data {
			if id := item.priceID(); id != "" {
				return id
			}
		}
		return ""
	}
	if eventType != "invoice.paid" {
		return ""
	}
	var bestProration string
	var bestProrationAmount int64
	var bestCharge string
	var bestChargeAmount int64
	for _, line := range obj.Lines.Data {
		id := line.priceID()
		if id == "" || line.Amount <= 0 {
			continue
		}
		if line.proration() {
			if line.Amount > bestProrationAmount {
				bestProration = id
				bestProrationAmount = line.Amount
			}
			continue
		}
		if line.Amount > bestChargeAmount {
			bestCharge = id
			bestChargeAmount = line.Amount
		}
	}
	if bestProration != "" {
		return bestProration
	}
	return bestCharge
}

// PriceIDForTierSyncFromStripeEvent reads the price id from a full event body.
func PriceIDForTierSyncFromStripeEvent(eventType string, payload []byte) string {
	return PriceIDForTierSyncFromStripeObject(eventType, stripeEventObjectJSON(payload))
}

func stripeEventObjectJSON(payload []byte) []byte {
	var event struct {
		Data struct {
			Object json.RawMessage `json:"object"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &event); err != nil {
		return nil
	}
	return event.Data.Object
}
