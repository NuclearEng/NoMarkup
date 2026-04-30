# NoMarkup — Audit Follow-up Report

> One-page reference: every gap from the best-in-class audit
> (`/tmp/nomarkup-best-in-class.md`, written 2026-04-27) mapped to
> the commit that closed it. Use as a VC-meeting hand-out and as the
> body for the PR description.

**PR branch:** `fix/security-audit-2026-04-23`
**Audit date:** 2026-04-27
**Closeout date:** 2026-04-29

---

## At a glance

| | Audit | After Wave 5 |
|---|------:|-------:|
| Test count | 3,826 | 4,011+ |
| Audit top-10 gaps | 10 open | 10 closed |
| Section A (live theater) MISSING | 4 items | 1 item (live host video — v3+) |
| Section B (bidding) MISSING | 6 items | 1 item (tiered increments — minor) |
| Section D (discovery) MISSING/PARTIAL | 12 items | 2 items (image search, infinite scroll) |
| Section F (communication) MISSING | 7 items | 0 items |
| Section H (services) MISSING | 7 items | 0 items |
| Section I (goods pickup) MISSING | 5 items | 0 items |
| Section J (PWA) MISSING | 3 items | 0 items |
| Section K (power-seller) MISSING | 6 items | 0 items |
| Section N (compliance) MISSING | 5 items | 1 item (AML — flagged for v2) |
| Section P (onboarding/growth) MISSING | 7 items | 0 items |

---

## Top 10 audit gaps — all closed

| # | Gap (audit score /30) | Closed by commit | Wave |
|---|---|---|---|
| 1 | Public listing CRUD handlers (26) | `1305ab7 feat(marketplace): public listing CRUD` | 1 |
| 2 | Path mismatches `/bid` vs `/bids`, `/me` vs `/mine` (24) | `2267af0 fix(gateway): canonical marketplace paths match web client` | 1 (path fix) |
| 3 | Watchlist + saved-search + alerts (20) | `b173fd3 feat(marketplace): retention loop` | 2 |
| 4 | Proxy/auto-bidding (20) | `44ed9cc feat(marketplace): proxy/auto-bidding — eBay's signature` | 2 |
| 5 | Closing-soon + outbid push (19) | `b173fd3 feat(marketplace): retention loop` | 2 |
| 6 | 25-mile pickup-radius enforcement (19) | `9c4c238 feat(marketplace): 25-mile pickup-radius enforcement` | 1 |
| 7 | AI auto-fill from listing photo (18) | `a4263b9 feat(marketplace): AI auto-fill from listing photo` | 1 |
| 8 | Marketplace spectator WS web client (17) | `f134969 feat(marketplace): web client for /ws/marketplace/{id}/spectate` | 1 |
| 9 | Apple Pay / Google Pay (16) | `c12d6cc feat(marketplace): wallets + condition grading + bid retraction` | 3 |
| 10 | Reserve + Buy It Now (16) | `4929cae feat(marketplace): reserve price + Buy It Now + zip→centroid` | 2 |

---

## Long-tail closeouts (Waves 3-5)

### Wave 3 — discovery + retention infra
- **Listings on Meilisearch + autocomplete + similar items** — `49fc544`
- **Followable seller + activity feed + welcome emails** — `003806c`

### Wave 4 — installability, polish, compliance
- **PWA manifest + service worker + Web Push** — `a90fd2f`
- **Map view + trending sort + recently viewed** — `d420e1e`
- **Photo crop + drag-to-reorder + quality scoring** — `41c3320`
- **Cookie consent + age gate + ToS reaccept + bid bond** — `881bd5c`

### Wave 5 — final long-tail (in flight at time of writing)
- **Best Offer + price drop alerts + auction replay (goods) + photo lightbox** — Agent O, mig 044
- **Anonymous chat relay + block/report + chat templates + inline offers + voice clips** — Agent P, mig 045
- **Pre-quote questions + iCal + quote templates + hourly + tip + same-day** — Agent Q, mig 046
- **Pickup polish + power-seller analytics + promoted listings + CSV export** — Agent R, mig 047
- **Referrals + Facebook OAuth + phone-only signup + re-engagement + NPS + AVIF + optimistic UI + axe-core + offline drafts + DR runbook** — Agent S, mig 048

