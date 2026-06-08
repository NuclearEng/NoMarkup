package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/argon2"
)

// Argon2id parameters — must match services/user/internal/service/auth.go.
const (
	argonMemory      = 65536
	argonIterations  = 3
	argonParallelism = 4
	argonSaltLength  = 16
	argonKeyLength   = 32
)

// Default password used for local dev seeding when nothing else is configured.
// This MUST only be used against an obviously-local database — the seeder
// refuses to use it if SEED_ALLOW_DEFAULT_PASSWORD is not set or the target
// looks like anything other than a local Postgres.
const defaultDevSeedPassword = "Password123!"

// Seed password for all dev accounts. Resolution order:
//  1. SEED_PASSWORD env var (always wins).
//  2. Default `Password123!` — only when SEED_ALLOW_DEFAULT_PASSWORD=true
//     OR when the DATABASE_URL points at localhost/127.0.0.1 (local dev).
//  3. One-shot random password, printed once. Used in CI / unattended runs.
//
// The 2026-04-23 audit (TODOS S1) found a literal `Password123!` had leaked
// into git history. We do NOT regress on that: the literal lives ONLY in this
// file as a documented default for the local dev loop, never as a fallback for
// shared environments.
//
// Operators must set SEED_PASSWORD when seeding shared environments
// (staging, QA, anywhere accessed by more than one human). The printed
// password should be stored in the team password manager.
func resolveSeedPassword() string {
	if p := os.Getenv("SEED_PASSWORD"); p != "" {
		return p
	}

	if isLocalDevEnv() {
		log.Printf("INFO: SEED_PASSWORD not set — using default dev password %q (local DB only).", defaultDevSeedPassword)
		log.Println("INFO: set SEED_PASSWORD to override, or unset SEED_ALLOW_DEFAULT_PASSWORD if you don't want this default.")
		return defaultDevSeedPassword
	}

	// Generate a 24-byte random password (URL-safe base64 → ~32 chars).
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		log.Fatalf("generate random seed password: %v", err)
	}
	pw := base64.RawURLEncoding.EncodeToString(buf)
	log.Println("WARNING: SEED_PASSWORD not set — using a one-shot random password.")
	log.Printf("WARNING: dev-account password is %q — store it now or re-seed.", pw)
	log.Println("WARNING: do NOT use this seeder against staging/QA without setting SEED_PASSWORD.")
	return pw
}

// isLocalDevEnv returns true when the seeder is clearly being run against a
// local development database. This is the only context where it is safe to
// fall back to the well-known `Password123!` default. Two conditions must be
// met:
//
//  1. SEED_ALLOW_DEFAULT_PASSWORD is set to a truthy value (default "true"
//     for ergonomic `make seed`, but operators can hard-disable by setting
//     it to "false").
//  2. The DATABASE_URL host resolves to localhost / 127.0.0.1 / docker host.
func isLocalDevEnv() bool {
	allow := os.Getenv("SEED_ALLOW_DEFAULT_PASSWORD")
	if allow == "" {
		allow = "true"
	}
	if allow != "true" && allow != "1" && allow != "yes" {
		return false
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		// Default DATABASE_URL is localhost (see main()), so this is local.
		return true
	}
	for _, marker := range []string{"@localhost:", "@127.0.0.1:", "@host.docker.internal:", "@postgres:"} {
		if strings.Contains(dbURL, marker) {
			return true
		}
	}
	return false
}

