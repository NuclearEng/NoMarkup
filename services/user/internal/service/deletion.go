package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// StripeDeleter abstracts the calls Erasure makes into Stripe so the user
// service does not need a hard dependency on stripe-go. The payment service
// (or a thin wrapper in main.go) is expected to implement these. A nil
// deleter is OK — calls return ("skipped_no_client", nil) so the service
// degrades gracefully in dev / tests.
//
// Implementations MUST handle errors gracefully (e.g. open balance on a
// Connect account) and return a short outcome string for the audit log.
type StripeDeleter interface {
	// DeleteCustomer deletes a Stripe Customer object. Returns an outcome
	// string ("deleted", "skipped_<reason>", or "error: <detail>") that is
	// recorded verbatim in the audit log. Implementations must never panic.
	DeleteCustomer(ctx context.Context, customerID string) (string, error)
	// DeleteConnectAccount deletes a Connect Express account. Stripe
	// rejects deletion if there is an unpaid balance — implementations
	// should detect that and return "skipped_balance" without an error.
	DeleteConnectAccount(ctx context.Context, accountID string) (string, error)
}

// ObjectStoreDeleter abstracts S3 prefix deletion.
type ObjectStoreDeleter interface {
	// DeletePrefix removes every object under the given prefix. Returns
	// the number of objects deleted (best-effort) and any error. A nil
	// implementation makes the service skip S3 cleanup.
	DeletePrefix(ctx context.Context, prefix string) (int, error)
}

// OAuthRevoker revokes the user's tokens at the upstream OAuth provider.
type OAuthRevoker interface {
	RevokeUserTokens(ctx context.Context, userID string) error
}

// GDPRMailer delivers lifecycle emails for account erasure (request, cancel,
// finalize). Production wiring uses the notification service → SendGrid path
// (see cmd/server/gdpr_mailer.go). Implementations MUST never panic.
//
// Email failures MUST NOT fail the deletion lifecycle itself (the legal act is
// recording the request / cascade), but they MUST be loud: never log as
// success when nothing was sent. A nil mailer on Erasure is treated as
// "not configured" and emits slog.Error.
type GDPRMailer interface {
	SendDeletionRequested(ctx context.Context, userID, email string, graceDeadline time.Time) error
	SendDeletionCancelled(ctx context.Context, userID, email string) error
	SendDeletionFinalized(ctx context.Context, userID, email string) error
}

// noopStripeDeleter is the safe default when the user service has no Stripe
// client wired (e.g. dev). Every call is recorded as skipped.
type noopStripeDeleter struct{}

func (noopStripeDeleter) DeleteCustomer(_ context.Context, _ string) (string, error) {
	return "skipped_no_client", nil
}
func (noopStripeDeleter) DeleteConnectAccount(_ context.Context, _ string) (string, error) {
	return "skipped_no_client", nil
}

// Erasure implements the GDPR/CCPA right-to-erasure lifecycle.
//
// The lifecycle is intentionally three steps:
//
//  1. RequestAccountDeletion — sets users.deletion_requested_at, sends a
//     confirmation email, returns the grace deadline.
//  2. CancelAccountDeletion — clears the request within the grace window.
//  3. FinalizeAccountDeletion — performs the cascade. Called either by the
//     cron worker after the grace window or by an admin override.
//
// All three are idempotent: requesting twice returns
// ErrDeletionAlreadyRequested, finalizing twice returns
// ErrDeletionAlreadyFinalized, cancelling when no request exists returns
// ErrDeletionNotRequested.
type Erasure struct {
	repo   domain.UserRepository
	stripe StripeDeleter
	store  ObjectStoreDeleter
	oauth  OAuthRevoker
	mailer GDPRMailer
	now    func() time.Time // injectable for tests
}

// NewErasure constructs the lifecycle service. Pass nil for optional
// dependencies (stripe/store/oauth/mailer) — the service will skip those
// steps instead of failing. A nil mailer is never silent success: request/
// cancel/finalize log Error when confirmation email cannot be sent.
func NewErasure(repo domain.UserRepository, stripe StripeDeleter, store ObjectStoreDeleter, oauth OAuthRevoker, mailer GDPRMailer) *Erasure {
	if stripe == nil {
		stripe = noopStripeDeleter{}
	}
	return &Erasure{
		repo:   repo,
		stripe: stripe,
		store:  store,
		oauth:  oauth,
		mailer: mailer,
		now:    time.Now,
	}
}

