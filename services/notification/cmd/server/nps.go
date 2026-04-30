package main

// nps.go — post-transaction NPS survey scheduler.
//
// Every hour, finds completed transactions (listing_orders.escrow_status =
// 'released' AND released_at <= now() - 48h, plus contracts.status =
// 'completed' AND released_at proxy) that don't yet have a row in
// nps_surveys for the buyer/customer. Inserts a `prompted_at = now()` row
// and queues a `nps_survey` notification (push + in-app). The web client
// polls /api/v1/me/nps/pending and mounts the <NPSSurvey> modal whenever
// the response includes ≥1 row.
//
// The UNIQUE (user_id, context_type, context_id) constraint on
// nps_surveys protects against duplicate prompts even if the scheduler
// runs concurrently or the underlying SELECT races.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/services/notification/internal/service"
)

const npsInterval = 1 * time.Hour

// runNPSScheduler kicks off the NPS prompt loop. Cancel `ctx` to stop it.
func runNPSScheduler(ctx context.Context, pool *pgxpool.Pool, svc *service.Service) {
	if pool == nil || svc == nil {
		slog.Warn("nps scheduler: missing dependencies, skipping",
			"pool_nil", pool == nil, "svc_nil", svc == nil)
		return
	}

	go func() {
		slog.Info("nps scheduler starting", "interval", npsInterval.String())
		t := time.NewTicker(npsInterval)
		defer t.Stop()

		runNPSTick(ctx, pool, svc)

		for {
			select {
			case <-t.C:
				runNPSTick(ctx, pool, svc)
			case <-ctx.Done():
				slog.Info("nps scheduler stopping")
				return
			}
		}
	}()
}

// runNPSTick processes one sweep across listing_orders + contracts.
func runNPSTick(ctx context.Context, pool *pgxpool.Pool, svc *service.Service) {
	tickCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	if err := promptListingOrders(tickCtx, pool, svc); err != nil {
		slog.WarnContext(tickCtx, "nps: listing_orders sweep failed", "error", err)
	}
	if err := promptContracts(tickCtx, pool, svc); err != nil {
		slog.WarnContext(tickCtx, "nps: contracts sweep failed", "error", err)
	}
}

// promptListingOrders finds released listing_orders ≥48h old without an
// nps_surveys row for the buyer, and queues the prompt.
func promptListingOrders(ctx context.Context, pool *pgxpool.Pool, svc *service.Service) error {
	rows, err := pool.Query(ctx, `
		SELECT lo.id::text, lo.buyer_id::text
		  FROM listing_orders lo
		 WHERE lo.escrow_status = 'released'
		   AND lo.released_at IS NOT NULL
		   AND lo.released_at <= now() - interval '48 hours'
		   AND NOT EXISTS (
		     SELECT 1 FROM nps_surveys s
		      WHERE s.user_id = lo.buyer_id
		        AND s.context_type = 'listing_order'
		        AND s.context_id = lo.id
		   )
		 LIMIT 200`)
	if err != nil {
		// Tolerate dev DBs without the nps_surveys table yet.
		if isUndefinedRelation(err) {
			return nil
		}
		return fmt.Errorf("query listing_orders: %w", err)
	}
	defer rows.Close()

	type pending struct {
		orderID string
		buyerID string
	}
	out := make([]pending, 0, 32)
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.orderID, &p.buyerID); err != nil {
			slog.WarnContext(ctx, "nps: listing_orders scan failed", "error", err)
			continue
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("rows iter: %w", err)
	}

	for _, p := range out {
		if err := insertAndPromptNPS(ctx, pool, svc, p.buyerID, "listing_order", p.orderID); err != nil {
			slog.WarnContext(ctx, "nps: listing_order prompt failed",
				"order_id", p.orderID, "buyer_id", p.buyerID, "error", err)
		}
	}
	if len(out) > 0 {
		slog.InfoContext(ctx, "nps: listing_orders tick complete", "prompts", len(out))
	}
	return nil
}

// promptContracts finds completed contracts ≥48h old without an
// nps_surveys row for the customer, and queues the prompt.
func promptContracts(ctx context.Context, pool *pgxpool.Pool, svc *service.Service) error {
	// `released_at` doesn't exist on contracts; we use updated_at as the
	// completion proxy and require status='completed'. If a column rename
	// breaks this query, the error path below logs and short-circuits.
	rows, err := pool.Query(ctx, `
		SELECT c.id::text, c.customer_id::text
		  FROM contracts c
		 WHERE c.status = 'completed'
		   AND c.updated_at <= now() - interval '48 hours'
		   AND NOT EXISTS (
		     SELECT 1 FROM nps_surveys s
		      WHERE s.user_id = c.customer_id
		        AND s.context_type = 'contract'
		        AND s.context_id = c.id
		   )
		 LIMIT 200`)
	if err != nil {
		if isUndefinedRelation(err) {
			return nil
		}
		return fmt.Errorf("query contracts: %w", err)
	}
	defer rows.Close()

	type pending struct {
		contractID string
		customerID string
	}
	out := make([]pending, 0, 32)
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.contractID, &p.customerID); err != nil {
			slog.WarnContext(ctx, "nps: contract scan failed", "error", err)
			continue
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("rows iter: %w", err)
	}

	for _, p := range out {
		if err := insertAndPromptNPS(ctx, pool, svc, p.customerID, "contract", p.contractID); err != nil {
			slog.WarnContext(ctx, "nps: contract prompt failed",
				"contract_id", p.contractID, "customer_id", p.customerID, "error", err)
		}
	}
	if len(out) > 0 {
		slog.InfoContext(ctx, "nps: contracts tick complete", "prompts", len(out))
	}
	return nil
}

// insertAndPromptNPS does the INSERT + notification dispatch atomically
// from the user's perspective: the unique-key collision (re-prompt
// race) silently no-ops because of ON CONFLICT DO NOTHING.
func insertAndPromptNPS(ctx context.Context, pool *pgxpool.Pool, svc *service.Service, userID, contextType, contextID string) error {
	tag, err := pool.Exec(ctx, `
		INSERT INTO nps_surveys (user_id, context_type, context_id, prompted_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (user_id, context_type, context_id) DO NOTHING`,
		userID, contextType, contextID,
	)
	if err != nil {
		return fmt.Errorf("insert nps_survey: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Already prompted; nothing to do.
		return nil
	}

	const (
		title = "How was your experience?"
		body  = "It only takes 10 seconds. Tell us how likely you are to recommend NoMarkup to a friend."
	)
	actionURL := "/dashboard?nps=1"
	data := map[string]string{
		"entity_type":  contextType,
		"entity_id":    contextID,
		"nps_survey":   "1",
	}
	channels := []string{"in_app", "push"}
	if _, _, err := svc.SendNotification(ctx, userID, "nps_survey", title, body, actionURL, data, channels); err != nil {
		return fmt.Errorf("dispatch nps notification: %w", err)
	}
	return nil
}

// isUndefinedRelation surfaces SQLSTATE 42P01 (table missing). The
// notification service shares the welcome_emails.go convention of
// log-and-skip when migrations haven't run.
func isUndefinedRelation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "42p01") || strings.Contains(msg, "does not exist") {
		return true
	}
	// Defensive: treat wrapped pgx errors the same way.
	return errors.New(msg).Error() != "" && (strings.Contains(msg, "relation") && strings.Contains(msg, "does not exist"))
}
