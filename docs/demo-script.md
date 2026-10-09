# NoMarkup — Live Demo Script

> 8-minute walkthrough. Cuts the static-listings instinct off at the
> knees in the first 30 seconds.
>
> Before you start: open three browser tabs.
> 1. `/marketplace` (the scoreboard — desktop)
> 2. `/marketplace/[demo-listing-id]` (a listing closing in <2 minutes)
> 3. `/marketplace/[demo-listing-id]` again, in a private window logged in as a second buyer

---

## Minute 0:00–0:30 — The Wedge in the First Frame

Open Tab 1. Land on `/marketplace`.

> "Every marketplace you've used in the last 25 years opens with a list
> of things to buy. Pinterest grid, Craigslist links, Marketplace tiles.
> Notice this isn't that."

Point at the urgency strip. Read the numbers off the screen.

> "Seven auctions closing in the next hour. 184 people watching. 42 live
> bids. This is a sports scoreboard. We don't open with a catalog
> because catalogs aren't urgent. Auctions are."

## Minute 0:30–2:00 — Scroll the Scoreboard

Scroll the closing-now section.

> "Red ribbons mean under 10 minutes. Gold means under an hour. The
> countdown ticks every second. That number, '47 watching', updates
> live as people open the page. Right now, this credenza has 23 people
> on it. Two minutes ago it had 19."

Point at a snipe-extension badge.

> "+30s ×2 means somebody bid in the final minute and the auction
> auto-extended 30 seconds. Twice. We don't let snipers steal auctions
> in the last second — Whatnot does this, eBay didn't, and that's why
> Whatnot won."

## Minute 2:00–4:00 — The Forward Auction (Goods)

Click into a closing-soon listing.

> "Public bid history. Anonymous bidder IDs to protect privacy, but
> everyone can see how the price discovered itself. This isn't a
> haggling DM thread. The market did this in front of 47 people."

Show the watcher count, the location pin, the photo gallery.

> "Local pickup only. 25-mile radius from your zip code. We enforce that
> at the service layer with PostGIS — buyers literally can't bid on
> auctions outside their radius. No shipping in v1. The trust transfer
> hinges on physical handoff."

Place a bid from Tab 2.

> "Watch the scoreboard tab over there. Bid placed. The current bid
> jumped, bid count went up, the watcher count notification fires for
> everyone watching the listing. That's a WebSocket — real-time price
> discovery is the product."

## Minute 4:00–5:30 — The Reverse Auction (Services)

Switch to `/jobs`.

> "Same auction format, opposite direction. Customer posts a plumbing
> job. Three providers compete to bid the price *down*, not up. Same
> countdown. Same watchers. Same snipe extension."

> "Thumbtack charges contractors $80 a lead. The contractor doesn't
> know if the homeowner is shopping or pricing or wasting time. We
> flip it: contractors only spend their bid when the customer accepts.
> Auction transparency means homeowners stop overpaying. Both sides win."

## Minute 5:30–6:30 — Trust That Compounds

Open a provider profile.

> "One identity across both surfaces. This contractor has a 4.7 trust
> score from 23 service jobs. They also sold a Milwaukee tool kit on
> the goods marketplace last month — closed clean, escrow released.
> That history shows up on every future listing they post, in either
> direction. The buyer who buys their tools today is also the customer
> who hires them tomorrow."

> "Single-vertical competitors can't build this. Thumbtack doesn't
> know if you're a good neighbor. Marketplace doesn't know if you're a
> reliable plumber. We do."

## Minute 6:30–7:30 — The Stack

Brief, technical.

> "This is shipped, not roadmap. Next.js 15 web. Go gateway and
> microservices on gRPC. Rust engines for bid processing (sub-1ms p99),
> fraud heuristics, and trust scoring. Postgres with PostGIS for geo.
> Stripe Connect Express for escrow. libsodium PII encryption. GDPR
> erasure pipeline. 3,800 unit tests passing. Security audit complete."

> "We didn't build a marketing site that calls itself a marketplace.
> The platform is here."

## Minute 7:30–8:00 — The Ask

> "Pre-seed round, $1.5-2M, Austin pilot. Two demand-side hires,
> regulatory counsel for goods escrow in 50 states, 12-18 months
> runway to Series A milestones."

> "Questions?"

---

## Demo Failure Modes — Have Backups

**Internet drops:** Switch to localhost. Same data.

**Live bid doesn't propagate in <500ms:** Fall back to "in production
this hits sub-100ms — let me show you the load test." Open
`docs/operations/scaling-blockers.md`.

**Auction has no bids:** Pre-seed by placing 2-3 bids 15 minutes before
the demo from a third browser. Re-seed at the start of the day.

**Watcher count looks low:** Open 3 tabs to the same listing. The count
updates per page open, decays after 30s of inactivity.

**VC asks "what's the bear case":** Direct answer in `docs/investor-faq.md`.

## Pre-Demo Checklist (T-30 minutes)

```bash
# 1. Verify the scoreboard renders
curl -sf http://localhost:3000/marketplace | grep -q "Live Marketplace" && echo "OK"

# 2. Verify there are listings closing in <10 min
psql $DATABASE_URL -c "
  SELECT count(*) FROM listings
  WHERE status = 'active' AND auction_ends_at < now() + interval '10 minutes'"

# 3. Verify WebSocket bid stream is up
curl -sf http://localhost:3000/api/v1/health/ws

# 4. Pre-place 2-3 bids on the demo listing
# (use the seed script's bidded-listing fixture)

# 5. Open three browser tabs (see top of doc)
```
