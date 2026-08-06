package handler

// GDPR Art. 15 / CCPA right-to-access — self-service "download my data".
//
// Route: GET /api/v1/users/me/export
//
// Returns a single, bounded JSON document containing the personal data the
// platform holds about the AUTHENTICATED user. It is the read-side mirror of
// the erasure cascade in services/user/internal/repository/gdpr.go: the same
// table set, the same PII-redaction philosophy, but for export instead of
// deletion.
//
// ── Owner-scoping / IDOR (the whole point) ──────────────────────────────────
// Every query is keyed ONLY off claims.UserID, taken from the verified JWT in
// the request context — never from a URL param, query string, or body. There
// is no {id} on this route, so a caller can only ever export THEIR OWN data.
// Shared records (chat messages, contracts, jobs the user owns) deliberately
// redact the counterparty to a display name + role; we never leak another
// user's email, phone, address, or internal IDs through someone else's export.
//
// ── What is intentionally NOT included ──────────────────────────────────────
//   - password_hash, mfa_secret, mfa_backup_codes (security secrets)
//   - internal moderation/fraud flags, trust-score internals, suspension notes
//   - other parties' PII inside shared records (redacted to display_name + role)
//
// PII-at-rest fields (phone, addresses, EIN/TIN, insurance policy number) ARE
// decrypted/returned here because the requester is the data subject — that's
// exactly the access right being served. Those columns hold base64
// nacl/secretbox ciphertext on disk (migrations 031/033); returning the column
// verbatim would hand the user unreadable base64 and silently fail Art. 15.
//
// Mixed state is expected and handled per value, not per row (see decryptPII):
// a legacy row written before the backfill holds plaintext, a backfilled row
// holds ciphertext, and — because pii_encrypted_v1 is a ROW flag over
// per-COLUMN encryption — a single row can hold one of each. A value that is
// not our wire format passes through untouched; a value that IS our wire
// format but will not open under any configured key is reported as an
// unavailable field rather than dumped as base64.
//
// ── Size / DoS bound ────────────────────────────────────────────────────────
// Each collection is capped (exportSectionCap). When a section hits the cap we
// emit a "_truncated": true marker beside it so the export is honestly partial
// rather than silently lossy, and the user can request a full archive from
// support. This keeps the single-shot response bounded (a few MB worst case)
// so a heavy account can't OOM the gateway.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// exportSectionCap bounds each collection in a single export. 5000 rows of any
// one entity is far beyond a normal account yet keeps the JSON body bounded so
// the gateway can serialize it in one shot without risking OOM. A section that
// hits the cap is flagged "_truncated" so the export is honestly partial.
const exportSectionCap = 5000

// piiUnavailable is what an encrypted field becomes when no configured key can
// open it. Emitting this instead of the raw column keeps the export honest: the
// user learns the field exists and could not be rendered, and support/ops get a
// signal, rather than the user receiving base64 they cannot use.
const piiUnavailable = "[unavailable: encrypted with a key this server does not hold — contact support]"

// DataExportHandler serves the authenticated user's personal-data export.
type DataExportHandler struct {
	db     *pgxpool.Pool
	cipher *crypto.Cipher
}

// NewDataExportHandler creates a new handler. db is the gateway pool; if nil
// the endpoint degrades to 503 like the rest of the DB-backed surface.
//
// cipher is variadic purely so the existing single-argument call site keeps
// compiling; callers SHOULD pass the gateway's shared piiCipher (the same one
// handed to NewEmployeesHandler) so this handler decrypts under exactly the
// process-wide key. When it is omitted we fall back to crypto.FromEnv(), which
// reads the same ENCRYPTION_KEY / ENCRYPTION_KEY_PREVIOUS and therefore yields
// an identical cipher in every environment where the key is set — i.e.
// everywhere but development, where FromEnv mints an ephemeral key and rows
// written under the process cipher will not open. That divergence is dev-only
// and is WARN-logged.
func NewDataExportHandler(db *pgxpool.Pool, cipher ...*crypto.Cipher) *DataExportHandler {
	h := &DataExportHandler{db: db}
	if len(cipher) > 0 && cipher[0] != nil {
		h.cipher = cipher[0]
		return h
	}
	c, err := crypto.FromEnv()
	if err != nil {
		// Outside development FromEnv fails closed on a missing key. Leave the
		// cipher nil: encrypted fields become piiUnavailable rather than raw
		// ciphertext, and the rest of the export still serves.
		slog.Error("data export: no PII cipher; encrypted fields will be reported unavailable", "error", err)
		return h
	}
	slog.Warn("data export: constructed its own cipher from env; pass the shared piiCipher to NewDataExportHandler for guaranteed key parity")
	h.cipher = c
	return h
}

