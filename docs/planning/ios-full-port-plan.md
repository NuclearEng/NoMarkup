# iOS Full-Port Program — "Nothing on the web"

**Directive (Founder, 2026-07-27):** the iOS app becomes the complete product surface.
Everything currently web-only ports to iOS; the web tier is to be retired as a user
surface. This SUPERSEDES the "web-only by design" classifications in
`docs/compliance/ios-prd-coverage-audit-2026-07-27.md` and re-opens parts of the
locked `docs/compliance/v1-ios-product-cut.md`.

## Decision gates the port forces (resolve FIRST, in order)

1. **App Store 3.1.1 / StoreKit (Rail B) — the big one.** "Manage on web" for paid
   digital tiers exists because Apple requires IAP for digital goods sold in-app.
   A full port means Stage B2 ships: StoreKit 2 subscriptions, ASC product records,
   receipt/entitlement sync with the gateway, and the free-tier lock in
   `v1-ios-product-cut.md` is formally superseded. (Alternative — keep digital tiers
   free on iOS forever — contradicts "nothing on the web." Founder call recorded as:
   port = StoreKit.)
2. **Admin console on iOS.** PRD FR-13.1 scoped admin to web. Port implies an iOS
   admin surface (flags, moderation, disputes, refund-after-payout). Recommend a
   gated `Admin` tab visible only to `admin` role, built after customer/provider
   parity.
3. **Web retirement sequencing.** AASA, universal links, OAuth redirects, Stripe
   Connect onboarding, and legal/support pages currently live on no-markup.com.
   Some MUST remain as headless endpoints even in a "nothing on the web" world
   (AASA file, Stripe Connect Express onboarding redirect, OAuth callback, privacy/
   terms URLs required by App Review). Retire the web APP, keep the web UTILITY
   endpoints. Inventory below.

## Port backlog (seeded from the 2026-07-27 PRD coverage audit)

### A. Web-only by design → port (16 FRs)
The audit's "Web-only" bucket is the primary backlog. Pull the exact FR list +
citations from `ios-prd-coverage-audit-2026-07-27.md` §"Not gaps" appendix; headline
items: provider onboarding depth (Stripe Connect Express flow — needs in-app
WebView/SFSafari handoff or native Connect onboarding), digital tier purchase
(→ StoreKit per gate 1), admin console (→ gate 2), advanced search/saved-search
management parity, full dispute evidence flows, data export/GDPR surfaces.

### B. Partial on iOS → finish (36 FRs)
Top 10 already ranked in the audit executive summary; the port program adopts that
ranking as the sprint order, starting with: bid filters + full sort (FR-4.6/4.7),
job schedule preference (FR-3.1), pre-bid Q&A (FR-8.1), chat file attachments
(FR-8.3), distance/ETA (FR-10.7), share-contact (FR-8.8), unread badges
(FR-17.1/8.10), revision rules (FR-15.4), property spend cards (FR-19.2),
recurring-job management (FR-18.3/18.4).

### C. Missing on iOS (2 FRs)
In bucket B's ranked list (FR-4.7 filters; FR-10.7 distance/ETA).

### D. Cut by v1 decision → un-cut (4 FRs)
FR-12.1–12.4 (paid digital tiers) — gated on decision 1 (StoreKit).

## Explicitly staying server-side (infrastructure, not user surfaces)
- AASA + `.well-known` files, OAuth redirect endpoints, the Stripe event receiver
  (which verifies signatures via `stripe.webhooks.constructEvent()` per
  `gateway/internal/handler/webhook.go:40` — mandatory, unchanged by the port),
  Apple Pay merchant validation, privacy/terms/support pages (App Review requires
  reachable URLs), email templates. These are infrastructure, not "the web app."

## State of play when this was written (end of 2026-07-27 session)
- iOS platform audit v2 + remediation waves 16-17 committed (`41aa355e`); 77/77 unit
  tests; light+dark verified; device build running on the founder's iPhone.
- E2E walk: harness committed; iPhone-light leg reviewed clean twice; run 3 and the
  extended profile legs (customer2/provider2/admin) + iPad legs were interrupted by
  session shutdown — resume via `ScreenshotWalkUITests` per the session
  scratchpad runbook/ledger (re-seed stack with `bin/dev up` + `make seed`).
- Platform verification re-audit (v3) not yet run — run after the walk completes.
- Ops queue unchanged: ASC record, privacy label + age rating entry, TestFlight
  upload, human device sign-off, 6.9"/13" screenshots.

## Next session start
1. Resolve gates 1-3 (founder decisions — 1 is effectively made by the directive).
2. Stand up stack (`bin/dev up infra engines services gateway`, `make seed`).
3. Finish E2E walk legs + fix loop; re-run platform audit (v3).
4. Sprint 1 of bucket B (ranked top-10), StoreKit spike for gate 1 in parallel.
