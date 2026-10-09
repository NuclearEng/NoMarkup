package main

// Marketplace demo seed — populates the live-auction scoreboard with
// 40 additional listings distributed across closing-time buckets so the
// /marketplace page reads as a populated live event during VC walkthroughs.
//
//   - 8 critical (closing in 2..9 minutes — red ribbon)
//   - 12 urgent  (closing in 12..58 minutes — gold ribbon)
//   - 20 normal  (closing in 4..22 hours)
//
// Each listing has a photo, a current bid, and a small bid trail so
// bid_count and current_bid_cents are realistic. Some listings have
// snipe-extension counts > 0 to exercise the "+30s ×N" badge.
//
// Idempotent — fixed UUIDs in the 0x9xxx block, ON CONFLICT DO UPDATE.
// Run via: SEED_DEMO_MARKETPLACE=true make seed

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

type demoListing struct {
	id, slug, title, photo string
	startCents             int64
	bidCount               int
	currentCents           int64
	snipeExtensions        int
	closesIn               time.Duration
}

func seedDemoMarketplace(ctx context.Context, tx pgx.Tx, now time.Time) error {
	if os.Getenv("SEED_DEMO_MARKETPLACE") == "" {
		return nil
	}

	cats, err := lookupGoodsCategories(ctx, tx)
	if err != nil {
		return fmt.Errorf("lookup goods categories: %w", err)
	}
	if len(cats) == 0 {
		return fmt.Errorf("no goods categories found — run migration 036 first")
	}

	// Pickup point — Austin, TX (matches base marketplace seed).
	const lng, lat = -97.7431, 30.2672

	demo := buildDemoListings()

	// Rotate seller across the three dev accounts so the scoreboard
	// shows a mix of identities.
	sellers := []string{providerUserID, provider2UserID, customerUserID}

	for i, l := range demo {
		catID, ok := cats[l.slug]
		if !ok {
			// Fall back to "goods-other" if a category slug got renamed.
			catID = cats["goods-other"]
			if catID == "" {
				return fmt.Errorf("category %q missing and no goods-other fallback", l.slug)
			}
		}
		seller := sellers[i%len(sellers)]
		end := now.Add(l.closesIn)

		_, err := tx.Exec(ctx, `
			INSERT INTO listings (id, seller_id, title, description, category_id,
				location, pickup_address, pickup_zip_code,
				starting_price_cents, auction_duration_hours,
				auction_ends_at, original_auction_ends_at,
				snipe_extension_count, status)
			VALUES ($1, $2, $3, $4, $5,
				ST_SetSRID(ST_MakePoint($6, $7), 4326), '123 Main St, Austin, TX', '78701',
				$8, 24, $9, $9, $10, 'active')
			ON CONFLICT (id) DO UPDATE SET
				title = EXCLUDED.title,
				description = EXCLUDED.description,
				category_id = EXCLUDED.category_id,
				auction_ends_at = EXCLUDED.auction_ends_at,
				original_auction_ends_at = EXCLUDED.original_auction_ends_at,
				snipe_extension_count = EXCLUDED.snipe_extension_count,
				status = 'active',
				updated_at = now()`,
			l.id, seller, l.title,
			"Local pickup only, 25-mile radius. Live demo seed.",
			catID,
			lng, lat,
			l.startCents, end, l.snipeExtensions,
		)
		if err != nil {
			return fmt.Errorf("insert demo listing %s: %w", l.title, err)
		}
		if err := upsertListingPhoto(ctx, tx, l.id, l.photo); err != nil {
			return err
		}

		// Wipe and reset bid counters before re-inserting the trail so
		// the trigger-derived counts match the seed expectation.
		if _, err := tx.Exec(ctx,
			`DELETE FROM listing_bids WHERE listing_id = $1`, l.id); err != nil {
			return fmt.Errorf("clear demo bids %s: %w", l.id, err)
		}
		if _, err := tx.Exec(ctx, `
			UPDATE listings SET bid_count = 0, current_bid_cents = NULL,
				current_bidder_id = NULL WHERE id = $1`, l.id); err != nil {
			return fmt.Errorf("reset demo counters %s: %w", l.id, err)
		}

		// Build an ascending bid trail. Skip the seller. Spread bid
		// timestamps across the auction lifetime so the recent-bids
		// query returns chronological data.
		if l.bidCount > 0 {
			bidders := []string{customerUserID, provider2UserID, providerUserID, adminUserID}
			// Filter out the seller so we don't violate the
			// "no self-bidding" constraint.
			filtered := bidders[:0]
			for _, b := range bidders {
				if b != seller {
					filtered = append(filtered, b)
				}
			}
			step := (l.currentCents - l.startCents) / int64(l.bidCount)
			if step < 100 {
				step = 100
			}
			lifetime := time.Duration(24) * time.Hour
			gap := lifetime / time.Duration(l.bidCount+1)
			baseTime := end.Add(-lifetime)
			for j := 0; j < l.bidCount; j++ {
				amount := l.startCents + step*int64(j+1)
				if j == l.bidCount-1 {
					amount = l.currentCents
				}
				bidder := filtered[j%len(filtered)]
				status := "outbid"
				if j == l.bidCount-1 {
					status = "active"
				}
				if _, err := tx.Exec(ctx, `
					INSERT INTO listing_bids (listing_id, bidder_id, amount_cents, status, created_at)
					VALUES ($1, $2, $3, $4, $5)`,
					l.id, bidder, amount, status,
					baseTime.Add(gap*time.Duration(j+1)),
				); err != nil {
					return fmt.Errorf("insert demo bid %d on %s: %w", j, l.id, err)
				}
			}
		}
	}

	return nil
}