// decryptPII renders one PII-at-rest column for the export. It is the read-side
// mirror of crypto.Cipher.EncryptString and deliberately never returns raw
// ciphertext.
//
// Three outcomes:
//
//	nil / ""                         → nil (absent field)
//	opens under primary or previous  → the plaintext
//	not our wire format              → the value unchanged (legacy plaintext row)
//	our wire format, will not open   → piiUnavailable
//
// The "not our wire format" branch is what makes the mixed legacy/backfilled
// state safe: it is decided per VALUE, so it stays correct even on a row whose
// pii_encrypted_v1 flag says TRUE because some *other* column on it was
// encrypted. crypto.ErrDecryptFailed is only returned after the structural
// (base64 + >= NonceSize+Overhead bytes) gate has already passed, so
// errors.Is(err, ErrDecryptFailed) is exactly "secretbox-shaped but unopenable".
func (h *DataExportHandler) decryptPII(v *string) interface{} {
	if v == nil || *v == "" {
		return derefStr(v)
	}
	if h.cipher == nil {
		// No key at all. We cannot tell ciphertext from plaintext safely, and
		// emitting a possible ciphertext is the bug being fixed — withhold.
		return piiUnavailable
	}
	plain, err := h.cipher.DecryptString(*v)
	switch {
	case err == nil:
		return plain
	case errors.Is(err, crypto.ErrDecryptFailed):
		slog.Error("data export: PII value is secretbox-shaped but no configured key opens it")
		return piiUnavailable
	default:
		// Not base64, or too short to be secretbox output: a legacy plaintext
		// value written before the column was encrypted. Pass it through.
		return *v
	}
}