// withClock returns a copy with the now function replaced (test helper).
func (e *Erasure) withClock(now func() time.Time) *Erasure {
	cp := *e
	cp.now = now
	return &cp
}

// RequestAccountDeletion records a self-service erasure request and returns
// the grace deadline. Re-requesting while already pending is a no-op
// (returned `created` is false but grace_deadline is populated).
func (e *Erasure) RequestAccountDeletion(ctx context.Context, userID, reason, confirmation string) (deadline time.Time, created bool, err error) {
	if userID == "" {
		return time.Time{}, false, fmt.Errorf("request deletion: user_id is required")
	}
	if !strings.EqualFold(strings.TrimSpace(confirmation), domain.DeletionConfirmationPhrase) {
		return time.Time{}, false, fmt.Errorf("request deletion: %w", domain.ErrDeletionConfirmation)
	}

	requestedAt := e.now().UTC()
	graceDeadline := requestedAt.Add(domain.DeletionGracePeriod)
	err = e.repo.MarkDeletionRequested(ctx, userID, reason, requestedAt)
	switch {
	case err == nil:
		// Newly recorded request. Confirm by email so the user has a path
		// back to Account settings to cancel within the grace window.
		// Email failure is logged loudly but does not roll back the request
		// (the legal act is the DB write; mail is notification).
		e.sendLifecycleEmail(ctx, "deletion_requested", userID, func(email string) error {
			return e.mailer.SendDeletionRequested(ctx, userID, email, graceDeadline)
		})
		slog.Info("gdpr: deletion request received",
			"user_id", userID,
			"requested_at", requestedAt,
			"grace_deadline", graceDeadline,
			"reason", reason,
		)
		return graceDeadline, true, nil

	case errors.Is(err, domain.ErrDeletionAlreadyRequested):
		// Idempotent: re-fetch the existing timestamp so the caller still
		// gets a valid grace deadline to display. No second email — the
		// original confirmation already went out.
		existing, _, stateErr := e.repo.GetUserDeletionState(ctx, userID)
		if stateErr != nil {
			return time.Time{}, false, fmt.Errorf("request deletion: re-read state: %w", stateErr)
		}
		if existing == nil {
			return time.Time{}, false, fmt.Errorf("request deletion: inconsistent state, no timestamp despite already-requested")
		}
		return existing.Add(domain.DeletionGracePeriod), false, nil

	default:
		return time.Time{}, false, fmt.Errorf("request deletion: %w", err)
	}
}

// CancelAccountDeletion clears a pending request within the grace window.
func (e *Erasure) CancelAccountDeletion(ctx context.Context, userID string) (cancelled bool, err error) {
	if userID == "" {
		return false, fmt.Errorf("cancel deletion: user_id is required")
	}
	err = e.repo.ClearDeletionRequest(ctx, userID)
	switch {
	case err == nil:
		e.sendLifecycleEmail(ctx, "deletion_cancelled", userID, func(email string) error {
			return e.mailer.SendDeletionCancelled(ctx, userID, email)
		})
		slog.Info("gdpr: deletion request cancelled",
			"user_id", userID,
		)
		return true, nil
	case errors.Is(err, domain.ErrDeletionNotRequested):
		return false, nil
	default:
		return false, fmt.Errorf("cancel deletion: %w", err)
	}
}

