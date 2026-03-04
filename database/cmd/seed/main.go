package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"os"
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

// Seed password for all dev accounts.
const seedPassword = "Password123!"

// Fixed UUIDs for deterministic seed data (idempotent re-runs).
const (
	adminUserID    = "00000000-0000-0000-0000-000000000001"
	customerUserID = "00000000-0000-0000-0000-000000000002"
	providerUserID = "00000000-0000-0000-0000-000000000003"

	propertyID = "00000000-0000-0000-0000-000000000010"

	providerProfileID = "00000000-0000-0000-0000-000000000020"

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

	_, err = tx.Exec(ctx, `
		INSERT INTO users (id, email, email_verified, password_hash, display_name, roles, status, timezone)
		VALUES
			($1, 'admin@nomarkup.com',    true, $4, 'Admin User',     '{admin}',    'active', 'America/Los_Angeles'),
			($2, 'customer@nomarkup.com', true, $4, 'Jane Customer',  '{customer}', 'active', 'America/New_York'),
			($3, 'provider@nomarkup.com', true, $4, 'Mike Provider',  '{provider}', 'active', 'America/Chicago')
		ON CONFLICT (id) DO NOTHING`,
		adminUserID, customerUserID, providerUserID, passwordHash,
	)
	if err != nil {
		log.Fatalf("insert users: %v", err)
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

	// ── 5. Jobs ───────────────────────────────────────────────────

	// Active job (open for bids)
	_, err = tx.Exec(ctx, `
		INSERT INTO jobs (id, customer_id, property_id, title, description,
			category_id, subcategory_id, service_type_id,
			service_city, service_state, service_zip,
			service_location, approximate_location,
			schedule_type, starting_bid_cents, auction_duration_hours, auction_ends_at,
			status, bid_count)
		VALUES ($1, $2, $3,
			'AC Unit Not Cooling Properly',
			'My central AC unit is blowing warm air. It''s a 3-ton unit installed in 2018. The filter was replaced last month. Need a professional to diagnose and repair.',
			$4, $5, $6,
			'Austin', 'TX', '78701',
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
			'flexible', 50000, 72, $7,
			'active', 2)
		ON CONFLICT (id) DO NOTHING`,
		activeJobID, customerUserID, propertyID,
		hvacCatID, hvacSubcatID, acRepairServiceID,
		auctionEnd,
	)
	if err != nil {
		log.Fatalf("insert active job: %v", err)
	}

	// Awarded job
	_, err = tx.Exec(ctx, `
		INSERT INTO jobs (id, customer_id, property_id, title, description,
			category_id,
			service_city, service_state, service_zip,
			service_location, approximate_location,
			schedule_type, starting_bid_cents, auction_duration_hours,
			status, bid_count, awarded_provider_id, awarded_bid_id, awarded_at)
		VALUES ($1, $2, $3,
			'Kitchen Sink Leaking',
			'The kitchen sink has a slow leak under the cabinet. Water pools on the floor overnight. Need repair ASAP.',
			$4,
			'Austin', 'TX', '78701',
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
			'specific_date', 30000, 72,
			'in_progress', 1, $5, $6, $7)
		ON CONFLICT (id) DO NOTHING`,
		awardedJobID, customerUserID, propertyID,
		plumbingCatID,
		providerUserID, bid3ID, pastAwarded,
	)
	if err != nil {
		log.Fatalf("insert awarded job: %v", err)
	}

	// Completed job
	_, err = tx.Exec(ctx, `
		INSERT INTO jobs (id, customer_id, property_id, title, description,
			category_id,
			service_city, service_state, service_zip,
			service_location, approximate_location,
			schedule_type, starting_bid_cents, auction_duration_hours,
			status, bid_count, awarded_provider_id, completed_at)
		VALUES ($1, $2, $3,
			'Install Ceiling Fan in Living Room',
			'Need a ceiling fan installed in the living room. Wiring already exists from an old light fixture. Fan is purchased and ready.',
			$4,
			'Austin', 'TX', '78701',
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
			'flexible', 25000, 72,
			'completed', 1, $5, $6)
		ON CONFLICT (id) DO NOTHING`,
		completedJobID, customerUserID, propertyID,
		electricalCatID,
		providerUserID, pastCompleted,
	)
	if err != nil {
		log.Fatalf("insert completed job: %v", err)
	}

	// ── 6. Bids ───────────────────────────────────────────────────

	// Bid on the active job (one bid per provider per job due to UNIQUE constraint)
	_, err = tx.Exec(ctx, `
		INSERT INTO bids (id, job_id, provider_id, amount_cents, original_amount_cents, status)
		VALUES ($1, $2, $3, 35000, 40000, 'active')
		ON CONFLICT (id) DO NOTHING`,
		bid1ID, activeJobID, providerUserID,
	)
	if err != nil {
		log.Fatalf("insert bid on active job: %v", err)
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
		INSERT INTO subscription_tiers (id, name, role, price_cents, max_active_jobs, max_bids_per_month, features_json, active)
		VALUES
			($1, 'free',          'customer', 0,    1,    NULL, '{"analytics": false, "priority_placement": false}', true),
			($2, 'pro_customer',  'customer', 1999, NULL, NULL, '{"analytics": true, "priority_placement": true, "unlimited_jobs": true}', true),
			($3, 'pro_provider',  'provider', 2999, NULL, NULL, '{"analytics": true, "priority_placement": true, "unlimited_bids": true, "badge": true}', true)
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

	if err := tx.Commit(ctx); err != nil {
		log.Fatalf("commit transaction: %v", err)
	}

	log.Println("Seed complete!")
	log.Println("")
	log.Println("╔══════════════════════════════════════════════════════════════╗")
	log.Println("║  Dev Accounts (all passwords: Password123!)                 ║")
	log.Println("╠══════════════════════════════════════════════════════════════╣")
	log.Println("║  Admin:    admin@nomarkup.com      roles: [admin]           ║")
	log.Println("║  Customer: customer@nomarkup.com   roles: [customer]        ║")
	log.Println("║  Provider: provider@nomarkup.com   roles: [provider]        ║")
	log.Println("╚══════════════════════════════════════════════════════════════╝")
	log.Println("")
	log.Println("Seeded: 3 users, 1 property, 1 provider profile, 3 jobs,")
	log.Println("        2 bids, 2 contracts, 2 milestones, 1 review,")
	log.Println("        1 trust score, 3 subscription tiers, 3 subscriptions,")
	log.Println("        3 notification preferences, 1 market range")
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