// Fixed UUIDs for deterministic seed data (idempotent re-runs).
const (
	adminUserID     = "00000000-0000-0000-0000-000000000001"
	customerUserID  = "00000000-0000-0000-0000-000000000002"
	providerUserID  = "00000000-0000-0000-0000-000000000003"
	provider2UserID = "00000000-0000-0000-0000-000000000004"

	propertyID = "00000000-0000-0000-0000-000000000010"

	providerProfileID  = "00000000-0000-0000-0000-000000000020"
	provider2ProfileID = "00000000-0000-0000-0000-000000000021"

	activeJobID    = "00000000-0000-0000-0000-000000000100"
	awardedJobID   = "00000000-0000-0000-0000-000000000101"
	completedJobID = "00000000-0000-0000-0000-000000000102"

	bid1ID = "00000000-0000-0000-0000-000000000200"
	bid2ID = "00000000-0000-0000-0000-000000000201"
	bid3ID = "00000000-0000-0000-0000-000000000202"
	bid4ID = "00000000-0000-0000-0000-000000000203"

	awardedContractID   = "00000000-0000-0000-0000-000000000300"
	completedContractID = "00000000-0000-0000-0000-000000000301"

	milestone1ID = "00000000-0000-0000-0000-000000000400"
	milestone2ID = "00000000-0000-0000-0000-000000000401"

	reviewID = "00000000-0000-0000-0000-000000000500"

	trustScoreID = "00000000-0000-0000-0000-000000000600"

	freeTierID          = "00000000-0000-0000-0000-000000000700"
	proCustomerTierID   = "00000000-0000-0000-0000-000000000701"
	proProviderTierID   = "00000000-0000-0000-0000-000000000702"
	adminSubscriptionID = "00000000-0000-0000-0000-000000000800"
	custSubscriptionID  = "00000000-0000-0000-0000-000000000801"
	provSubscriptionID  = "00000000-0000-0000-0000-000000000802"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://nomarkup:password@localhost:5433/nomarkup?sslmode=disable"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		log.Fatalf("connect to database: %v", err)
	}
	defer conn.Close(ctx)

	seedPassword := resolveSeedPassword()
	passwordHash, err := hashPassword(seedPassword)
	if err != nil {
		log.Fatalf("hash password: %v", err)
	}

	log.Println("Seeding database...")

	// Look up category IDs from the taxonomy seed.
	var hvacCatID, plumbingCatID, electricalCatID string
	var hvacSubcatID, plumbingSubcatID string
	var acRepairServiceID string

	err = conn.QueryRow(ctx, `SELECT id FROM service_categories WHERE slug = 'hvac' AND level = 1`).Scan(&hvacCatID)
	if err != nil {
		log.Fatalf("lookup HVAC category: %v (run migrations first: make migrate-up)", err)
	}
	err = conn.QueryRow(ctx, `SELECT id FROM service_categories WHERE slug = 'plumbing' AND level = 1`).Scan(&plumbingCatID)
	if err != nil {
		log.Fatalf("lookup Plumbing category: %v", err)
	}
	err = conn.QueryRow(ctx, `SELECT id FROM service_categories WHERE slug = 'electrical' AND level = 1`).Scan(&electricalCatID)
	if err != nil {
		log.Fatalf("lookup Electrical category: %v", err)
	}

	err = conn.QueryRow(ctx, `SELECT id FROM service_categories WHERE parent_id = $1 AND level = 2 LIMIT 1`, hvacCatID).Scan(&hvacSubcatID)
	if err != nil {
		log.Fatalf("lookup HVAC subcategory: %v", err)
	}
	err = conn.QueryRow(ctx, `SELECT id FROM service_categories WHERE parent_id = $1 AND level = 2 LIMIT 1`, plumbingCatID).Scan(&plumbingSubcatID)
	if err != nil {
		log.Fatalf("lookup Plumbing subcategory: %v", err)
	}
	err = conn.QueryRow(ctx, `SELECT id FROM service_categories WHERE parent_id = $1 AND level = 3 LIMIT 1`, hvacSubcatID).Scan(&acRepairServiceID)
	if err != nil {
		log.Fatalf("lookup AC repair service type: %v", err)
	}

	now := time.Now()
	auctionEnd := now.Add(72 * time.Hour)
	reviewWindowEnd := now.Add(14 * 24 * time.Hour)
	periodStart := now
	periodEnd := now.Add(30 * 24 * time.Hour)
	pastCompleted := now.Add(-7 * 24 * time.Hour)
	pastAwarded := now.Add(-3 * 24 * time.Hour)

	// Wrap everything in a transaction for atomicity.
	tx, err := conn.Begin(ctx)
	if err != nil {
		log.Fatalf("begin transaction: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// ── 1. Users ──────────────────────────────────────────────────

	// On conflict we DO update password_hash. Without this, re-running the
	// seeder after changing SEED_PASSWORD (or after fixing a bad earlier hash)
	// silently leaves the old hashes in place — the bug we were called to fix
	// (Bug 4: seed password mismatch). Other identity fields are kept stable.
	_, err = tx.Exec(ctx, `
		INSERT INTO users (id, email, email_verified, password_hash, display_name, roles, status, timezone, dob, dob_verified_at)
		VALUES
			($1, 'admin@nomarkup.com',    true, $5, 'Admin User',     '{admin}',    'active', 'America/Los_Angeles', DATE '1995-01-01', now()),
			($2, 'customer@nomarkup.com', true, $5, 'Jane Customer',  '{customer}', 'active', 'America/New_York',    DATE '1995-01-01', now()),
			($3, 'provider@nomarkup.com', true, $5, 'Mike Provider',  '{provider}', 'active', 'America/Chicago',     DATE '1995-01-01', now()),
			($4, 'provider2@nomarkup.com', true, $5, 'Sarah Provider', '{provider}', 'active', 'America/Denver',     DATE '1995-01-01', now())
		ON CONFLICT (id) DO UPDATE SET
			password_hash = EXCLUDED.password_hash,
			dob = COALESCE(users.dob, EXCLUDED.dob),
			dob_verified_at = COALESCE(users.dob_verified_at, EXCLUDED.dob_verified_at),
			updated_at = now()`,
		adminUserID, customerUserID, providerUserID, provider2UserID, passwordHash,
	)
	if err != nil {
		log.Fatalf("insert users: %v", err)
	}

	// ── 1b. ToS Acceptance ────────────────────────────────────────
	// Without this, demo users hit the ToS modal on first dashboard load
	// (GET /api/v1/me/tos-acceptance returns null → frontend renders the
	// blocking modal). The version is pinned to the row seeded by migration
	// 043. Idempotent via the (user_id, tos_version) UNIQUE constraint.
	_, err = tx.Exec(ctx, `
		INSERT INTO tos_acceptances (user_id, tos_version)
		VALUES ($1, '1.0'), ($2, '1.0'), ($3, '1.0'), ($4, '1.0')
		ON CONFLICT (user_id, tos_version) DO NOTHING`,
		adminUserID, customerUserID, providerUserID, provider2UserID,
	)
	if err != nil {
		log.Fatalf("insert tos acceptances: %v", err)
	}

	// ── 2. Property ───────────────────────────────────────────────

	_, err = tx.Exec(ctx, `
		INSERT INTO properties (id, user_id, nickname, address, city, state, zip_code, location, is_primary)
		VALUES ($1, $2, 'Home', '123 Main St', 'Austin', 'TX', '78701',
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326), true)
		ON CONFLICT (id) DO NOTHING`,
		propertyID, customerUserID,
	)
	if err != nil {
		log.Fatalf("insert property: %v", err)
	}

	// ── 3. Provider Profile ───────────────────────────────────────

	_, err = tx.Exec(ctx, `
		INSERT INTO provider_profiles (id, user_id, business_name, bio,
			service_address, service_location, service_radius_km,
			default_payment_timing, jobs_completed, profile_completeness)
		VALUES ($1, $2, 'Mike''s Home Services', 'Licensed and insured home service provider with 10+ years of experience in HVAC, plumbing, and electrical work.',
			'456 Service Rd, Austin, TX 78702',
			ST_SetSRID(ST_MakePoint(-97.7200, 30.2700), 4326),
			80, 'completion', 15, 85)
		ON CONFLICT (id) DO NOTHING`,
		providerProfileID, providerUserID,
	)
	if err != nil {
		log.Fatalf("insert provider profile: %v", err)
	}

	// Second provider profile.
	_, err = tx.Exec(ctx, `
		INSERT INTO provider_profiles (id, user_id, business_name, bio,
			service_address, service_location, service_radius_km,
			default_payment_timing, jobs_completed, profile_completeness)
		VALUES ($1, $2, 'Sarah''s Repairs', 'Certified HVAC and plumbing technician with 5 years of experience.',
			'789 Trade Ave, Austin, TX 78703',
			ST_SetSRID(ST_MakePoint(-97.7600, 30.2800), 4326),
			50, 'completion', 8, 70)
		ON CONFLICT (id) DO NOTHING`,
		provider2ProfileID, provider2UserID,
	)
	if err != nil {
		log.Fatalf("insert provider2 profile: %v", err)
	}

	// ── 4. Provider Service Categories ────────────────────────────

	_, err = tx.Exec(ctx, `
		INSERT INTO provider_service_categories (provider_id, category_id)
		VALUES ($1, $2), ($1, $3), ($1, $4)
		ON CONFLICT DO NOTHING`,
		providerProfileID, hvacCatID, plumbingCatID, electricalCatID,
	)
	if err != nil {
		log.Fatalf("insert provider categories: %v", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO provider_service_categories (provider_id, category_id)
		VALUES ($1, $2), ($1, $3)
		ON CONFLICT DO NOTHING`,
		provider2ProfileID, hvacCatID, plumbingCatID,
	)
	if err != nil {
		log.Fatalf("insert provider2 categories: %v", err)
	}

	// ── 5. Jobs ───────────────────────────────────────────────────

	// Active job (open for bids).
	// bid_count is intentionally omitted from the column list — the
	// bids_update_bid_count trigger (migration 029) maintains it. Hard-coding
	// it here is what caused Bug 3 (drift between jobs.bid_count and bids).
	_, err = tx.Exec(ctx, `
		INSERT INTO jobs (id, customer_id, property_id, title, description,
			category_id, subcategory_id, service_type_id,
			service_city, service_state, service_zip,
			service_location, approximate_location,
			schedule_type, starting_bid_cents, auction_duration_hours, auction_ends_at,
			status)
		VALUES ($1, $2, $3,
			'AC Unit Not Cooling Properly',
			'My central AC unit is blowing warm air. It''s a 3-ton unit installed in 2018. The filter was replaced last month. Need a professional to diagnose and repair.',
			$4, $5, $6,
			'Austin', 'TX', '78701',
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
			'flexible', 50000, 72, $7,
			'active')
		ON CONFLICT (id) DO UPDATE SET
			status = 'active',
			auction_ends_at = $7,
			awarded_provider_id = NULL,
			awarded_bid_id = NULL,
			awarded_at = NULL,
			updated_at = now()`,
		activeJobID, customerUserID, propertyID,
		hvacCatID, hvacSubcatID, acRepairServiceID,
		auctionEnd,
	)
	if err != nil {
		log.Fatalf("insert active job: %v", err)
	}

	// Awarded job (awarded_bid_id set after bids are inserted).
	// bid_count omitted — maintained by trigger (see migration 029).
	_, err = tx.Exec(ctx, `
		INSERT INTO jobs (id, customer_id, property_id, title, description,
			category_id,
			service_city, service_state, service_zip,
			service_location, approximate_location,
			schedule_type, starting_bid_cents, auction_duration_hours,
			status, awarded_provider_id, awarded_at)
		VALUES ($1, $2, $3,
			'Kitchen Sink Leaking',
			'The kitchen sink has a slow leak under the cabinet. Water pools on the floor overnight. Need repair ASAP.',
			$4,
			'Austin', 'TX', '78701',
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
			'specific_date', 30000, 72,
			'in_progress', $5, $6)
		ON CONFLICT (id) DO UPDATE SET
			status = 'in_progress',
			awarded_provider_id = $5,
			awarded_at = $6,
			updated_at = now()`,
		awardedJobID, customerUserID, propertyID,
		plumbingCatID,
		providerUserID, pastAwarded,
	)
	if err != nil {
		log.Fatalf("insert awarded job: %v", err)
	}

	// Completed job.
	// bid_count omitted — maintained by trigger (see migration 029).
	_, err = tx.Exec(ctx, `
		INSERT INTO jobs (id, customer_id, property_id, title, description,
			category_id,
			service_city, service_state, service_zip,
			service_location, approximate_location,
			schedule_type, starting_bid_cents, auction_duration_hours,
			status, awarded_provider_id, completed_at)
		VALUES ($1, $2, $3,
			'Install Ceiling Fan in Living Room',
			'Need a ceiling fan installed in the living room. Wiring already exists from an old light fixture. Fan is purchased and ready.',
			$4,
			'Austin', 'TX', '78701',
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
			'flexible', 25000, 72,
			'completed', $5, $6)
		ON CONFLICT (id) DO UPDATE SET
			status = 'completed',
			awarded_provider_id = $5,
			completed_at = $6,
			updated_at = now()`,
		completedJobID, customerUserID, propertyID,
		electricalCatID,
		providerUserID, pastCompleted,
	)
	if err != nil {
		log.Fatalf("insert completed job: %v", err)
	}

	// ── 6. Bids ───────────────────────────────────────────────────

	// Bids on the active job (one bid per provider per job due to UNIQUE constraint)
	_, err = tx.Exec(ctx, `
		INSERT INTO bids (id, job_id, provider_id, amount_cents, original_amount_cents, status)
		VALUES ($1, $2, $3, 35000, 40000, 'active')
		ON CONFLICT (id) DO NOTHING`,
		bid1ID, activeJobID, providerUserID,
	)
	if err != nil {
		log.Fatalf("insert bid1 on active job: %v", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO bids (id, job_id, provider_id, amount_cents, original_amount_cents, status)
		VALUES ($1, $2, $3, 42000, 45000, 'active')
		ON CONFLICT (id) DO NOTHING`,
		bid2ID, activeJobID, provider2UserID,
	)
	if err != nil {
		log.Fatalf("insert bid2 on active job: %v", err)
	}

	// Awarded bid on the awarded job
	_, err = tx.Exec(ctx, `
		INSERT INTO bids (id, job_id, provider_id, amount_cents, original_amount_cents, status, awarded_at)
		VALUES ($1, $2, $3, 22000, 25000, 'awarded', $4)
		ON CONFLICT (id) DO NOTHING`,
		bid3ID, awardedJobID, providerUserID, pastAwarded,
	)
	if err != nil {
		log.Fatalf("insert bid on awarded job: %v", err)
	}

	// Awarded bid on the completed job
	_, err = tx.Exec(ctx, `
		INSERT INTO bids (id, job_id, provider_id, amount_cents, original_amount_cents, status, awarded_at)
		VALUES ($1, $2, $3, 18000, 20000, 'awarded', $4)
		ON CONFLICT (id) DO NOTHING`,
		bid4ID, completedJobID, providerUserID, pastCompleted.Add(-3*24*time.Hour),
	)
	if err != nil {
		log.Fatalf("insert bid on completed job: %v", err)
	}

	// Back-fill awarded_bid_id on the awarded job now that bids exist.
	_, err = tx.Exec(ctx, `UPDATE jobs SET awarded_bid_id = $1 WHERE id = $2 AND awarded_bid_id IS NULL`,
		bid3ID, awardedJobID,
	)
	if err != nil {
		log.Fatalf("update awarded job bid: %v", err)
	}

	// ── 7. Contracts ──────────────────────────────────────────────

	// Active contract (from awarded job)
	_, err = tx.Exec(ctx, `
		INSERT INTO contracts (id, contract_number, job_id, customer_id, provider_id, bid_id,
			amount_cents, payment_timing, status, customer_accepted, provider_accepted,
			accepted_at, started_at)
		VALUES ($1, 'NM-2026-00001', $2, $3, $4, $5,
			22000, 'milestone', 'active', true, true,
			$6, $6)
		ON CONFLICT (id) DO NOTHING`,
		awardedContractID, awardedJobID, customerUserID, providerUserID, bid3ID, pastAwarded,
	)
	if err != nil {
		log.Fatalf("insert active contract: %v", err)
	}

	// Completed contract (from completed job)
	_, err = tx.Exec(ctx, `
		INSERT INTO contracts (id, contract_number, job_id, customer_id, provider_id, bid_id,
			amount_cents, payment_timing, status, customer_accepted, provider_accepted,
			accepted_at, started_at, completed_at)
		VALUES ($1, 'NM-2026-00002', $2, $3, $4, $5,
			18000, 'completion', 'completed', true, true,
			$6, $6, $7)
		ON CONFLICT (id) DO NOTHING`,
		completedContractID, completedJobID, customerUserID, providerUserID, bid4ID,
		pastCompleted.Add(-3*24*time.Hour), pastCompleted,
	)
	if err != nil {
		log.Fatalf("insert completed contract: %v", err)
	}

	// ── 8. Milestones ─────────────────────────────────────────────

	_, err = tx.Exec(ctx, `
		INSERT INTO milestones (id, contract_id, description, amount_cents, sort_order, status)
		VALUES
			($1, $2, 'Diagnose leak source and provide repair estimate', 7000, 1, 'approved'),
			($3, $2, 'Complete repair and test for leaks', 15000, 2, 'in_progress')
		ON CONFLICT (id) DO NOTHING`,
		milestone1ID, awardedContractID,
		milestone2ID,
	)
	if err != nil {
		log.Fatalf("insert milestones: %v", err)
	}

	// ── 9. Review ─────────────────────────────────────────────────

	_, err = tx.Exec(ctx, `
		INSERT INTO reviews (id, contract_id, job_id, reviewer_id, reviewee_id, reviewer_role,
			overall_rating, quality_rating, timeliness_rating, communication_rating, value_rating,
			review_text, status, published_at, review_window_ends)
		VALUES ($1, $2, $3, $4, $5, 'customer',
			5, 5, 4, 5, 5,
			'Mike did an excellent job installing the ceiling fan. He was professional, arrived on time, and cleaned up after the work. The fan works perfectly. Highly recommend!',
			'published', $6, $7)
		ON CONFLICT (id) DO NOTHING`,
		reviewID, completedContractID, completedJobID, customerUserID, providerUserID,
		pastCompleted.Add(24*time.Hour), reviewWindowEnd,
	)
	if err != nil {
		log.Printf("insert review: %v (may fail if contract FK doesn't exist, skipping)", err)
	}

	// ── 10. Trust Score ───────────────────────────────────────────

	_, err = tx.Exec(ctx, `
		INSERT INTO trust_scores (id, user_id, role, overall_score, tier,
			feedback_score, volume_score, risk_score, fraud_score)
		VALUES ($1, $2, 'provider', 78.50, 'trusted',
			85.00, 60.00, 80.00, 95.00)
		ON CONFLICT (id) DO NOTHING`,
		trustScoreID, providerUserID,
	)
	if err != nil {
		log.Fatalf("insert trust score: %v", err)
	}

	// ── 11. Subscription Tiers ────────────────────────────────────

	_, err = tx.Exec(ctx, `
		INSERT INTO subscription_tiers (id, slug, name, role, price_cents, max_active_jobs, max_bids_per_month, features_json, active)
		VALUES
			($1, 'free',         'free',          'customer', 0,    1,    NULL, '{"analytics": false, "priority_placement": false}', true),
			($2, 'pro_customer', 'pro_customer',  'customer', 1999, NULL, NULL, '{"analytics": true, "priority_placement": true, "unlimited_jobs": true}', true),
			($3, 'pro_provider', 'pro_provider',  'provider', 2999, NULL, NULL, '{"analytics": true, "priority_placement": true, "unlimited_bids": true, "badge": true}', true)
		ON CONFLICT (id) DO NOTHING`,
		freeTierID, proCustomerTierID, proProviderTierID,
	)
	if err != nil {
		log.Fatalf("insert subscription tiers: %v", err)
	}

	// ── 12. Subscriptions ─────────────────────────────────────────

	_, err = tx.Exec(ctx, `
		INSERT INTO subscriptions (id, user_id, tier_id, status, current_period_start, current_period_end)
		VALUES
			($1, $2, $3, 'active', $9, $10),
			($4, $5, $3, 'active', $9, $10),
			($6, $7, $8, 'active', $9, $10)
		ON CONFLICT (id) DO NOTHING`,
		adminSubscriptionID, adminUserID, freeTierID,
		custSubscriptionID, customerUserID,
		provSubscriptionID, providerUserID, proProviderTierID,
		periodStart, periodEnd,
	)
	if err != nil {
		log.Fatalf("insert subscriptions: %v", err)
	}

	// ── 13. Notification Preferences ──────────────────────────────

	_, err = tx.Exec(ctx, `
		INSERT INTO notification_preferences (user_id, preferences, email_digest)
		VALUES
			($1, '{"new_bid": {"in_app": true, "email": true, "push": true}, "contract_update": {"in_app": true, "email": true, "push": false}}', 'daily'),
			($2, '{"new_bid": {"in_app": true, "email": true, "push": true}, "contract_update": {"in_app": true, "email": true, "push": true}, "payment": {"in_app": true, "email": true, "push": true}}', 'immediate'),
			($3, '{"bid_awarded": {"in_app": true, "email": true, "push": true}, "new_job": {"in_app": true, "email": false, "push": true}}', 'daily')
		ON CONFLICT (user_id) DO NOTHING`,
		adminUserID, customerUserID, providerUserID,
	)
	if err != nil {
		log.Fatalf("insert notification preferences: %v", err)
	}

	// ── 14. Market Range (for the HVAC AC repair service) ─────────

	_, err = tx.Exec(ctx, `
		INSERT INTO market_ranges (service_type_id, zip_code, city, state,
			low_cents, median_cents, high_cents, data_points,
			source, confidence, valid_until)
		VALUES ($1, '78701', 'Austin', 'TX',
			15000, 30000, 50000, 42,
			'seeded', 0.65, $2)
		ON CONFLICT DO NOTHING`,
		acRepairServiceID, now.Add(90*24*time.Hour),
	)
	if err != nil {
		log.Printf("insert market range: %v (skipping)", err)
	}

	// ── 14b. Platform Fee Config (default) ───────────────────────
	//
	// The admin fee-config endpoint (GET /api/v1/admin/payments/fee-config)
	// and every payment fee calculation fall back to the default config row
	// (category_id IS NULL, active = true). Without it the endpoint 404s and
	// fee math has no source of truth. Seed the platform's documented default,
	// kept in sync with domain.DefaultFeeConfig() (services/payment/internal/
	// domain/types.go) so a fresh DB matches the in-code fallback exactly:
	//   - 5% platform take rate          (PRD: 5-8% take rate)
	//   - 2% guarantee fund contribution (PRD: 2-3%, within the take rate)
	//   - no min/max fee cap
	//   - lead-gen fee disabled (0%)     (additive, opt-in per CLAUDE.md)
	// Idempotent via WHERE NOT EXISTS so re-runs don't stack duplicate active
	// defaults.
	_, err = tx.Exec(ctx, `
		INSERT INTO platform_fee_config
			(fee_percentage, guarantee_percentage, min_fee_cents, max_fee_cents, active,
			 lead_gen_enabled, lead_gen_percentage, lead_gen_min_fee_cents, lead_gen_max_fee_cents)
		SELECT 0.0800, 0.0200, 0, NULL, true,
		       false, 0.1000, 0, NULL
		WHERE NOT EXISTS (
			SELECT 1 FROM platform_fee_config
			WHERE category_id IS NULL AND active = true
		)`,
	)
	if err != nil {
		log.Fatalf("insert default platform fee config: %v", err)
	}

	// ── 15. Marketplace (goods) ──────────────────────────────────
	//
	// Seeds the goods marketplace: 8 active listings, 3 with active bids,
	// 2 closing soon, 1 sold (with order), 1 in dispute. Idempotent —
	// uses fixed UUIDs and ON CONFLICT DO UPDATE.
	if err := seedMarketplace(ctx, tx, now); err != nil {
		log.Fatalf("seed marketplace: %v", err)
	}

	// Optional: 40 additional listings distributed across closing-time
	// buckets so the /marketplace scoreboard reads as a populated live
	// event during demos. Gated on SEED_DEMO_MARKETPLACE=1.
	if err := seedDemoMarketplace(ctx, tx, now); err != nil {
		log.Fatalf("seed demo marketplace: %v", err)
	}

	if err := tx.Commit(ctx); err != nil {
		log.Fatalf("commit transaction: %v", err)
	}

	log.Println("Seed complete!")
	log.Println("")
	log.Println("╔══════════════════════════════════════════════════════════════╗")
	log.Println("║  Dev Accounts (default password: Password123! — see above)   ║")
	log.Println("║  Override with SEED_PASSWORD env var for shared environments ║")
	log.Println("╠══════════════════════════════════════════════════════════════╣")
	log.Println("║  Admin:     admin@nomarkup.com      roles: [admin]          ║")
	log.Println("║  Customer:  customer@nomarkup.com   roles: [customer]       ║")
	log.Println("║  Provider:  provider@nomarkup.com   roles: [provider]       ║")
	log.Println("║  Provider2: provider2@nomarkup.com  roles: [provider]       ║")
	log.Println("╚══════════════════════════════════════════════════════════════╝")
	log.Println("")
	log.Println("Seeded: 4 users, 1 property, 2 provider profiles, 3 jobs,")
	log.Println("        4 bids, 2 contracts, 2 milestones, 1 review,")
	log.Println("        1 trust score, 3 subscription tiers, 3 subscriptions,")
	log.Println("        3 notification preferences, 1 market range")
	log.Println("        Marketplace: 13 listings (8 active + 3 with bids + ")
	log.Println("        2 closing-soon + 1 sold + 1 disputed), ~22 listing bids,")
	log.Println("        1 listing order, 1 goods dispute")
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}
	hash := argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLength)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory, argonIterations, argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}