// buildDemoListings is a pure function returning the static fixture set.
// Exported as a function (not a const) so tests can iterate over it.
func buildDemoListings() []demoListing {
	out := make([]demoListing, 0, 40)

	// ── Critical: closing in 2..9 minutes (red ribbon) ──────────────
	critical := []demoListing{
		{"00000000-0000-0000-0000-000000009000", "goods-furniture",
			"Eames lounge chair + ottoman, original",
			"https://picsum.photos/id/1015/800/600",
			120000, 18, 287500, 3, 2 * time.Minute},
		{"00000000-0000-0000-0000-000000009001", "goods-electronics",
			"Apple Studio Display 27\" 5K — sealed",
			"https://picsum.photos/id/1015/800/600",
			95000, 14, 142000, 2, 4 * time.Minute},
		{"00000000-0000-0000-0000-000000009002", "goods-tools",
			"Festool TS 75 plunge saw + rail set",
			"https://picsum.photos/id/1015/800/600",
			55000, 9, 78500, 1, 5 * time.Minute},
		{"00000000-0000-0000-0000-000000009003", "goods-collectibles",
			"PSA-graded 1986 Fleer Jordan rookie",
			"https://picsum.photos/id/1015/800/600",
			800000, 22, 1245000, 4, 6 * time.Minute},
		{"00000000-0000-0000-0000-000000009004", "goods-vehicles",
			"2019 Specialized Stumpjumper, size L",
			"https://picsum.photos/id/1015/800/600",
			180000, 11, 245000, 1, 7 * time.Minute},
		{"00000000-0000-0000-0000-000000009005", "goods-sporting",
			"Catlike Mixino road bike helmet",
			"https://picsum.photos/id/1015/800/600",
			6000, 7, 11500, 0, 8 * time.Minute},
		{"00000000-0000-0000-0000-000000009006", "goods-home-garden",
			"Honda HRX217 self-propelled mower",
			"https://picsum.photos/id/1015/800/600",
			35000, 13, 51000, 2, 8 * time.Minute},
		{"00000000-0000-0000-0000-000000009007", "goods-electronics",
			"Sony WH-1000XM5 wireless headphones",
			"https://picsum.photos/id/1015/800/600",
			15000, 10, 24000, 0, 9 * time.Minute},
	}
	out = append(out, critical...)

	// ── Urgent: closing in 12..58 minutes (gold ribbon) ─────────────
	urgent := []demoListing{
		{"00000000-0000-0000-0000-000000009100", "goods-furniture",
			"Herman Miller Aeron, size B",
			"https://picsum.photos/id/1015/800/600",
			40000, 12, 71500, 1, 12 * time.Minute},
		{"00000000-0000-0000-0000-000000009101", "goods-electronics",
			"DJI Mavic 3 Pro w/ Fly More Combo",
			"https://picsum.photos/id/1015/800/600",
			180000, 8, 235000, 0, 14 * time.Minute},
		{"00000000-0000-0000-0000-000000009102", "goods-tools",
			"Snap-on 1/4\" drive socket set, 47pc",
			"https://picsum.photos/id/1015/800/600",
			28000, 7, 39000, 0, 18 * time.Minute},
		{"00000000-0000-0000-0000-000000009103", "goods-clothing",
			"Tom Ford O'Connor 2-piece suit, 42R",
			"https://picsum.photos/id/1015/800/600",
			60000, 5, 78000, 0, 22 * time.Minute},
		{"00000000-0000-0000-0000-000000009104", "goods-collectibles",
			"Sealed Magic the Gathering Beta starter",
			"https://picsum.photos/id/1015/800/600",
			320000, 14, 482000, 2, 25 * time.Minute},
		{"00000000-0000-0000-0000-000000009105", "goods-sporting",
			"Bauer Vapor X3 hockey skates, sz 10",
			"https://picsum.photos/id/1015/800/600",
			18000, 6, 27500, 0, 28 * time.Minute},
		{"00000000-0000-0000-0000-000000009106", "goods-vehicles",
			"4× Pirelli P Zero 245/40R19, ~80%",
			"https://picsum.photos/id/1015/800/600",
			32000, 4, 41000, 0, 31 * time.Minute},
		{"00000000-0000-0000-0000-000000009107", "goods-home-garden",
			"Stihl MS 271 Farm Boss chainsaw",
			"https://picsum.photos/id/1015/800/600",
			22000, 8, 34500, 1, 36 * time.Minute},
		{"00000000-0000-0000-0000-000000009108", "goods-books-media",
			"Lord of the Rings 1st-ed UK box set",
			"https://picsum.photos/id/1015/800/600",
			85000, 9, 132500, 0, 41 * time.Minute},
		{"00000000-0000-0000-0000-000000009109", "goods-furniture",
			"Knoll Saarinen tulip dining table",
			"https://picsum.photos/id/1015/800/600",
			95000, 10, 142000, 1, 47 * time.Minute},
		{"00000000-0000-0000-0000-000000009110", "goods-electronics",
			"Leica Q3 compact camera",
			"https://picsum.photos/id/1015/800/600",
			450000, 5, 542500, 0, 53 * time.Minute},
		{"00000000-0000-0000-0000-000000009111", "goods-tools",
			"Mikita 18V LXT 5-tool combo kit",
			"https://picsum.photos/id/1015/800/600",
			32000, 11, 51000, 0, 58 * time.Minute},
	}
	out = append(out, urgent...)

	// ── Normal: closing in 4..22 hours ──────────────────────────────
	normal := []demoListing{
		{"00000000-0000-0000-0000-000000009200", "goods-furniture",
			"West Elm mid-century sofa, 86\"",
			"https://picsum.photos/id/1015/800/600",
			45000, 4, 56000, 0, 4 * time.Hour},
		{"00000000-0000-0000-0000-000000009201", "goods-electronics",
			"iPad Pro 12.9\" M2 + Magic Keyboard",
			"https://picsum.photos/id/1015/800/600",
			65000, 3, 78500, 0, 5 * time.Hour},
		{"00000000-0000-0000-0000-000000009202", "goods-tools",
			"Husqvarna 450 Rancher chainsaw",
			"https://picsum.photos/id/1015/800/600",
			28000, 2, 33000, 0, 5 * time.Hour},
		{"00000000-0000-0000-0000-000000009203", "goods-clothing",
			"Patagonia Nano Puff jacket, men's L",
			"https://picsum.photos/id/1015/800/600",
			6000, 5, 9500, 0, 6 * time.Hour},
		{"00000000-0000-0000-0000-000000009204", "goods-sporting",
			"Marin Pine Mountain 1, 27.5+, size L",
			"https://picsum.photos/id/1015/800/600",
			62000, 3, 71500, 0, 7 * time.Hour},
		{"00000000-0000-0000-0000-000000009205", "goods-collectibles",
			"Sealed Star Wars Black Series Boba Fett",
			"https://picsum.photos/id/1015/800/600",
			3500, 6, 6500, 0, 7 * time.Hour},
		{"00000000-0000-0000-0000-000000009206", "goods-home-garden",
			"Big Green Egg Large + nest + table",
			"https://picsum.photos/id/1015/800/600",
			85000, 4, 102000, 0, 8 * time.Hour},
		{"00000000-0000-0000-0000-000000009207", "goods-furniture",
			"IKEA Markus office chair, black",
			"https://picsum.photos/id/1015/800/600",
			8000, 1, 9000, 0, 9 * time.Hour},
		{"00000000-0000-0000-0000-000000009208", "goods-electronics",
			"Sonos Arc soundbar + 2× Era 100",
			"https://picsum.photos/id/1015/800/600",
			65000, 2, 73500, 0, 10 * time.Hour},
		{"00000000-0000-0000-0000-000000009209", "goods-vehicles",
			"Yakima HighRoad rooftop bike rack ×2",
			"https://picsum.photos/id/1015/800/600",
			28000, 0, 28000, 0, 11 * time.Hour},
		{"00000000-0000-0000-0000-000000009210", "goods-tools",
			"Bosch GLM 165-25 laser distance tool",
			"https://picsum.photos/id/1015/800/600",
			15000, 0, 15000, 0, 12 * time.Hour},
		{"00000000-0000-0000-0000-000000009211", "goods-books-media",
			"Complete Calvin & Hobbes hardcover set",
			"https://picsum.photos/id/1015/800/600",
			15000, 3, 19500, 0, 13 * time.Hour},
		{"00000000-0000-0000-0000-000000009212", "goods-clothing",
			"Brooks Brothers tuxedo, 40R + extras",
			"https://picsum.photos/id/1015/800/600",
			18000, 2, 22000, 0, 14 * time.Hour},
		{"00000000-0000-0000-0000-000000009213", "goods-sporting",
			"Bowflex SelectTech 552 dumbbells",
			"https://picsum.photos/id/1015/800/600",
			28000, 4, 36500, 0, 15 * time.Hour},
		{"00000000-0000-0000-0000-000000009214", "goods-furniture",
			"Pottery Barn dining hutch, walnut",
			"https://picsum.photos/id/1015/800/600",
			32000, 1, 35000, 0, 16 * time.Hour},
		{"00000000-0000-0000-0000-000000009215", "goods-electronics",
			"Roland TR-8S drum machine",
			"https://picsum.photos/id/1015/800/600",
			52000, 2, 62500, 0, 17 * time.Hour},
		{"00000000-0000-0000-0000-000000009216", "goods-collectibles",
			"Vintage Omega Seamaster, 1968 serviced",
			"https://picsum.photos/id/1015/800/600",
			180000, 5, 218500, 0, 18 * time.Hour},
		{"00000000-0000-0000-0000-000000009217", "goods-home-garden",
			"Toro 22\" Recycler self-propelled mower",
			"https://picsum.photos/id/1015/800/600",
			32000, 0, 32000, 0, 19 * time.Hour},
		{"00000000-0000-0000-0000-000000009218", "goods-tools",
			"Ridgid 18V brushless impact driver",
			"https://picsum.photos/id/1015/800/600",
			12000, 1, 13500, 0, 21 * time.Hour},
		{"00000000-0000-0000-0000-000000009219", "goods-other",
			"Vintage Eames LCW chair, original",
			"https://picsum.photos/id/1015/800/600",
			95000, 6, 132000, 0, 22 * time.Hour},
	}
	out = append(out, normal...)

	return out
}
