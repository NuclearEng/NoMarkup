package main

// Marketplace (goods) seed — 13 listings spread across categories:
//
//   - 8 active listings, no bids
//   - 3 listings with active bids (5–10 bids each, ascending)
//   - 2 listings about to close (auction_ends_at < 1h from now)
//   - 1 listing sold (status='sold', has a corresponding listing_order)
//   - 1 listing in dispute (escrow_status='disputed')
//
// Idempotent — uses fixed UUIDs and ON CONFLICT DO UPDATE/DO NOTHING.
//
// Photos use unsplash placeholder URLs. The /marketplace UI does not
// require live photos — it falls back to a placeholder if the URL 404s.
//
// Sellers are mixed across customer / provider / provider2; buyers
// (bidders) are also mixed so every dev account has at least one bid.

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Fixed UUIDs for marketplace seed data — series 0xxx for listings,
// 1xxx for bids, 2xxx for orders. Keeping them in a single block makes
// it easy to wipe + re-seed during dev.
const (
	listingActive1ID   = "00000000-0000-0000-0000-000000001000"
	listingActive2ID   = "00000000-0000-0000-0000-000000001001"
	listingActive3ID   = "00000000-0000-0000-0000-000000001002"
	listingActive4ID   = "00000000-0000-0000-0000-000000001003"
	listingActive5ID   = "00000000-0000-0000-0000-000000001004"
	listingActive6ID   = "00000000-0000-0000-0000-000000001005"
	listingActive7ID   = "00000000-0000-0000-0000-000000001006"
	listingActive8ID   = "00000000-0000-0000-0000-000000001007"
	listingBidded1ID   = "00000000-0000-0000-0000-000000001100"
	listingBidded2ID   = "00000000-0000-0000-0000-000000001101"
	listingBidded3ID   = "00000000-0000-0000-0000-000000001102"
	listingClosing1ID  = "00000000-0000-0000-0000-000000001200"
	listingClosing2ID  = "00000000-0000-0000-0000-000000001201"
	listingSoldID      = "00000000-0000-0000-0000-000000001300"
	listingDisputedID  = "00000000-0000-0000-0000-000000001400"

	soldOrderID     = "00000000-0000-0000-0000-000000002000"
	disputedOrderID = "00000000-0000-0000-0000-000000002001"

	goodsDisputeID = "00000000-0000-0000-0000-000000003000"
)

