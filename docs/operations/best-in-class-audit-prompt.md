# NoMarkup — Best-in-Class Feature Audit Prompt

> Use this when you want to know: "Are we missing anything the leaders
> in our space already have?" Not a self-consistency audit (that's
> `verification-prompt.md`) — a competitive-feature audit.
>
> Output: a checklist with SHIPPED / PARTIAL / MISSING / NOT_APPLICABLE
> for every feature, grouped by surface, plus a prioritized gap list.

---

## The Prompt

Copy everything between the `---` markers into a new agent session.

---

You are doing a competitive feature audit on NoMarkup, a two-sided
marketplace at `/Users/nuclearisotope/Projects/NoMarkup` (branch
`fix/security-audit-2026-04-23`). NoMarkup runs both:
- **Services** (reverse-auction): `/jobs`, `/bids`, `/contracts` — competes with **Thumbtack**, **Angi**, **TaskRabbit**, **Craigslist services**.
- **Goods** (forward-auction): `/marketplace`, `/sell`, `/orders` — competes with **eBay**, **Whatnot**, **StockX**, **Facebook Marketplace**, **OfferUp**, **Craigslist for-sale**.

Your job is to enumerate every feature a best-in-class player in each
space ships, then check whether NoMarkup has it. Do not grade against
NoMarkup's own pitch deck — grade against the competitive frontier.

For every feature below, mark one of:
- **SHIPPED** — implemented and behaves correctly end-to-end. Cite at least one file path + symbol.
- **PARTIAL** — exists but missing critical edges (e.g., handler exists but route not mounted; UI exists but backend not wired). Cite what's there and what's missing.
- **MISSING** — not implemented anywhere. No file path to cite.
- **NOT_APPLICABLE** — explicitly out of scope per pitch (e.g., shipping is v2 by design).

Do NOT mark SHIPPED based on the existence of a file. The behavior must work end-to-end. If you can't verify, mark PARTIAL with what you confirmed and what you couldn't.

Output a single Markdown report at `/tmp/nomarkup-best-in-class.md` with:
1. The full feature checklist (sections below)
2. A **competitive gap matrix** — table with rows = competitors, columns = "We match", "We exceed", "They lead"
3. A **prioritized gap list** of the top 10 MISSING items ranked by:
   - Impact on demo (does the VC walkthrough hit this?)
   - Impact on liquidity (can we launch without it?)
   - Impact on retention (does it bring buyers/sellers back?)
4. A **what we have that they don't** list (our differentiation surface)

---

## Feature Checklist

### A. Live-auction theater (Whatnot, StockX, eBay Live)

This is NoMarkup's claimed wedge. Be thorough.