// FinalizeAccountDeletion performs the actual erasure. Returns the per-table
// counts and Stripe/S3 outcomes for the audit log. Idempotent.
//
// `force=true` skips the grace-window check (for admin override). When the
// cron worker calls this it MUST set force=false so users can still cancel
// during the grace period.
func (e *Erasure) FinalizeAccountDeletion(ctx context.Context, userID string, force bool) (*domain.FinalizeOutcome, error) {
	if userID == "" {
		return nil, fmt.Errorf("finalize deletion: user_id is required")
	}

	requested, finalized, err := e.repo.GetUserDeletionState(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("finalize deletion: read state: %w", err)
	}
	if finalized != nil {
		return nil, fmt.Errorf("finalize deletion: %w", domain.ErrDeletionAlreadyFinalized)
	}

	if !force {
		if requested == nil {
			return nil, fmt.Errorf("finalize deletion: %w", domain.ErrDeletionNotRequested)
		}
		if e.now().UTC().Before(requested.Add(domain.DeletionGracePeriod)) {
			return nil, fmt.Errorf("finalize deletion: %w", domain.ErrDeletionGracePeriodActive)
		}
	}

	// Capture the real email BEFORE the cascade anonymizes it to
	// deleted-{uuid}@deleted.local — the post-cascade confirmation email
	// needs the pre-wipe address.
	preWipeEmail, emailLookupErr := e.lookupUserEmail(ctx, userID)
	if emailLookupErr != nil {
		// Not fatal — cascade still runs. sendLifecycleEmail will also
		// surface the miss if we re-lookup; with a pre-captured string we
		// can still attempt delivery below.
		slog.Error("gdpr: cannot resolve email before finalize",
			"user_id", userID,
			"error", emailLookupErr,
		)
	}

	// Read pending row info BEFORE the cascade — once finalize runs, the
	// stripe IDs will still be on the row (subscriptions/provider_profiles
	// are KEEP-with-redacted, not DELETE) but doing this up-front keeps the
	// transaction time short.
	pending, err := e.lookupStripeIDs(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("finalize deletion: lookup stripe ids: %w", err)
	}

	counts, err := e.repo.FinalizeAccountDeletion(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("finalize deletion: cascade: %w", err)
	}

	// Side effects after the DB cascade. None of these gate the cascade —
	// failure is logged but doesn't roll back the wipe (re-running them is
	// the operator's job; the in-DB rows are already anonymized).
	customerOutcome := "skipped_no_id"
	if pending.StripeCustomerID != "" {
		out, sErr := e.stripe.DeleteCustomer(ctx, pending.StripeCustomerID)
		if sErr != nil {
			customerOutcome = "error: " + sErr.Error()
			slog.Error("gdpr: stripe customer delete failed",
				"user_id", userID,
				"customer_id", pending.StripeCustomerID,
				"error", sErr,
			)
		} else {
			customerOutcome = out
		}
	}

	accountOutcome := "skipped_no_id"
	if pending.StripeAccountID != "" {
		out, sErr := e.stripe.DeleteConnectAccount(ctx, pending.StripeAccountID)
		if sErr != nil {
			accountOutcome = "error: " + sErr.Error()
			slog.Error("gdpr: stripe connect account delete failed",
				"user_id", userID,
				"account_id", pending.StripeAccountID,
				"error", sErr,
			)
		} else {
			accountOutcome = out
		}
	}

	if e.store != nil {
		prefix := fmt.Sprintf("users/%s/", userID)
		if n, sErr := e.store.DeletePrefix(ctx, prefix); sErr != nil {
			slog.Error("gdpr: s3 prefix delete failed",
				"user_id", userID,
				"prefix", prefix,
				"error", sErr,
			)
		} else {
			counts["s3_objects"] = int64(n)
		}
	}

	if e.oauth != nil {
		if oErr := e.oauth.RevokeUserTokens(ctx, userID); oErr != nil {
			slog.Warn("gdpr: oauth revoke failed",
				"user_id", userID,
				"error", oErr,
			)
		}
	}

	// Post-cascade confirmation — use the pre-wipe email. Do not re-read
	// the user row; it is now anonymized.
	e.sendLifecycleEmailWithAddress(ctx, "deletion_finalized", userID, preWipeEmail, func(email string) error {
		return e.mailer.SendDeletionFinalized(ctx, userID, email)
	})

	finalizedAt := e.now().UTC()
	slog.Info("gdpr: account finalized",
		"user_id", userID,
		"force", force,
		"counts", counts,
		"stripe_customer_outcome", customerOutcome,
		"stripe_account_outcome", accountOutcome,
	)

	return &domain.FinalizeOutcome{
		UserID:                userID,
		FinalizedAt:           finalizedAt,
		Counts:                counts,
		StripeCustomerOutcome: customerOutcome,
		StripeAccountOutcome:  accountOutcome,
	}, nil
}

// stripeIDs holds the IDs we need to call out to Stripe with.
type stripeIDs struct {
	StripeCustomerID string
	StripeAccountID  string
}