// ExportMyData handles GET /api/v1/users/me/export.
//
// Owner-scoping guarantee: userID is read from the verified JWT claims only.
// There is no path/query/body input that can redirect the export at another
// user — every query below filters on this single userID.
func (h *DataExportHandler) ExportMyData(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	userID := claims.UserID

	ctx := r.Context()

	export := map[string]interface{}{
		"export_metadata": map[string]interface{}{
			"user_id":      userID,
			"generated_at": time.Now().UTC().Format(time.RFC3339),
			"format":       "nomarkup.data-export.v1",
			"notice": "This file contains the personal data NoMarkup holds about your account " +
				"(GDPR Art. 15 / CCPA right to access). Other people's private details inside " +
				"shared records (messages, contracts, jobs) are redacted to a display name. " +
				"Security secrets (password, 2FA secrets) are never included. Long histories " +
				"may be truncated — sections that were capped are flagged with \"_truncated\".",
			"section_cap": exportSectionCap,
		},
	}

	// Each section is independent and owner-scoped. A failure in one section is
	// logged and surfaced as an "_error" marker rather than failing the whole
	// export — a user with a corrupt row in one table should still get the rest
	// of their data. The first hard error (e.g. DB down) still 500s up front via
	// the profile section, which we treat as load-bearing.
	profile, err := h.exportProfile(ctx, userID)
	if err != nil {
		slog.Error("data export: profile", "user_id", userID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to build export")
		return
	}
	export["profile"] = profile

	sections := []struct {
		name string
		fn   func(context.Context, string) (interface{}, bool, error)
	}{
		{"provider_profile", h.exportProviderProfile},
		{"jobs", h.exportJobs},
		{"bids", h.exportBids},
		{"contracts", h.exportContracts},
		{"listings", h.exportListings},
		{"listing_bids", h.exportListingBids},
		{"listing_offers", h.exportListingOffers},
		{"listing_orders", h.exportListingOrders},
		{"payments", h.exportPayments},
		{"instant_payouts", h.exportInstantPayouts},
		{"working_capital_advances", h.exportAdvances},
		{"reviews_written", h.exportReviewsWritten},
		{"messages_sent", h.exportMessagesSent},
		{"notifications", h.exportNotifications},
		{"wishlist_items", h.exportWishlist},
		{"watchlist", h.exportWatchlist},
		{"saved_searches", h.exportSavedSearches},
		{"followed_sellers", h.exportFollows},
		{"referrals", h.exportReferrals},
	}

	for _, s := range sections {
		rows, truncated, secErr := s.fn(ctx, userID)
		if secErr != nil {
			slog.Error("data export: section failed", "user_id", userID, "section", s.name, "error", secErr)
			export[s.name] = map[string]interface{}{"_error": "this section could not be exported; contact support"}
			continue
		}
		if truncated {
			export[s.name] = map[string]interface{}{"_truncated": true, "items": rows}
		} else {
			export[s.name] = rows
		}
	}

	filename := fmt.Sprintf("nomarkup-data-export-%s.json", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	// Never cache a per-user PII export at the browser or any shared cache.
	w.Header().Set("Cache-Control", "no-store, private")
	writeJSON(w, http.StatusOK, export)
}

// exportProfile returns the user's own account/profile row. Security secrets
// (password_hash, mfa_secret/backup codes) and internal moderation fields
// (suspension_reason) are deliberately omitted.
func (h *DataExportHandler) exportProfile(ctx context.Context, userID string) (map[string]interface{}, error) {
	var (
		id, email, displayName            string
		phone, avatarURL, timezone        *string
		emailVerified, phoneVerified       bool
		mfaEnabled                         bool
		roles                              []string
		status                             string
		lastLoginAt, lastActiveAt          *time.Time
		createdAt                          time.Time
		updatedAt                          *time.Time
		deletionRequestedAt                *time.Time
	)
	err := h.db.QueryRow(ctx, `
		SELECT id::text, email, email_verified, phone, phone_verified,
		       display_name, avatar_url, roles, status, mfa_enabled,
		       timezone, last_login_at, last_active_at,
		       created_at, updated_at, deletion_requested_at
		  FROM users
		 WHERE id = $1`, userID).Scan(
		&id, &email, &emailVerified, &phone, &phoneVerified,
		&displayName, &avatarURL, &roles, &status, &mfaEnabled,
		&timezone, &lastLoginAt, &lastActiveAt,
		&createdAt, &updatedAt, &deletionRequestedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("query profile: %w", err)
	}
	return map[string]interface{}{
		"id":                    id,
		"email":                 email,
		"email_verified":        emailVerified,
		"phone":                 h.decryptPII(phone), // secretbox ciphertext on disk (031)
		"phone_verified":        phoneVerified,
		"display_name":          displayName,
		"avatar_url":            derefStr(avatarURL),
		"roles":                 roles,
		"status":                status,
		"mfa_enabled":           mfaEnabled,
		"timezone":              derefStr(timezone),
		"last_login_at":         fmtTimePtr(lastLoginAt),
		"last_active_at":        fmtTimePtr(lastActiveAt),
		"created_at":            createdAt.UTC().Format(time.RFC3339),
		"updated_at":            fmtTimePtr(updatedAt),
		"deletion_requested_at": fmtTimePtr(deletionRequestedAt),
	}, nil
}

// exportProviderProfile returns the user's provider profile (incl. their own
// PII-at-rest business fields). Returns an empty object when the user is not a
// provider. EIN/TIN and insurance policy number are the subject's own PII so
// they ARE included.
func (h *DataExportHandler) exportProviderProfile(ctx context.Context, userID string) (interface{}, bool, error) {
	// business_name, bio, service_address, ein_tin, insurance_* are all nullable
	// TEXT (001 / 012). Scanning any of them into a plain string soft-fails the
	// whole provider_profile section when the dual-role seed (or a partial
	// onboarding row) leaves them NULL — residual from evening red-team 2026-08-05.
	var (
		id                             string
		businessName                   *string
		bio, serviceAddress            *string
		einTin, insProvider, insPolicy *string
		jobsCompleted                  int
		createdAt                      time.Time
	)
	err := h.db.QueryRow(ctx, `
		SELECT id::text, business_name, bio, service_address,
		       ein_tin, insurance_provider, insurance_policy_number,
		       jobs_completed, created_at
		  FROM provider_profiles
		 WHERE user_id = $1`, userID).Scan(
		&id, &businessName, &bio, &serviceAddress,
		&einTin, &insProvider, &insPolicy, &jobsCompleted, &createdAt,
	)
	if err != nil {
		// No provider profile is the common case for customer-only accounts.
		if errors.Is(err, pgx.ErrNoRows) {
			return map[string]interface{}{}, false, nil
		}
		return nil, false, fmt.Errorf("query provider profile: %w", err)
	}
	return map[string]interface{}{
		"id":                      id,
		"business_name":           derefStr(businessName),
		"bio":                     derefStr(bio),
		"service_address":         h.decryptPII(serviceAddress),
		"ein_tin":                 h.decryptPII(einTin),
		"insurance_provider":      derefStr(insProvider), // NOT encrypted: a carrier name, not personal data
		"insurance_policy_number": h.decryptPII(insPolicy),
		"jobs_completed":          jobsCompleted,
		"created_at":              createdAt.UTC().Format(time.RFC3339),
	}, false, nil
}

// exportJobs returns jobs the user posted as a customer.
func (h *DataExportHandler) exportJobs(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT id::text, title, description, status,
		       service_city, service_state, service_zip,
		       starting_bid_cents, bid_count, created_at
		  FROM jobs
		 WHERE customer_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, title, status            string
			description                  *string
			city, state, zip             *string
			startingBidCents             *int64
			bidCount                     int
			createdAt                    time.Time
		)
		if err := rows.Scan(&id, &title, &description, &status, &city, &state, &zip, &startingBidCents, &bidCount, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":                 id,
			"title":              title,
			"description":        derefStr(description),
			"status":             status,
			"service_city":       derefStr(city),
			"service_state":      derefStr(state),
			"service_zip":        derefStr(zip),
			"starting_bid_cents": derefInt(startingBidCents),
			"bid_count":          bidCount,
			"created_at":         createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportBids returns bids the user placed as a provider.
func (h *DataExportHandler) exportBids(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT b.id::text, b.job_id::text, j.title, b.amount_cents,
		       b.status, b.created_at
		  FROM bids b
		  LEFT JOIN jobs j ON j.id = b.job_id
		 WHERE b.provider_id = $1
		 ORDER BY b.created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, jobID, status string
			jobTitle          *string
			amountCents       int64
			createdAt         time.Time
		)
		if err := rows.Scan(&id, &jobID, &jobTitle, &amountCents, &status, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":           id,
			"job_id":       jobID,
			"job_title":    derefStr(jobTitle),
			"amount_cents": amountCents,
			"status":       status,
			"created_at":   createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportContracts returns contracts the user is a party to (as customer OR
// provider). The COUNTERPARTY is redacted to display name + role — we never
// leak the other party's email/phone through this user's export.
func (h *DataExportHandler) exportContracts(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT c.id::text, c.contract_number, c.status, c.amount_cents,
		       c.created_at,
		       CASE WHEN c.customer_id = $1 THEN 'customer' ELSE 'provider' END AS my_role,
		       COALESCE(cp.display_name, 'NoMarkup user') AS counterparty_name
		  FROM contracts c
		  LEFT JOIN users cp
		         ON cp.id = CASE WHEN c.customer_id = $1 THEN c.provider_id ELSE c.customer_id END
		 WHERE c.customer_id = $1 OR c.provider_id = $1
		 ORDER BY c.created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, contractNumber, status, myRole, counterparty string
			amountCents                                       int64
			createdAt                                         time.Time
		)
		if err := rows.Scan(&id, &contractNumber, &status, &amountCents, &createdAt, &myRole, &counterparty); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":                 id,
			"contract_number":    contractNumber,
			"status":             status,
			"amount_cents":       amountCents,
			"my_role":            myRole,
			"counterparty_name":  counterparty, // redacted: display name only
			"created_at":         createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportListings returns marketplace items the user listed as a seller.
func (h *DataExportHandler) exportListings(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT id::text, title, description, status,
		       starting_price_cents, current_bid_cents, pickup_zip_code, created_at
		  FROM listings
		 WHERE seller_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, title, status         string
			description, pickupZip    *string
			startingPrice             int64
			currentBid                *int64
			createdAt                 time.Time
		)
		if err := rows.Scan(&id, &title, &description, &status, &startingPrice, &currentBid, &pickupZip, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":                   id,
			"title":                title,
			"description":          derefStr(description),
			"status":               status,
			"starting_price_cents": startingPrice,
			"current_bid_cents":    derefInt(currentBid),
			"pickup_zip_code":      derefStr(pickupZip),
			"created_at":           createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportListingBids returns marketplace bids the user placed as a buyer.
// ip_address and fingerprint are anti-fraud telemetry, not user-facing PII the
// access right requires — omitted.
func (h *DataExportHandler) exportListingBids(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT lb.id::text, lb.listing_id::text, l.title, lb.amount_cents,
		       lb.status, lb.created_at
		  FROM listing_bids lb
		  LEFT JOIN listings l ON l.id = lb.listing_id
		 WHERE lb.bidder_id = $1
		 ORDER BY lb.created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, listingID, status string
			title                 *string
			amountCents           int64
			createdAt             time.Time
		)
		if err := rows.Scan(&id, &listingID, &title, &amountCents, &status, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":            id,
			"listing_id":    listingID,
			"listing_title": derefStr(title),
			"amount_cents":  amountCents,
			"status":        status,
			"created_at":    createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportListingOffers returns marketplace offers the user made as a buyer.
func (h *DataExportHandler) exportListingOffers(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT lo.id::text, lo.listing_id::text, l.title, lo.amount_cents,
		       lo.status, lo.message, lo.created_at
		  FROM listing_offers lo
		  LEFT JOIN listings l ON l.id = lo.listing_id
		 WHERE lo.buyer_id = $1
		 ORDER BY lo.created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, listingID, status string
			title, message        *string
			amountCents           int64
			createdAt             time.Time
		)
		if err := rows.Scan(&id, &listingID, &title, &amountCents, &status, &message, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":            id,
			"listing_id":    listingID,
			"listing_title": derefStr(title),
			"amount_cents":  amountCents,
			"status":        status,
			"message":       derefStr(message),
			"created_at":    createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportListingOrders returns marketplace orders where the user is buyer OR
// seller. The counterparty is redacted to a display name; pickup codes and
// handoff/selfie photo URLs (other-party-linked verification artifacts) are
// omitted.
func (h *DataExportHandler) exportListingOrders(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT o.id::text, o.listing_id::text, l.title,
		       o.amount_cents, o.escrow_status, o.created_at,
		       CASE WHEN o.seller_id = $1 THEN 'seller' ELSE 'buyer' END AS my_role,
		       COALESCE(cp.display_name, 'NoMarkup user') AS counterparty_name
		  FROM listing_orders o
		  LEFT JOIN listings l ON l.id = o.listing_id
		  LEFT JOIN users cp
		         ON cp.id = CASE WHEN o.seller_id = $1 THEN o.buyer_id ELSE o.seller_id END
		 WHERE o.buyer_id = $1 OR o.seller_id = $1
		 ORDER BY o.created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, listingID, escrowStatus, myRole, counterparty string
			title                                             *string
			amountCents                                       int64
			createdAt                                         time.Time
		)
		if err := rows.Scan(&id, &listingID, &title, &amountCents, &escrowStatus, &createdAt, &myRole, &counterparty); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":                id,
			"listing_id":        listingID,
			"listing_title":     derefStr(title),
			"amount_cents":      amountCents,
			"escrow_status":     escrowStatus,
			"my_role":           myRole,
			"counterparty_name": counterparty,
			"created_at":        createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportPayments returns payment records where the user is the customer OR the
// provider. Stripe internal IDs (payment_intent/charge/transfer) are omitted —
// they are platform↔Stripe correlation keys, not data the access right covers,
// and exposing them widens the attack surface.
func (h *DataExportHandler) exportPayments(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT id::text, COALESCE(contract_id::text, ''), amount_cents,
		       platform_fee_cents, provider_payout_cents, status,
		       CASE WHEN customer_id = $1 THEN 'payer' ELSE 'payee' END AS my_role,
		       created_at
		  FROM payments
		 WHERE customer_id = $1 OR provider_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, contractID, status, myRole          string
			amountCents, platformFee, providerPayout int64
			createdAt                                time.Time
		)
		if err := rows.Scan(&id, &contractID, &amountCents, &platformFee, &providerPayout, &status, &myRole, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":                    id,
			"contract_id":           contractID,
			"amount_cents":          amountCents,
			"platform_fee_cents":    platformFee,
			"provider_payout_cents": providerPayout,
			"status":                status,
			"my_role":               myRole,
			"created_at":            createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportInstantPayouts returns the user's instant-payout history (as provider).
func (h *DataExportHandler) exportInstantPayouts(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT id::text, amount_cents, fee_cents, net_cents, status, created_at
		  FROM instant_payouts
		 WHERE provider_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, status                   string
			amountCents, feeCents, net   int64
			createdAt                    time.Time
		)
		if err := rows.Scan(&id, &amountCents, &feeCents, &net, &status, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":           id,
			"amount_cents": amountCents,
			"fee_cents":    feeCents,
			"net_cents":    net,
			"status":       status,
			"created_at":   createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportAdvances returns the user's working-capital advances (as provider).
func (h *DataExportHandler) exportAdvances(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT id::text, advance_amount_cents, fee_cents, repaid_cents,
		       status, created_at
		  FROM working_capital_advances
		 WHERE provider_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, status                        string
			advanceCents, feeCents, repaidCents int64
			createdAt                         time.Time
		)
		if err := rows.Scan(&id, &advanceCents, &feeCents, &repaidCents, &status, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":                   id,
			"advance_amount_cents": advanceCents,
			"fee_cents":            feeCents,
			"repaid_cents":         repaidCents,
			"status":               status,
			"created_at":           createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportReviewsWritten returns reviews the user authored (as reviewer). The
// reviewee is redacted to a display name; we never leak their contact details.
func (h *DataExportHandler) exportReviewsWritten(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT r.id::text, r.overall_rating, r.review_text, r.status, r.created_at,
		       COALESCE(re.display_name, 'NoMarkup user') AS reviewee_name
		  FROM reviews r
		  LEFT JOIN users re ON re.id = r.reviewee_id
		 WHERE r.reviewer_id = $1
		 ORDER BY r.created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, status, revieweeName string
			overallRating            int
			reviewText               *string
			createdAt                time.Time
		)
		if err := rows.Scan(&id, &overallRating, &reviewText, &status, &createdAt, &revieweeName); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":             id,
			"overall_rating": overallRating,
			"review_text":    derefStr(reviewText),
			"status":         status,
			"reviewee_name":  revieweeName, // redacted: display name only
			"created_at":     createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportMessagesSent returns chat messages the user SENT (sender_id = me). We
// export only the user's own outbound messages — never the counterparty's
// messages, which are that other person's data. Attachment URLs are included as
// the user authored them.
func (h *DataExportHandler) exportMessagesSent(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT id::text, channel_id::text, message_type, content,
		       COALESCE(attachment_name, ''), is_deleted, created_at
		  FROM chat_messages
		 WHERE sender_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, channelID, msgType, content, attachmentName string
			isDeleted                                        bool
			createdAt                                        time.Time
		)
		if err := rows.Scan(&id, &channelID, &msgType, &content, &attachmentName, &isDeleted, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":              id,
			"channel_id":      channelID,
			"message_type":    msgType,
			"content":         content,
			"attachment_name": attachmentName,
			"is_deleted":      isDeleted,
			"created_at":      createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportNotifications returns the user's notifications.
func (h *DataExportHandler) exportNotifications(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT id::text, notification_type, title, body, read, created_at
		  FROM notifications
		 WHERE user_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, notifType, title string
			body                 *string
			read                 bool
			createdAt            time.Time
		)
		if err := rows.Scan(&id, &notifType, &title, &body, &read, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":                id,
			"notification_type": notifType,
			"title":             title,
			"body":              derefStr(body),
			"read":              read,
			"created_at":        createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportWishlist returns the user's marketplace wishlist keywords.
func (h *DataExportHandler) exportWishlist(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT id::text, keyword, max_price_cents, created_at
		  FROM wishlist_items
		 WHERE user_id = $1 AND deleted_at IS NULL
		 ORDER BY created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, keyword   string
			maxPriceCents *int64
			createdAt     time.Time
		)
		if err := rows.Scan(&id, &keyword, &maxPriceCents, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":              id,
			"keyword":         keyword,
			"max_price_cents": derefInt(maxPriceCents),
			"created_at":      createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportWatchlist returns listings the user is watching.
func (h *DataExportHandler) exportWatchlist(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT w.id::text, w.listing_id::text, l.title, w.created_at
		  FROM listing_watchlist w
		  LEFT JOIN listings l ON l.id = w.listing_id
		 WHERE w.user_id = $1
		 ORDER BY w.created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, listingID string
			title         *string
			createdAt     time.Time
		)
		if err := rows.Scan(&id, &listingID, &title, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":            id,
			"listing_id":    listingID,
			"listing_title": derefStr(title),
			"created_at":    createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportSavedSearches returns the user's saved searches / alerts.
func (h *DataExportHandler) exportSavedSearches(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT id::text, name, query_json, alert_frequency, created_at
		  FROM saved_searches
		 WHERE user_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, name, alertFreq string
			queryJSON           *string
			createdAt           time.Time
		)
		if err := rows.Scan(&id, &name, &queryJSON, &alertFreq, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":              id,
			"name":            name,
			"query_json":      derefStr(queryJSON),
			"alert_frequency": alertFreq,
			"created_at":      createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportFollows returns sellers the user follows. The followed seller is
// redacted to a display name.
func (h *DataExportHandler) exportFollows(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT f.id::text, COALESCE(s.display_name, 'NoMarkup user') AS seller_name,
		       f.created_at
		  FROM seller_follows f
		  LEFT JOIN users s ON s.id = f.seller_id
		 WHERE f.follower_id = $1
		 ORDER BY f.created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, sellerName string
			createdAt      time.Time
		)
		if err := rows.Scan(&id, &sellerName, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":          id,
			"seller_name": sellerName, // redacted: display name only
			"created_at":  createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// exportReferrals returns referrals the user initiated (as referrer). The
// referred user is redacted to a display name; device fingerprints (anti-fraud
// telemetry) are omitted.
func (h *DataExportHandler) exportReferrals(ctx context.Context, userID string) (interface{}, bool, error) {
	return h.queryRows(ctx, `
		SELECT r.id::text, r.referral_code, r.referral_type, r.status,
		       COALESCE(ru.display_name, '') AS referred_name,
		       r.referrer_credit_cents, r.created_at
		  FROM referrals r
		  LEFT JOIN users ru ON ru.id = r.referred_id
		 WHERE r.referrer_id = $1
		 ORDER BY r.created_at DESC
		 LIMIT $2`, userID, func(rows scanner) (map[string]interface{}, error) {
		var (
			id, code, refType, status, referredName string
			creditCents                             *int64
			createdAt                               time.Time
		)
		if err := rows.Scan(&id, &code, &refType, &status, &referredName, &creditCents, &createdAt); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"id":                    id,
			"referral_code":         code,
			"referral_type":         refType,
			"status":                status,
			"referred_name":         referredName, // redacted: display name only
			"referrer_credit_cents": derefInt(creditCents),
			"created_at":            createdAt.UTC().Format(time.RFC3339),
		}, nil
	})
}

// ── shared query helper ─────────────────────────────────────────────────────

// scanner is the subset of pgx.Rows used by per-row mappers — keeps the mapper
// closures decoupled from the concrete pgx type.
type scanner interface {
	Scan(dest ...any) error
}

// queryRows runs an owner-scoped query (which MUST take userID as $1 and the
// row cap as $2) and maps each row via mapRow. It fetches exportSectionCap+1
// rows so it can flag truncation without an extra COUNT. Returns (items,
// truncated, error).
func (h *DataExportHandler) queryRows(
	ctx context.Context,
	query string,
	userID string,
	mapRow func(scanner) (map[string]interface{}, error),
) (interface{}, bool, error) {
	rows, err := h.db.Query(ctx, query, userID, exportSectionCap+1)
	if err != nil {
		return nil, false, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	items := make([]map[string]interface{}, 0)
	truncated := false
	for rows.Next() {
		if len(items) >= exportSectionCap {
			truncated = true
			break
		}
		item, mapErr := mapRow(rows)
		if mapErr != nil {
			return nil, false, fmt.Errorf("scan: %w", mapErr)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("iterate: %w", err)
	}
	return items, truncated, nil
}

// ── small helpers ───────────────────────────────────────────────────────────

func derefStr(p *string) interface{} {
	if p == nil {
		return nil
	}
	return *p
}

func derefInt(p *int64) interface{} {
	if p == nil {
		return nil
	}
	return *p
}

func fmtTimePtr(t *time.Time) interface{} {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}
