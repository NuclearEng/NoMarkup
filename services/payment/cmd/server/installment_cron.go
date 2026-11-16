package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/services/payment/internal/service"
)

// runInstallmentCron starts the BNPL collection loop.
//
// WHY THIS EXISTS. InstallmentService.ProcessDueInstallments was fully written
// and had zero non-test callers, so after CreateInstallmentPlan took
// installment 1 at plan creation, installments 2..N were never charged. The
// same function pays the provider the FULL contract amount the moment
// installment 1 clears (installment.go), so the platform was fronting 100% of a
// BNPL principal on a product with no collection mechanism whatsoever. This is
// that mechanism.
//
// Serialized fleet-wide by a Postgres advisory lock (see cron_lock.go): N
// replicas ticking together would each read the same due rows and each attempt
// a charge. The deterministic Stripe idempotency key inside processOneInstallment
// would collapse those into one charge, but relying on Stripe to clean up after
// a stampede is not a design — the lock means the stampede never happens.
//
// Daily by default. Due dates are DATE-typed and 30 days apart (migration 021),
// so an hourly cadence would buy nothing but 24x the load and 24x the log noise.
func runInstallmentCron(
	ctx context.Context,
	svc *service.InstallmentService,
	pool *pgxpool.Pool,
	interval, initialDelay time.Duration,
) {
	if svc == nil {
		slog.Warn("BNPL installment cron disabled (no installment service)")
		return
	}
	if pool == nil {
		// Without the pool there is no advisory lock, and an unserialized money
		// worker is worse than no worker. Fail closed and say so.
		slog.Error("BNPL installment cron disabled (no database pool for the advisory lock); " +
			"installments 2..N will NOT be collected")
		return
	}
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	if initialDelay <= 0 {
		initialDelay = 2 * time.Minute
	}

	runLockedCron(ctx, "bnpl-installments", pool, installmentCronLockKey,
		interval, initialDelay, 15*time.Minute,
		func(runCtx context.Context) error {
			stats, err := svc.ProcessDueInstallments(runCtx)
			if err != nil {
				return err
			}

			// Blocked means the platform, not the customer, is why nothing was
			// collected — no Stripe customer/instrument on file. That is an
			// operator page, not a customer-facing failure, and it deliberately
			// does not burn a retry attempt or default the plan.
			if stats.Blocked > 0 {
				slog.ErrorContext(runCtx, "BNPL: installments could not be attempted — no payment instrument on file. "+
					"This is a platform configuration failure, not a customer default. "+
					"No attempt was burned and no plan was defaulted.",
					"blocked", stats.Blocked,
					"due", stats.Due,
				)
			}
			if stats.Due > 0 {
				slog.InfoContext(runCtx, "BNPL: installment collection pass complete",
					"due", stats.Due,
					"charged", stats.Charged,
					"declined", stats.Declined,
					"blocked", stats.Blocked,
					"plans_defaulted", stats.PlansDefaulted,
				)
			}
			return nil
		})
}