- [ ] Real-time bid streaming via WebSocket (server pushes new bids without polling)
- [ ] Anonymous spectator mode (watch without bidding)
- [ ] Live spectator/watcher count per listing (the "47 watching" badge)
- [ ] Snipe-extension protection (last-N-second bids extend the deadline)
- [ ] Auction countdown that ticks at 1Hz client-side
- [ ] "Closing soon" / "Closing now" / "Ending now" urgency tiers visible
- [ ] Push/email notification: closing in 60 seconds
- [ ] Push/email notification: closing in 10 minutes
- [ ] Push/email notification: you've been outbid
- [ ] Push/email notification: auction won
- [ ] Live bid history visible during auction (anonymized bidder names)
- [ ] Followable seller / "subscribe to auctions from this user"
- [ ] Replay an ended auction (timeline scrubber of all bids)
- [ ] Live host stream (Whatnot's killer feature — host runs a real-time show, items go up sequentially)

### B. Bidding mechanics (eBay)

- [ ] Min bid increment, scaled by price tier ($1 increments under $50, $5 under $500, etc.)
- [ ] Proxy/auto-bidding ("max I'll pay $200, bid for me")
- [ ] Reserve price (seller's private floor, hidden from buyers)
- [ ] Buy It Now option (skip the auction at a fixed price)
- [ ] Best Offer (buyer counter-proposes, seller accepts/rejects/counters)
- [ ] Bid retraction window (small grace period to undo a bid)
- [ ] Bid history with anonymized usernames
- [ ] Highest-bid-wins tie-breaker (timestamp-based)
- [ ] Outbid alert with one-click re-bid
- [ ] Min bid validation server-side (matches client-side)
- [ ] Self-bidding prevented (sellers can't bid on their own listings)
- [ ] Bid bond / pre-auth charge on first-time bidders (anti-fake-bid)

### C. Trust & safety (StockX, eBay, Whatnot)

- [ ] Identity verification / KYC (ID document upload + check)
- [ ] Seller trust score / tier system (1-5 stars or numeric)
- [ ] Buyer trust score (cross-side reputation)
- [ ] Trust transfer between services and goods surfaces (your claim — verify)
- [ ] Stripe escrow on goods transactions
- [ ] Stripe escrow on services contracts
- [ ] Auto-release of escrow on dual confirmation
- [ ] Dispute filing flow (within X days of pickup/delivery)
- [ ] Admin dispute resolution UI
- [ ] Fraud detection: bidding velocity + geo mismatch
- [ ] Fraud detection: fingerprint clustering (multi-account ring detection)
- [ ] Fraud detection: payment method overlap detection
- [ ] Account takeover protection (suspicious-login alerts, 2FA)
- [ ] Two-factor auth (TOTP or SMS)
- [ ] Bid bond forfeiture on fraud
- [ ] Shadow-ban / cool-down for repeat no-shows
- [ ] Buyer protection program (refund if item not as described)
- [ ] Verified authentication (StockX-style) for high-value goods (deferred?)
- [ ] Condition grading (StockX/PWCC-style) for collectibles
- [ ] Prohibited items list + auto-flag on listing creation
- [ ] Listing reports (anonymous flag → admin queue)
- [ ] Auto-hide on N reports threshold

### D. Discovery & search (eBay, Marketplace, OfferUp)

- [ ] Full-text search across title + description
- [ ] Geo-filtered search (radius from zip)
- [ ] Category browse with subcategories
- [ ] Faceted search (filter by price, condition, distance, ending soon)
- [ ] Sort: relevance, ending soonest, lowest price, highest price, newest, distance
- [ ] Saved searches with email/push alerts on new matches
- [ ] Price drop alerts on watched listings
- [ ] "Similar items" / related listings on detail page
- [ ] Recently viewed
- [ ] Trending / hot now
- [ ] Featured listings (paid promotion?)
- [ ] Photo zoom / lightbox
- [ ] Image-based search ("find listings like this photo")
- [ ] Map view of nearby listings (Marketplace style)
- [ ] Pagination + infinite scroll
- [ ] Search-as-you-type / autocomplete
- [ ] Spell correction / "did you mean..."

### E. Posting flow (all)

- [ ] Multi-photo upload with drag-to-reorder
- [ ] Photo crop / rotate
- [ ] Video clip upload (short loops)
- [ ] AI auto-fill from photo (category, title suggestions)
- [ ] AI price suggestion based on comparable sales
- [ ] Category suggestion as user types title
- [ ] Draft save (work-in-progress posts)
- [ ] Bulk-listing tool for power sellers
- [ ] Listing templates (reuse fields from prior posts)
- [ ] Cross-post to other sites (eBay/Marketplace via API)
- [ ] Photo guidelines / quality scoring
- [ ] Required fields for category (e.g., size for clothing)
- [ ] Mobile camera direct-to-listing flow
- [ ] Address autocomplete via geocoder

### F. Communication (Craigslist relay, Marketplace chat)

- [ ] In-app chat between buyer and seller
- [ ] Anonymous email relay (PII never exposed)
- [ ] Phone-number anonymization (Twilio-style proxy)
- [ ] Read receipts
- [ ] Typing indicators
- [ ] Image attachments in chat
- [ ] Voice clip attachments
- [ ] Quick-reply templates ("Is this still available?")
- [ ] Inline offers in chat (counter-bid via DM)
- [ ] Block / report user
- [ ] Chat moderation (flag profanity, harassment)
- [ ] Push notification on new chat message
- [ ] Chat history persistence + search

### G. Payments & payouts (Stripe Connect)

- [ ] Card payments (Stripe)
- [ ] Apple Pay
- [ ] Google Pay
- [ ] ACH/bank transfer for high-value
- [ ] Multi-currency (deferred?)
- [ ] Saved payment methods
- [ ] Stripe Connect Express seller onboarding
- [ ] Auto-payout schedule (daily / weekly / on-demand)
- [ ] Instant payout option (with fee)
- [ ] Refunds + partial refunds
- [ ] Chargeback handling
- [ ] Sales tax collection where required (Avalara/TaxJar)
- [ ] 1099-K reporting (US sellers > threshold)
- [ ] Idempotency keys on all payment mutations
- [ ] Stripe webhook signature verification

### H. Services-specific (Thumbtack, Angi, TaskRabbit)

- [ ] Pre-quote questions (homeowner answers before providers see job)
- [ ] Calendar/scheduling integration (Google Calendar, iCal)
- [ ] License + insurance verification badges
- [ ] Background check (third-party)
- [ ] Service area maps (which zips a provider serves)
- [ ] Quote templates (provider's reusable boilerplate)
- [ ] Lead pricing tiers (Thumbtack model — keep or skip?)
- [ ] Auction-format reverse bidding (your wedge — verify)
- [ ] Same-day booking
- [ ] Recurring jobs (lawn care, cleaning)
- [ ] Provider portfolio (before/after photos)
- [ ] Hourly vs flat-rate pricing
- [ ] Tip / gratuity flow
- [ ] Provider responsiveness score (median response time)

### I. Goods-specific local-pickup (OfferUp, Marketplace)

- [ ] Pickup-only enforcement at radius (your claim — 25mi PostGIS)
- [ ] Pickup confirmation flow (selfie + signed code)
- [ ] Public meetup spots map (police-station-safe locations)
- [ ] Buyer/seller pickup ETA in-app
- [ ] No-show tracking + penalties
- [ ] Item handoff verification (mutual confirm releases escrow)
- [ ] Photo at handoff (proof of condition)
- [ ] Pickup window scheduling (windows, not exact times)
- [ ] Optional shipping with carrier integration (deferred?)
- [ ] Buyer protection on damaged-on-pickup

### J. Mobile experience

- [ ] Native iOS app
- [ ] Native Android app
- [ ] Push notifications (APNs + FCM)
- [ ] Geolocation services (location-based browse)
- [ ] Camera-direct listing capture
- [ ] Mobile-web responsive (320px minimum width per CLAUDE.md §4)
- [ ] PWA installable
- [ ] Offline draft creation
- [ ] Biometric login (Face ID / Touch ID)
- [ ] App-clip / instant-app for listing detail

### K. Power-seller / power-buyer tools

- [ ] Seller dashboard with revenue/views/conversion
- [ ] Performance metrics (sell-through rate, avg sale price)
- [ ] Selling limits / velocity limits for new sellers
- [ ] Top-rated seller program (badge, perks)
- [ ] Promoted listings (paid placement boost)
- [ ] Auction analytics replay (timeline of bids, who joined when)
- [ ] CSV export of sales history (for tax)
- [ ] Inventory management (track stock for multi-quantity)

### L. Buyer-side power tools

- [ ] Watchlist (favorite without bidding)
- [ ] Saved searches with alert frequency control
- [ ] Bid history across all auctions
- [ ] "My active bids" dashboard
- [ ] Won-auction history
- [ ] Spending tracker
- [ ] Wallet credit / store balance

### M. Admin / trust & safety operations

- [ ] Moderation queue for reported listings
- [ ] Manual review workflow (assignee, status, decision log)
- [ ] Auto-hide on threshold reports
- [ ] Bulk listing actions (suspend, hide, restore)
- [ ] User suspension / shadow-ban tooling
- [ ] Refund admin tools
- [ ] Dispute admin UI
- [ ] Fraud ring visualization (graph of related accounts)
- [ ] Audit log (who did what when)
- [ ] Customer support inbox

### N. Compliance & legal

- [ ] GDPR right to erasure (30-day grace, audit log)
- [ ] CCPA "do not sell" opt-out
- [ ] 1099-K tax-form generation
- [ ] Sales tax collection where required
- [ ] Anti-money-laundering screening (high-value)
- [ ] Anti-discrimination guardrails (no demographic filters on housing/employment)
- [ ] Age verification (alcohol, weapons, etc.)
- [ ] Prohibited-items list with category-aware enforcement
- [ ] Terms of service acceptance log
- [ ] Cookie consent (EU)
- [ ] Accessibility: WCAG 2.2 AA across all flows

### O. Performance & infrastructure

- [ ] Sub-100ms search p99
- [ ] Sub-1ms bid processing p99
- [ ] Sub-50ms full-text search via Meilisearch
- [ ] Mobile-optimized images (WebP / AVIF)
- [ ] CDN for static assets
- [ ] Skeleton loading states (no spinners)
- [ ] Optimistic UI on bid placement
- [ ] Real-time bid update without page refresh
- [ ] Horizontal scaling (stateless services)
- [ ] Distributed tracing (OpenTelemetry across services)
- [ ] Structured JSON logging
- [ ] Prometheus metrics
- [ ] Sentry error tracking
- [ ] Backup + disaster recovery runbook
- [ ] Multi-region deployment (deferred?)

### P. Onboarding & growth

- [ ] OAuth login (Google, Apple, Facebook)
- [ ] Email + password
- [ ] Phone-number-only signup
- [ ] First-listing free / promotional credit
- [ ] Referral program (give X get X)
- [ ] Welcome email sequence
- [ ] Empty-state nudges ("post your first listing")
- [ ] Re-engagement email (you have 3 saved searches — see new matches)
- [ ] Post-transaction NPS survey
- [ ] Community forum / subreddit

### Q. Differentiation surface (NoMarkup-specific)

These are NoMarkup's claimed wedges. Verify each is real and working.

- [ ] **Two-surface single-identity** — same trust score across goods + services
- [ ] **Reverse-auction services** — providers bid the price down (rare in market)
- [ ] **Forward-auction goods with local pickup** — Whatnot-style on Craigslist/Marketplace base
- [ ] **Sports-scoreboard homepage** — bucketed by closing time, not categories
- [ ] **Live spectator counts** — "47 watching" social proof
- [ ] **Snipe-extension** — anti-sniping fairness (Whatnot has, eBay doesn't)
- [ ] **Cross-vertical trust loop** — service quality earns goods buyer-protection benefits

---

## Output Format

Write the report to `/tmp/nomarkup-best-in-class.md` with this structure:

```markdown
# NoMarkup Best-in-Class Audit — {ISO date}

**Branch:** ...
**Commit:** ...

## Summary

{2-3 sentences. Where do we have parity? Where are we ahead? Where do
we have gaps that block credibility against the named competitors?}

## Section Results

### A. Live-auction theater
| Feature | Status | Evidence |
| ... | SHIPPED/PARTIAL/MISSING/N/A | path:line + behavior note |

(repeat per section A-Q)

## Competitive Gap Matrix

| Competitor | We match | We exceed | They lead |
|------------|----------|-----------|-----------|
| Whatnot    | ...      | ...       | ...       |
| StockX     | ...      | ...       | ...       |
| eBay       | ...      | ...       | ...       |
| Marketplace| ...      | ...       | ...       |
| OfferUp    | ...      | ...       | ...       |
| Thumbtack  | ...      | ...       | ...       |
| TaskRabbit | ...      | ...       | ...       |

## Top 10 Gaps to Close (Prioritized)

1. **{Feature}** — Impact: demo/liquidity/retention. Recommended scope: ...
2. ...

## What We Have That They Don't

- ...
```

Be specific. "We have Y" without a file path means nothing. "Whatnot has X but
we don't" without naming the file we'd add to ship X means nothing.

---

## How to use this prompt

**Option A — fresh Claude session:**
```
/clear
Read docs/operations/best-in-class-audit-prompt.md and execute the audit.
Produce /tmp/nomarkup-best-in-class.md.
```

**Option B — agent (recommended for thoroughness):**
```
Agent({
  subagent_type: "general-purpose",
  description: "Best-in-class feature audit",
  prompt: "Read /Users/nuclearisotope/Projects/NoMarkup/docs/operations/best-in-class-audit-prompt.md and execute the audit. Mark every feature SHIPPED/PARTIAL/MISSING/NOT_APPLICABLE with file-path evidence. Write /tmp/nomarkup-best-in-class.md. Verify behavior end-to-end where possible — do not grade SHIPPED on file existence alone."
})
```

**Comparison with `verification-prompt.md`:**

| | `verification-prompt.md` | `best-in-class-audit-prompt.md` |
|---|---|---|
| Question | Does the codebase deliver what its own pitch claims? | Does the codebase have what the leaders ship? |
| Frame | Self-consistency | Competitive parity |
| Output | READY/NOT READY | Gap-list + prioritized roadmap |
| When to run | Before a VC demo | Before a pre-launch competitive review |