// lookupStripeIDs loads a user's stripe identifiers prior to running the
// cascade. Implemented via ListPendingFinalizations with a single-user
// filter so we can re-use the existing query — but because that query
// requires a request to be older than `olderThan`, we widen the filter to
// "now+1m" so it always matches.
func (e *Erasure) lookupStripeIDs(ctx context.Context, userID string) (stripeIDs, error) {
	rows, err := e.repo.ListPendingFinalizations(ctx, e.now().UTC().Add(time.Minute), 1000)
	if err != nil {
		return stripeIDs{}, err
	}
	for _, p := range rows {
		if p.UserID == userID {
			return stripeIDs{StripeCustomerID: p.StripeCustomerID, StripeAccountID: p.StripeAccountID}, nil
		}
	}
	// User isn't in the pending list (admin force on a fresh request, or no
	// stripe IDs). Return zeros — outcome will be "skipped_no_id".
	return stripeIDs{}, nil
}

// ProcessPendingFinalizations is the cron entrypoint. Pulls a batch of
// users whose grace window has elapsed and runs FinalizeAccountDeletion on
// each. Continues past per-user errors so one bad row doesn't stall the
// whole batch.
func (e *Erasure) ProcessPendingFinalizations(ctx context.Context, batchSize int) (processed, failed int, err error) {
	cutoff := e.now().UTC().Add(-domain.DeletionGracePeriod)
	pending, err := e.repo.ListPendingFinalizations(ctx, cutoff, batchSize)
	if err != nil {
		return 0, 0, fmt.Errorf("process pending: list: %w", err)
	}

	for _, p := range pending {
		if _, finErr := e.FinalizeAccountDeletion(ctx, p.UserID, false); finErr != nil {
			slog.Error("gdpr: finalize failed for pending user",
				"user_id", p.UserID,
				"requested_at", p.DeletionRequestedAt,
				"error", finErr,
			)
			failed++
			continue
		}
		processed++
	}

	return processed, failed, nil
}

// sendLifecycleEmail resolves the user's email and hands it to sendFn when a
// mailer is configured. Always honest: never logs success when nothing was
// sent. Does not return errors to the caller — email is best-effort relative
// to the legal deletion act, but failures are Error-level for ops.
func (e *Erasure) sendLifecycleEmail(ctx context.Context, event, userID string, sendFn func(email string) error) {
	if e.mailer == nil {
		slog.Error("gdpr: lifecycle email not sent — mailer not configured",
			"event", event,
			"user_id", userID,
		)
		return
	}
	email, err := e.lookupUserEmail(ctx, userID)
	if err != nil {
		slog.Error("gdpr: lifecycle email not sent — cannot resolve email",
			"event", event,
			"user_id", userID,
			"error", err,
		)
		return
	}
	e.sendLifecycleEmailWithAddress(ctx, event, userID, email, sendFn)
}

// sendLifecycleEmailWithAddress is the shared delivery path once an email
// address is known (or known-missing). Used by request/cancel (fresh lookup)
// and finalize (pre-cascade capture).
func (e *Erasure) sendLifecycleEmailWithAddress(ctx context.Context, event, userID, email string, sendFn func(email string) error) {
	if e.mailer == nil {
		slog.Error("gdpr: lifecycle email not sent — mailer not configured",
			"event", event,
			"user_id", userID,
		)
		return
	}
	if strings.TrimSpace(email) == "" {
		slog.Error("gdpr: lifecycle email not sent — empty email address",
			"event", event,
			"user_id", userID,
		)
		return
	}
	if err := sendFn(email); err != nil {
		slog.Error("gdpr: lifecycle email failed",
			"event", event,
			"user_id", userID,
			"error", err,
		)
		return
	}
	slog.Info("gdpr: lifecycle email sent",
		"event", event,
		"user_id", userID,
	)
}

// lookupUserEmail loads the current email for a user. Empty email is an error
// so callers never treat a missing address as a successful send.
func (e *Erasure) lookupUserEmail(ctx context.Context, userID string) (string, error) {
	user, err := e.repo.GetUserByID(ctx, userID)
	if err != nil {
		return "", err
	}
	if user == nil {
		return "", fmt.Errorf("%w", domain.ErrUserNotFound)
	}
	if strings.TrimSpace(user.Email) == "" {
		return "", fmt.Errorf("user %s has empty email", userID)
	}
	return user.Email, nil
}