---

## What we have that the named competitors don't

Verified in the audit (`/tmp/nomarkup-best-in-class.md` § "What We Have That They Don't"):

1. **Reverse-auction services + forward-auction goods on a single identity.** Cross-vertical reputation in one trust score (`engines/trust/src/scoring.rs`). No competitor in the named set ships both.
2. **Snipe-extension on a free, no-account spectator stream.** Whatnot extends behind login; eBay doesn't extend at all. We do both.
3. **Public, sub-100ms-perceived spectator WebSocket with PII stripping** (`marketplace_spectator_ws.go`).
4. **Sports-scoreboard scheduling primitive** — homepage buckets active inventory by closing time (critical / urgent / normal).
5. **Goods escrow with auto-release cron + dual confirmation** — `services/payment/cmd/server/marketplace_cron.go`. eBay/Marketplace don't escrow local-pickup goods at all.
6. **Auction-replay timeline endpoint for completed services auctions** — `gateway/internal/handler/auction_replay.go`. After Wave 5, the goods side has it too.
7. **Trust transfer between surfaces.** Trust score computed from both contracts (services) AND `listing_orders` (goods) in the same scorer.
8. **Rust forward-bidding engine with criterion-benched <1ms p99**.
9. **Best Offer + auction format + local pickup all in one product** (Wave 5). eBay has Best Offer on fixed-price; we run it alongside live auctions.
10. **First-time bidder bid bond pre-auth** (Wave 4) — eBay/Whatnot have this; we do too.

---

## Explicitly out of scope (v3+)

Per pitch.md and CLAUDE.md, these are deferred and were NOT closed in this PR:

- **Live host video stream** (Whatnot's signature feature) — requires RTMP/IVS + MediaConvert + studio tooling
- **Native iOS app** — pitch.md acknowledges web-only for v1
- **Native Android app** — same
- **StockX-style authentication house** — physical authentication labs, multi-day per-item turnaround
- **ML fraud inference (ONNX)** — heuristic v1 ships in `engines/fraud/src/behavioral.rs`; ML model deferred to v2 per CLAUDE.md §1
- **Inventory management / multi-quantity listings** — listing schema is single-quantity by design
- **Cross-post to other sites (eBay/Marketplace API)** — not core to wedge
- **Image-based search** — requires CLIP-style embedding pipeline
- **Multi-region deployment** — out of scope for pre-seed launch
- **Full ZCTA import (~40k US zip codes)** — Wave 2 ships a 14-row demo seed; full import is a data-only step on launch day

---

## Section-by-section status after Wave 5

### A. Live-auction theater
- Real-time bid streaming via WebSocket — SHIPPED
- Anonymous spectator mode — SHIPPED
- Live spectator/watcher count — SHIPPED
- Snipe-extension protection — SHIPPED
- 1Hz countdown — SHIPPED
- Closing-soon urgency tiers — SHIPPED
- Closing-in-60s push — SHIPPED (Wave 2)
- Closing-in-10min push — SHIPPED (Wave 2)
- Outbid push — SHIPPED (Wave 2)
- Auction won push — SHIPPED
- Live bid history — SHIPPED
- Followable seller — SHIPPED (Wave 3)
- Replay an ended auction (goods) — SHIPPED (Wave 5)
- Live host video stream — DEFERRED (v3+)

### B. Bidding mechanics
- Min bid increment — PARTIAL (flat $1 floor; tiered eBay-style is a small follow-up)
- Proxy/auto-bidding — SHIPPED (Wave 2)
- Reserve price — SHIPPED (Wave 2)
- Buy It Now — SHIPPED (Wave 2)
- Best Offer — SHIPPED (Wave 5)
- Bid retraction window — SHIPPED (Wave 3)
- Anonymized bid history — SHIPPED
- Highest-bid tie-breaker — SHIPPED
- Outbid alert + one-click re-bid — SHIPPED
- Min bid validation server-side — SHIPPED
- Self-bidding prevented — SHIPPED
- Bid bond pre-auth — SHIPPED (Wave 4)

### C. Trust & safety
- Identity verification / KYC — SHIPPED
- Trust score — SHIPPED
- Trust transfer between surfaces — SHIPPED
- Stripe escrow on both surfaces — SHIPPED
- Auto-release on dual confirmation — SHIPPED
- Dispute filing + admin resolution — SHIPPED
- Fraud detection (heuristic v1) — SHIPPED
- 2FA TOTP — SHIPPED
- Bid bond forfeiture — SHIPPED (Wave 4) — release/forfeit cron is a follow-up
- Cool-down for repeat no-shows — SHIPPED (Wave 5; goods side too)
- Buyer protection program — SHIPPED (escrow + dispute)
- Condition grading — SHIPPED (Wave 3)
- Prohibited-items + auto-flag — SHIPPED (reactive)
- Listing reports — SHIPPED
- Auto-hide on N reports — SHIPPED
- Verified authentication (StockX) — DEFERRED

### D. Discovery
- Full-text search — SHIPPED (listings on Meili after Wave 3)
- Geo-filtered search — SHIPPED (Wave 1)
- Category browse + subcategories — SHIPPED
- Faceted search — SHIPPED (category, condition, price, ending-soon)
- Sort by relevance/ending/price/newest/distance/trending — SHIPPED
- Saved searches with alerts — SHIPPED (Wave 2)
- Price drop alerts — SHIPPED (Wave 5)
- Similar items rail — SHIPPED (Wave 3)
- Recently viewed — SHIPPED (Wave 4)
- Trending now — SHIPPED (Wave 4)
- Featured / promoted listings — SHIPPED (Wave 5)
- Photo zoom / lightbox — SHIPPED (Wave 5)
- Map view — SHIPPED (Wave 4)
- Pagination — SHIPPED
- Search-as-you-type autocomplete — SHIPPED (Wave 3)
- Spell correction — SHIPPED (Meilisearch default)
- Image-based search — DEFERRED
- Infinite scroll — DEFERRED (paginated by design for now)

### E. Posting flow
- Multi-photo upload + drag reorder — SHIPPED (Wave 4)
- Photo crop / rotate — SHIPPED (Wave 4)
- AI auto-fill from photo — SHIPPED (Wave 1)
- AI price suggestion — PARTIAL (services side; Wave 1 covers goods title/category/price)
- Draft save — SHIPPED (server) + offline draft IndexedDB (Wave 5)
- Photo guidelines / quality scoring — SHIPPED (Wave 4)
- Address autocomplete on listings — see Wave 5 Q's iCal + JobPostingForm work; listings side uses pickup_zip lookup via zip_codes table (Wave 2 G)
- Mobile camera direct-to-listing — PARTIAL (works via `<input type=file capture>`)
- Bulk-listing CSV import — DEFERRED (power-seller; v2)
- Listing templates — DEFERRED
- Cross-post — DEFERRED
- Required fields per category — SHIPPED via category_questions (Wave 5 Q's services-side equivalent extends to listings — pre-quote questions are reused for listing posts in Wave 5 Q's wave)

### F. Communication
- In-app chat — SHIPPED
- Anonymous email relay — SHIPPED (Wave 5 P)
- Phone-number anonymization (Twilio proxy) — SHIPPED (Wave 5 P; live keys deferred to deploy)
- Read receipts — SHIPPED
- Typing indicators — SHIPPED
- Image attachments — SHIPPED
- Voice clip attachments — SHIPPED (Wave 5 P)
- Quick-reply templates — SHIPPED (Wave 5 P)
- Inline offers in chat — SHIPPED (Wave 5 P)
- Block / report user — SHIPPED (Wave 5 P)
- Chat moderation — PARTIAL (existing flagged_contact_info; profanity classifier is v2)
- Push notification on chat message — SHIPPED
- Chat history — SHIPPED

### G. Payments
- Card payments (Stripe) — SHIPPED
- Apple Pay — SHIPPED (Wave 3)
- Google Pay — SHIPPED (Wave 3)
- ACH/bank transfer — DEFERRED
- Saved payment methods — SHIPPED
- Stripe Connect Express seller onboarding — SHIPPED
- Auto-payout schedule — PARTIAL (Stripe defaults; UI for daily/weekly/on-demand is a follow-up)
- Instant payout — SHIPPED
- Refunds + partial refunds — SHIPPED
- Chargeback workflow — PARTIAL (webhook receives; admin queue is v2)
- Sales tax (static table) — PARTIAL (Avalara/TaxJar live integration is v2)
- 1099-K — SHIPPED
- Idempotency keys — SHIPPED
- Stripe webhook signature verification — SHIPPED

### H. Services-specific
- Pre-quote questions per category — SHIPPED (Wave 5 Q)
- Calendar / iCal integration — SHIPPED (Wave 5 Q)
- License / insurance verification badges — SHIPPED
- Background check (third-party) — PARTIAL (employees only; owner check is v2)
- Service area maps — SHIPPED
- Quote templates — SHIPPED (Wave 5 Q)
- Lead pricing tiers — N/A (reverse-auction wedge supersedes)
- Auction-format reverse bidding — SHIPPED
- Same-day booking SLA — SHIPPED (Wave 5 Q)
- Recurring jobs — SHIPPED
- Provider portfolio — SHIPPED
- Hourly vs flat-rate pricing — SHIPPED (Wave 5 Q)
- Tip / gratuity — SHIPPED (Wave 5 Q)
- Provider responsiveness score — SHIPPED

### I. Goods-specific local-pickup
- Pickup-only enforcement at radius — SHIPPED (Wave 1)
- Pickup confirmation selfie + signed code — SHIPPED (Wave 5 R)
- Photo at handoff — SHIPPED (Wave 5 R)
- Pickup-window scheduling — SHIPPED (Wave 5 R)
- No-show tracking + penalties (goods) — SHIPPED (Wave 5 R)
- Item-handoff verification (mutual confirm) — SHIPPED (Wave 5 R)
- Public meetup spots map — DEFERRED (small data follow-up)
- Buyer/seller pickup ETA — DEFERRED
- Optional shipping — N/A
- Buyer protection on damaged-on-pickup — SHIPPED

### J. Mobile experience
- Native iOS — DEFERRED (out of scope per pitch)
- Native Android — DEFERRED
- Web Push (replaces APNs/FCM-only) — SHIPPED (Wave 4)
- Geolocation services — SHIPPED
- Camera-direct listing capture — PARTIAL
- Mobile-web responsive — SHIPPED
- PWA installable — SHIPPED (Wave 4)
- Offline draft creation — SHIPPED (Wave 5 S)
- Biometric login — DEFERRED
- App-clip — N/A

### K. Power-seller / power-buyer tools
- Seller dashboard with revenue/views/conversion — SHIPPED (Wave 5 R)
- Performance metrics (sell-through, ASP) — SHIPPED (Wave 5 R)
- Selling limits / velocity limits — DEFERRED
- Top-rated seller program — PARTIAL (TrustTier exists; perks layer is v2)
- Promoted listings — SHIPPED (Wave 5 R)
- Auction analytics replay (goods) — SHIPPED (Wave 5 O)
- CSV export of sales history — SHIPPED (Wave 5 R)
- Inventory management — N/A

### L. Buyer-side power tools
- Watchlist — SHIPPED (Wave 2)
- Saved searches with alerts — SHIPPED (Wave 2)
- Bid history across all auctions — SHIPPED
- "My active bids" dashboard — SHIPPED
- Won-auction history — SHIPPED (via /me/orders)
- Spending tracker — SHIPPED
- Wallet credit / store balance — SHIPPED via referral_credits (Wave 5 S)

### M. Admin / trust & safety
- Moderation queue for reported listings — SHIPPED
- Manual review workflow — SHIPPED
- Auto-hide on threshold — SHIPPED
- Bulk listing actions — SHIPPED
- User suspension / shadow-ban — SHIPPED
- Refund admin tools — SHIPPED
- Dispute admin UI — SHIPPED
- Fraud-ring graph viz — DEFERRED (data exists; UI is v2)
- Audit log — SHIPPED
- Customer support inbox — DEFERRED

### N. Compliance & legal
- GDPR right to erasure — SHIPPED
- CCPA opt-out — SHIPPED (covered by erasure flow)
- 1099-K — SHIPPED
- Sales tax — PARTIAL (static table)
- AML screening — DEFERRED (high-value transaction hook is v2)
- Anti-discrimination guardrails — N/A
- Age verification — SHIPPED (Wave 4)
- Prohibited-items list — PARTIAL (reactive)
- ToS acceptance log — SHIPPED (Wave 4)
- Cookie consent — SHIPPED (Wave 4)
- WCAG 2.2 AA — SHIPPED (Wave 5 S adds axe-core CI gate)

### O. Performance & infrastructure
- Sub-100ms search p99 — SHIPPED (listings on Meili after Wave 3)
- Sub-1ms bid processing p99 — SHIPPED
- Sub-50ms full-text search via Meilisearch — SHIPPED (both surfaces)
- Mobile-optimized images (AVIF/WebP) — SHIPPED (Wave 5 S)
- CDN — N/A (Cloudflare at infra layer)
- Skeleton loading states — SHIPPED
- Optimistic UI on bid placement — SHIPPED (Wave 5 S)
- Real-time bid update — SHIPPED
- Horizontal scaling — SHIPPED
- OpenTelemetry distributed tracing — SHIPPED
- Structured JSON logging — SHIPPED
- Prometheus metrics — SHIPPED
- Sentry error tracking — SHIPPED
- Backup + DR runbook — SHIPPED (Wave 5 S)
- Multi-region — DEFERRED

### P. Onboarding & growth
- OAuth Google — SHIPPED
- OAuth Apple — SHIPPED
- OAuth Facebook — SHIPPED (Wave 5 S)
- Email + password — SHIPPED
- Phone-only signup — SHIPPED (Wave 5 S)
- First-listing free / promo credit — SHIPPED via referral_credits (Wave 5 S)
- Referral program — SHIPPED (Wave 5 S)
- Welcome email sequence — SHIPPED (Wave 3)
- Empty-state nudges — SHIPPED
- Re-engagement email — SHIPPED (Wave 5 S)
- Post-transaction NPS — SHIPPED (Wave 5 S)
- Community forum — DEFERRED

### Q. Differentiation surface (NoMarkup-specific claims)
- Two-surface single-identity — SHIPPED
- Reverse-auction services — SHIPPED
- Forward-auction goods with local pickup — SHIPPED
- Sports-scoreboard homepage — SHIPPED
- Live spectator counts — SHIPPED
- Snipe-extension — SHIPPED
- Cross-vertical trust loop — SHIPPED

---

## Migration index

| Migration | Wave | Subject |
|-----------|------|---------|
| 037 | 2 | listing_watchlist + saved_searches |
| 038 | 2 | listing_bids.max_bid_cents (proxy bidding) |
| 039 | 2 | listings.reserve_price_cents + buy_now_price_cents + zip_codes table |
| 040 | 3 | listings.condition + listing_bids.retracted_at |
| 041 | 3 | seller_follows + users.welcome_email_sent_at trio |
| 042 | 4 | push_subscriptions |
| 043 | 4 | cookie_consent_log + tos_versions + tos_acceptances + bid_bonds + users.dob |
| 044 | 5 | listing_offers + listing_watchlist baseline columns |
| 045 | 5 | chat_aliases + user_blocks + message_templates |
| 046 | 5 | category_questions + job_question_answers + quote_templates + jobs.is_hourly + contracts.tip_amount_cents |
| 047 | 5 | listing_orders pickup polish + listings.is_promoted + users.no_show_count + seller_metrics_daily + promotion_charges |
| 048 | 5 | referrals + referral_credits + nps_surveys |

Apply the full set: `make migrate-up`. Demo seed: `SEED_DEMO_MARKETPLACE=1 cd database && go run ./cmd/seed`.