func seedMarketplace(ctx context.Context, tx pgx.Tx, now time.Time) error {
	// Look up the goods subcategories we just seeded in migration 036.
	cats, err := lookupGoodsCategories(ctx, tx)
	if err != nil {
		return fmt.Errorf("lookup goods categories: %w", err)
	}

	// Sentinel — the migration must have run.
	required := []string{"goods-furniture", "goods-electronics", "goods-tools"}
	for _, slug := range required {
		if _, ok := cats[slug]; !ok {
			return fmt.Errorf("required goods category %q missing — run migrations first (make migrate-up)", slug)
		}
	}

	// Pickup point in Austin, TX (same as the services seed).
	const lng, lat = -97.7431, 30.2672

	// ─────────────────────────────────────────────────────────────
	// 8 active listings, no bids. Spread across categories so the
	// /marketplace category filter has something to show in each.
	// ─────────────────────────────────────────────────────────────

	activeListings := []struct {
		id, sellerID, slug, title, description, photo string
		startCents                                    int64
		durationHours                                 int
	}{
		{listingActive1ID, providerUserID, "goods-furniture",
			"Mid-century walnut credenza",
			"Solid walnut credenza, 6ft wide, 1965. Minor surface scratches; legs and joints solid. Includes original key.",
			"https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=800",
			18000, 48},
		{listingActive2ID, provider2UserID, "goods-electronics",
			"Sony A7 III mirrorless camera body",
			"Excellent condition, ~12k shutter count, original box. Battery, charger, and one strap included. Local pickup only.",
			"https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800",
			95000, 48},
		{listingActive3ID, providerUserID, "goods-tools",
			"DeWalt 20V cordless drill kit",
			"Two batteries, charger, and case. Used on a couple of weekend projects. Bits not included.",
			"https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=800",
			8500, 24},
		{listingActive4ID, customerUserID, "goods-sporting",
			"Trek FX 2 hybrid bike, size L",
			"2022 Trek FX 2, lightly used. New tires last spring. Frame size 21\" — fits 6'0\"–6'3\".",
			"https://images.unsplash.com/photo-1532298229144-0ec0c57515c7?w=800",
			42000, 48},
		{listingActive5ID, provider2UserID, "goods-vehicles",
			"Set of 4 OEM 18\" alloy wheels (BMW)",
			"Came off a 2018 BMW 3-series. Tires worn, sell wheels only. Curb rash on one rim, photos on request.",
			"https://images.unsplash.com/photo-1553949345-eb786bb3f7ba?w=800",
			55000, 48},
		{listingActive6ID, providerUserID, "goods-home-garden",
			"Weber Genesis II E-310 grill",
			"Three-burner, propane. Used three seasons. Cleaned monthly, cover included. Buyer brings a truck.",
			"https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800",
			28000, 24},
		{listingActive7ID, customerUserID, "goods-books-media",
			"Vintage vinyl collection — 80s/90s rock (45 LPs)",
			"Bulk lot of 45 LPs, all sleeves intact, most A-grade. List on request. Selling as one lot only.",
			"https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=800",
			15000, 168},
		{listingActive8ID, provider2UserID, "goods-collectibles",
			"Sealed Pokemon Base Set booster box (1999)",
			"Original 36-pack 1999 Base Set booster box. Sealed, never opened. Provenance: estate sale, photos available.",
			"https://images.unsplash.com/photo-1542779283-429940ce8336?w=800",
			120000, 168},
	}

	for _, l := range activeListings {
		catID := cats[l.slug]
		end := now.Add(time.Duration(l.durationHours) * time.Hour)
		_, err := tx.Exec(ctx, `
			INSERT INTO listings (id, seller_id, title, description, category_id,
				location, pickup_address, pickup_zip_code,
				starting_price_cents, auction_duration_hours,
				auction_ends_at, original_auction_ends_at, status)
			VALUES ($1, $2, $3, $4, $5,
				ST_SetSRID(ST_MakePoint($6, $7), 4326), '123 Main St, Austin, TX', '78701',
				$8, $9, $10, $10, 'active')
			ON CONFLICT (id) DO UPDATE SET
				title = EXCLUDED.title,
				description = EXCLUDED.description,
				auction_ends_at = EXCLUDED.auction_ends_at,
				status = 'active',
				updated_at = now()`,
			l.id, l.sellerID, l.title, l.description, catID,
			lng, lat,
			l.startCents, l.durationHours, end,
		)
		if err != nil {
			return fmt.Errorf("insert active listing %s: %w", l.title, err)
		}
		if err := upsertListingPhoto(ctx, tx, l.id, l.photo); err != nil {
			return err
		}
	}

	// ─────────────────────────────────────────────────────────────
	// 3 listings with active bids — 5..10 bids each, ascending.
	// ─────────────────────────────────────────────────────────────

	biddedListings := []struct {
		id, sellerID, slug, title, photo string
		startCents                       int64
		bidCount                         int
		// list of (bidder, amount) in chronological order — last is high.
		bids []bidSpec
	}{
		{
			listingBidded1ID, providerUserID, "goods-electronics",
			"PS5 Disc Edition + 2 controllers",
			"https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800",
			30000, 7,
			[]bidSpec{
				{customerUserID, 31000},
				{provider2UserID, 33000},
				{customerUserID, 35500},
				{provider2UserID, 37000},
				{customerUserID, 39500},
				{provider2UserID, 41000},
				{customerUserID, 43500},
			},
		},
		{
			listingBidded2ID, customerUserID, "goods-tools",
			"Milwaukee M18 combo kit (drill + impact + circular saw)",
			"https://images.unsplash.com/photo-1530124566582-a618bc2615dc?w=800",
			25000, 5,
			[]bidSpec{
				{providerUserID, 26000},
				{provider2UserID, 28000},
				{providerUserID, 30500},
				{provider2UserID, 33000},
				{providerUserID, 35500},
			},
		},
		{
			listingBidded3ID, provider2UserID, "goods-sporting",
			"Peloton Bike+, 2022, with original mat",
			"https://images.unsplash.com/photo-1591291621164-2c6367723315?w=800",
			80000, 9,
			[]bidSpec{
				{customerUserID, 82000},
				{providerUserID, 85000},
				{customerUserID, 88000},
				{providerUserID, 92000},
				{customerUserID, 96000},
				{providerUserID, 100000},
				{customerUserID, 104000},
				{providerUserID, 108000},
				{customerUserID, 112500},
			},
		},
	}

	for _, l := range biddedListings {
		catID := cats[l.slug]
		end := now.Add(36 * time.Hour)
		_, err := tx.Exec(ctx, `
			INSERT INTO listings (id, seller_id, title, description, category_id,
				location, pickup_address, pickup_zip_code,
				starting_price_cents, auction_duration_hours,
				auction_ends_at, original_auction_ends_at, status)
			VALUES ($1, $2, $3, '', $4,
				ST_SetSRID(ST_MakePoint($5, $6), 4326), '123 Main St, Austin, TX', '78701',
				$7, 48, $8, $8, 'active')
			ON CONFLICT (id) DO UPDATE SET
				auction_ends_at = $8,
				status = 'active',
				updated_at = now()`,
			l.id, l.sellerID, l.title, catID,
			lng, lat,
			l.startCents, end,
		)
		if err != nil {
			return fmt.Errorf("insert bidded listing %s: %w", l.title, err)
		}
		if err := upsertListingPhoto(ctx, tx, l.id, l.photo); err != nil {
			return err
		}

		// Wipe and re-insert bids so the seed is idempotent. The trigger
		// will re-derive current_bid_cents on each insert.
		if _, err := tx.Exec(ctx, `DELETE FROM listing_bids WHERE listing_id = $1`, l.id); err != nil {
			return fmt.Errorf("clear bids for %s: %w", l.id, err)
		}
		// Reset listing counters so the trigger sees a clean slate (the
		// DELETE trigger above already decrements, but if we somehow had
		// a stuck state from a prior partial run we want zero).
		if _, err := tx.Exec(ctx, `
			UPDATE listings SET bid_count = 0, current_bid_cents = NULL,
				current_bidder_id = NULL WHERE id = $1`, l.id); err != nil {
			return fmt.Errorf("reset bid counters for %s: %w", l.id, err)
		}

		baseTime := now.Add(-time.Duration(len(l.bids)*2) * time.Hour)
		for i, b := range l.bids {
			status := "outbid"
			if i == len(l.bids)-1 {
				status = "active" // current high bid
			}
			_, err := tx.Exec(ctx, `
				INSERT INTO listing_bids (listing_id, bidder_id, amount_cents, status, created_at)
				VALUES ($1, $2, $3, $4, $5)`,
				l.id, b.bidder, b.amountCents, status,
				baseTime.Add(time.Duration(i)*time.Hour),
			)
			if err != nil {
				return fmt.Errorf("insert bid %d on %s: %w", i, l.id, err)
			}
		}
	}

	// ─────────────────────────────────────────────────────────────
	// 2 listings about to close (auction_ends_at < 1h from now).
	// ─────────────────────────────────────────────────────────────

	closingListings := []struct {
		id, sellerID, slug, title, photo string
		startCents, currentCents         int64
		minutesLeft                      int
	}{
		{listingClosing1ID, providerUserID, "goods-furniture",
			"Solid oak dining table, seats 8",
			"https://images.unsplash.com/photo-1604061986761-d9d0cc41b0b1?w=800",
			20000, 32500, 25},
		{listingClosing2ID, customerUserID, "goods-clothing",
			"Vintage leather jacket, men's L",
			"https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800",
			6000, 14000, 50},
	}

	for _, l := range closingListings {
		catID := cats[l.slug]
		end := now.Add(time.Duration(l.minutesLeft) * time.Minute)
		_, err := tx.Exec(ctx, `
			INSERT INTO listings (id, seller_id, title, description, category_id,
				location, pickup_address, pickup_zip_code,
				starting_price_cents, auction_duration_hours,
				auction_ends_at, original_auction_ends_at, status)
			VALUES ($1, $2, $3, 'Auction closing soon — local pickup only.', $4,
				ST_SetSRID(ST_MakePoint($5, $6), 4326), '123 Main St, Austin, TX', '78701',
				$7, 24, $8, $8, 'active')
			ON CONFLICT (id) DO UPDATE SET
				auction_ends_at = $8,
				status = 'active',
				updated_at = now()`,
			l.id, l.sellerID, l.title, catID,
			lng, lat,
			l.startCents, end,
		)
		if err != nil {
			return fmt.Errorf("insert closing listing %s: %w", l.title, err)
		}
		if err := upsertListingPhoto(ctx, tx, l.id, l.photo); err != nil {
			return err
		}

		// One ascending bid trail so closing-soon listings have a winner.
		if _, err := tx.Exec(ctx, `DELETE FROM listing_bids WHERE listing_id = $1`, l.id); err != nil {
			return fmt.Errorf("clear closing-soon bids: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			UPDATE listings SET bid_count = 0, current_bid_cents = NULL,
				current_bidder_id = NULL WHERE id = $1`, l.id); err != nil {
			return fmt.Errorf("reset closing-soon counters: %w", err)
		}

		// Two losing bids + one current winner.
		bids := []bidSpec{
			{customerUserID, l.startCents + 1000},
			{provider2UserID, l.startCents + 3000},
			{customerUserID, l.currentCents},
		}
		// Avoid the seller bidding on their own listing — swap if needed.
		for i, b := range bids {
			if b.bidder == l.sellerID {
				bids[i].bidder = adminUserID
			}
		}
		baseTime := now.Add(-2 * time.Hour)
		for i, b := range bids {
			status := "outbid"
			if i == len(bids)-1 {
				status = "active"
			}
			_, err := tx.Exec(ctx, `
				INSERT INTO listing_bids (listing_id, bidder_id, amount_cents, status, created_at)
				VALUES ($1, $2, $3, $4, $5)`,
				l.id, b.bidder, b.amountCents, status, baseTime.Add(time.Duration(i*15)*time.Minute),
			)
			if err != nil {
				return fmt.Errorf("insert closing-soon bid: %w", err)
			}
		}
	}

	// ─────────────────────────────────────────────────────────────
	// 1 sold listing — status='sold', has a corresponding listing_order.
	// ─────────────────────────────────────────────────────────────

	soldEnd := now.Add(-2 * 24 * time.Hour)
	_, err = tx.Exec(ctx, `
		INSERT INTO listings (id, seller_id, title, description, category_id,
			location, pickup_address, pickup_zip_code,
			starting_price_cents, current_bid_cents, current_bidder_id,
			bid_count, auction_duration_hours,
			auction_ends_at, original_auction_ends_at, status)
		VALUES ($1, $2, $3, $4, $5,
			ST_SetSRID(ST_MakePoint($6, $7), 4326), '123 Main St, Austin, TX', '78701',
			$8, $9, $10, 1, 48, $11, $11, 'sold')
		ON CONFLICT (id) DO UPDATE SET
			status = 'sold',
			current_bid_cents = $9,
			current_bidder_id = $10,
			updated_at = now()`,
		listingSoldID, providerUserID,
		"GoPro HERO11 Black with mounts",
		"GoPro HERO11 Black, two batteries, dual charger, helmet + chest mount.",
		cats["goods-electronics"],
		lng, lat,
		18000, 24500, customerUserID, soldEnd,
	)
	if err != nil {
		return fmt.Errorf("insert sold listing: %w", err)
	}
	if err := upsertListingPhoto(ctx, tx, listingSoldID,
		"https://images.unsplash.com/photo-1514924013411-cbf25faa35bb?w=800"); err != nil {
		return err
	}

	// Sold listing — wipe + re-insert one awarded bid.
	if _, err := tx.Exec(ctx, `DELETE FROM listing_bids WHERE listing_id = $1`, listingSoldID); err != nil {
		return fmt.Errorf("clear sold bids: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE listings SET bid_count = 0 WHERE id = $1`, listingSoldID); err != nil {
		return fmt.Errorf("reset sold bid_count: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO listing_bids (listing_id, bidder_id, amount_cents, status, created_at)
		VALUES ($1, $2, $3, 'awarded', $4)`,
		listingSoldID, customerUserID, 24500, soldEnd.Add(-30*time.Minute),
	)
	if err != nil {
		return fmt.Errorf("insert awarded bid: %w", err)
	}

	// listing_orders row — escrow released, pickup confirmed.
	_, err = tx.Exec(ctx, `
		INSERT INTO listing_orders (id, listing_id, seller_id, buyer_id,
			amount_cents, fee_cents, escrow_status,
			pickup_confirmed_at, released_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'released', $7, $8)
		ON CONFLICT (id) DO UPDATE SET
			escrow_status = 'released',
			pickup_confirmed_at = $7,
			released_at = $8,
			updated_at = now()`,
		soldOrderID, listingSoldID, providerUserID, customerUserID,
		24500, 1225, // 5% fee
		soldEnd.Add(1*time.Hour), soldEnd.Add(2*time.Hour),
	)
	if err != nil {
		return fmt.Errorf("insert sold order: %w", err)
	}

	// ─────────────────────────────────────────────────────────────
	// 1 disputed listing — escrow_status='disputed', dispute row.
	// ─────────────────────────────────────────────────────────────

	disputedEnd := now.Add(-3 * 24 * time.Hour)
	_, err = tx.Exec(ctx, `
		INSERT INTO listings (id, seller_id, title, description, category_id,
			location, pickup_address, pickup_zip_code,
			starting_price_cents, current_bid_cents, current_bidder_id,
			bid_count, auction_duration_hours,
			auction_ends_at, original_auction_ends_at, status)
		VALUES ($1, $2, $3, $4, $5,
			ST_SetSRID(ST_MakePoint($6, $7), 4326), '123 Main St, Austin, TX', '78701',
			$8, $9, $10, 1, 48, $11, $11, 'sold')
		ON CONFLICT (id) DO UPDATE SET
			status = 'sold',
			current_bid_cents = $9,
			current_bidder_id = $10,
			updated_at = now()`,
		listingDisputedID, provider2UserID,
		"Apple iPad Pro 11\" (2021), 256GB",
		"iPad Pro M1, 11\", WiFi+Cellular. Comes with original box and Smart Folio.",
		cats["goods-electronics"],
		lng, lat,
		40000, 56000, customerUserID, disputedEnd,
	)
	if err != nil {
		return fmt.Errorf("insert disputed listing: %w", err)
	}
	if err := upsertListingPhoto(ctx, tx, listingDisputedID,
		"https://images.unsplash.com/photo-1561154464-82e9adf32764?w=800"); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM listing_bids WHERE listing_id = $1`, listingDisputedID); err != nil {
		return fmt.Errorf("clear disputed bids: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE listings SET bid_count = 0 WHERE id = $1`, listingDisputedID); err != nil {
		return fmt.Errorf("reset disputed bid_count: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO listing_bids (listing_id, bidder_id, amount_cents, status, created_at)
		VALUES ($1, $2, $3, 'awarded', $4)`,
		listingDisputedID, customerUserID, 56000, disputedEnd.Add(-15*time.Minute),
	)
	if err != nil {
		return fmt.Errorf("insert disputed awarded bid: %w", err)
	}

	// listing_orders row — disputed. The dispute_id is a soft FK; we leave
	// it NULL since `marketplace_disputes` is the authoritative store and
	// joins go the other direction (marketplace_disputes.listing_order_id).
	_, err = tx.Exec(ctx, `
		INSERT INTO listing_orders (id, listing_id, seller_id, buyer_id,
			amount_cents, fee_cents, escrow_status)
		VALUES ($1, $2, $3, $4, $5, $6, 'disputed')
		ON CONFLICT (id) DO UPDATE SET
			escrow_status = 'disputed',
			updated_at = now()`,
		disputedOrderID, listingDisputedID, provider2UserID, customerUserID,
		56000, 2800,
	)
	if err != nil {
		return fmt.Errorf("insert disputed order: %w", err)
	}

	// Dispute row goes into `marketplace_disputes` (migration 035).
	_, err = tx.Exec(ctx, `
		INSERT INTO marketplace_disputes (id, listing_order_id, opened_by,
			reason, description, status)
		VALUES ($1, $2, $3, 'item_damaged',
			'Item received with cracked screen — not disclosed in listing. Photos uploaded to evidence.',
			'open')
		ON CONFLICT (id) DO UPDATE SET
			status = 'open',
			updated_at = now()`,
		goodsDisputeID, disputedOrderID, customerUserID,
	)
	if err != nil {
		return fmt.Errorf("insert goods dispute: %w", err)
	}

	return nil
}

type bidSpec struct {
	bidder      string
	amountCents int64
}

func lookupGoodsCategories(ctx context.Context, tx pgx.Tx) (map[string]string, error) {
	rows, err := tx.Query(ctx,
		`SELECT slug, id FROM service_categories WHERE is_goods = true AND level = 2`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]string)
	for rows.Next() {
		var slug, id string
		if err := rows.Scan(&slug, &id); err != nil {
			return nil, err
		}
		out[slug] = id
	}
	return out, rows.Err()
}

// upsertListingPhoto inserts a single photo at sort_order=0 if the listing
// has no photos yet. Idempotent for re-seeding.
func upsertListingPhoto(ctx context.Context, tx pgx.Tx, listingID, url string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO listing_photos (listing_id, url, sort_order)
		SELECT $1, $2, 0
		WHERE NOT EXISTS (
			SELECT 1 FROM listing_photos WHERE listing_id = $1
		)`, listingID, url)
	if err != nil {
		return fmt.Errorf("insert photo for %s: %w", listingID, err)
	}
	return nil
}
