# App Store Compliance Report

- **Target**: `/Users/nuclearisotope/Projects/Personal/NoMarkup` (iOS binary `ios/NoMarkup`, bundle `com.nomarkup.app`, deployment target 17.0). Web and gateway evidence is used where the binary calls it.
- **Date**: 2026-10-03
- **Guidelines snapshot**: 2026-06-08 — https://developer.apple.com/app-store/review/guidelines/
- **Snapshot age**: 117 days before this audit (over the 90-day refresh threshold). Apple’s page still says **Last Updated: June 8, 2026**. The registry date matches. It was not rewritten.
- **Platform / posture**: ios · App Store (notarization priority off). Each finding’s Notarization field is the registry flag.
- **Submission readiness**: **NOT READY**
- **Commit scored**: `ecedf67d` on `fix/security-audit-2026-04-23`
- **Method**: Five read-only section agents, one registry each. Orchestrator merged IDs, checked severities against the registries, and scored the seven `ASR-POST-*` items the Legal agent skipped (`Applies_when: always`).

## Applicability profile

Conservative true on payment and privacy when the binary collects data or sells a digital placement. `hardware` stays false: `ASR-2.4.1` is gated on that flag. `TARGETED_DEVICE_FAMILY` is `1,2` (iPhone and iPad). That is an observation, not a rescore of hardware items.

| Flag | Value | Evidence |
|---|---|---|
| always | true | Every section |
| ugc, social | true | Listings, jobs, chat, reviews, reports |
| location | true | `NSLocationWhenInUseUsageDescription` |
| iap, subscriptions | true | `StoreKitProductIDs` in `Info.plist`; purchase UI compiled; `StoreKitEnabled` false |
| physical_goods, p2p | true | Marketplace buy-now and job escrow via Apple Pay / Stripe |
| multiplatform | true | Web app plus iOS client |
| account, third_party_login | true | Email, Sign in with Apple, Google, Facebook |
| apple_pay | true | `merchant.com.nomarkup.app`, `PayWithApplePayButton` |
| push, widgets, extensions | true | Push registration, WidgetKit extension |
| recording | true | Camera picker; `ActionAuditProbe` logs UI actions locally |
| financial, loans, insurance, regulated | true | Code exists. `FeatureFlags.iOSHardOffKeys` forces the regulated rails off |
| us_storefront, metadata | true | US listing intended; ASC drafts under `docs/compliance/` |
| privacy, ip | true | Accounts, phone, photos, location; brand and user content. Added so Legal 5.1 / 5.2 are in scope |
| creator_content, kids_category, kids_audience, medical, health, reader, enterprise, free_companion | false | Not this product |
| crypto, nft, loot_boxes, nonprofit, gambling, ads, tracking | false | No IDFA, ATT, or ad SDK in the iOS project |
| mini_apps, vpn, mdm, mac, arkit, remote_desktop, template, hardware, beta, preorder | false | See iPad note above |
| contact_required, data_handling, criminal_reporting, ads_monetization, keyboard, safari_ext, apple_music, game_center, monetize_builtin, reviews | false | Safety 1.5 / 1.6 and Design review-response items stay N/A. User contact is still scored under 1.2 |

## Executive summary

| Metric | Count |
|---|---|
| Registry items | 367 |
| Scored PASS / FAIL / GAP / RISK | 218 |
| PASS | 150 |
| Blocker FAIL | 16 |
| Major FAIL | 10 |
| Advisory FAIL | 0 |
| RISK | 10 |
| GAP | 32 |
| N/A | 149 |
| Submission readiness | **NOT READY** |

Any blocker FAIL forces **NOT READY**. Major FAILs and payment/privacy RISKs are also present.

### Top 5 actions

1. Do not upload a build while `api.no-markup.com` and `no-markup.com` are NXDOMAIN. Seed the review accounts, put the password only in App Store Connect, and publish privacy and support on that host (`ASR-BYS.2`, `ASR-BYS.3`, `ASR-PRE-04`, `ASR-PRE-05`, `ASR-2.1.a.1`, `ASR-5.1.1.i`).
2. Remove in-app **Promote listing** (Stripe SetupIntent plus “Open the listing on the web to promote”), or sell that ranking boost only as a StoreKit consumable with no ungated web checkout CTA (`ASR-3.1.1.1`, `ASR-3.1.1.a.2`, `ASR-3.1.1.a.3`, `ASR-3.1.3.1`, `ASR-3.1.3.b.1`).
3. Filter display name, bio, chat templates, and quote templates, and scan or quarantine photos. Put Block on job and listing detail. Check blocks in `PlaceBid` and `Follow`. Make chat block fail closed when the database is nil (`ASR-1.2.a`, `ASR-1.2.c`).
4. Make the fee story match the binary. The product definition is that the buyer pays the agreed price and the platform take comes out of the seller payout (`services/payment/internal/domain/types.go`). What’s New still says “zero markup” with no that sentence, and checkout shows a platform fee (`ASR-2.3.1.a.3`). Review notes must also mention Promote if it stays (`ASR-3.0.1`).
5. Do not push the NPS “recommend NoMarkup” alert unless marketing consent is on. Keep chat message text off the lock screen (`ASR-4.5.4.marketing`, `ASR-4.5.4.sensitive`).

## Findings

Ordered blocker FAIL, then major FAIL, then RISK, then GAP. PASS is counts only.

### Safety

#### Blocker FAIL

### [ASR-BYS.2] Reviewers cannot exercise account-gated safety flows
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Provide App Review full access, including an active demo account or fully-featured demo mode and any hardware/resources needed to review.
- Evidence: Release API is `AppConfig.productionAPIBaseURL` (`https://api.no-markup.com`). DNS lookup failed on 2026-10-03. `docs/compliance/app-review-notes.md` says the host is not provisioned and the demo password is not in App Store Connect. `AuthViewModel.enterScaffoldSession` is browse-only and has no token. Report, block, and post paths refuse that mode.
- Remediation: Bring up the review API with seeded 18+ accounts, put the shared password only in the App Store Connect password field, and confirm report, block, chat, and listing flows on that host.
- Confidence: 9

### [ASR-BYS.3] Review backend is not reachable
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Enable backend services so they are live and accessible during App Review.
- Evidence: `https://api.no-markup.com/health` failed DNS on 2026-10-03. `docs/compliance/app-review-notes.md` says `DEPLOY_PROVISIONED` is unset. UGC report routes live on that API.
- Remediation: Provision the review API with health, auth, catalog, chat, and moderation up for the review window.
- Confidence: 9

### [ASR-1.2.a] Objectionable UGC can be posted on unfiltered surfaces
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Apps with user-generated content must include a method for filtering objectionable material from being posted.
- Evidence: `rejectProhibitedUGC` runs on listing and job text, chat `SendMessage` text, reviews, and offer messages (`gateway/internal/handler/ugc_filter.go`). It does not run on `UpdateMe` display name, provider bio, chat templates, or quote templates. `engines/imaging` resizes photos. It does not classify them.
- Remediation: Run the same pre-post filter on display name, bio, templates, and quote text. Reject or quarantine public images before they are shown.
- Confidence: 8

### [ASR-1.2.c] Block does not stop core interactions
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Apps with UGC must provide the ability to block abusive users from the service.
- Evidence: Block UI is `ProviderDetailView` and `MessagesView`. `JobDetailView` and `ListingDetailView` offer Report, not Block. `areUsersBlocked` is used for listing bids and offers. `BidHandler.PlaceBid` and `FollowsHandler.Follow` do not check blocks. Chat `SendMessage` skips the block query when `h.db` is nil.
- Remediation: Add Block beside Report on job and listing detail. Check blocks, fail closed, in `PlaceBid` and `Follow`. Refuse chat send when `db` is nil.
- Confidence: 8

#### Major FAIL

### [ASR-BYS.5] Listed app cannot stay supported on the declared hosts
- Status: FAIL
- Severity: major
- Notarization: no
- Rule: The app must continue to function as intended and be actively supported.
- Evidence: `AppConfig.supportURL` is `https://no-markup.com/support`, which did not resolve on 2026-10-03. In-app mailto `support@no-markup.com` exists (`LegalWebView.nativeSupportPage`). The public Support URL is dead, and the release API is dead with it.
- Remediation: Publish the support URL and do not ship the listing while the API host does not resolve. Keep the in-app mailto.
- Confidence: 8

#### GAP

### [ASR-1.2.b] Report intake exists; timely handling is not shown
- Status: GAP
- Severity: blocker
- Notarization: no
- Rule: Provide a mechanism to report offensive content and timely responses to concerns.
- Evidence: Report sheets exist for jobs, listings, reviews, and users. Admin queues exist. Jobs and listings auto-hide at 3 open reports. `ResolveJobReport` / `ResolveReport` update report status. No moderation SLA runbook was found, and the review host does not resolve.
- Remediation: Staff the queues with a written response SLA. Make a resolved report hide or remove the object.
- Confidence: 7

### [ASR-1.2.g] Takedown tools exist; standards are not reachable from the binary
- Status: GAP
- Severity: blocker
- Notarization: no
- Rule: The developer must remove content that violates the guidelines, terms, or community standards.
- Evidence: Admin suspend/remove exists for listings, jobs, and users. Guidelines text is in `web/src/app/(public)/community-guidelines/page.tsx`. The iOS row loads `https://no-markup.com/community-guidelines`, which was NXDOMAIN on 2026-10-03.
- Remediation: Bundle Community Guidelines in the binary and publish the public URL. Name who runs takedown when Apple asks.
- Confidence: 8

### [ASR-1.1.4] No porn product, but photos are unscreened
- Status: GAP
- Severity: blocker
- Notarization: no
- Rule: Do not include overtly sexual or pornographic material.
- Evidence: First-party UI is a local marketplace. The text filter blocks sexual-services phrases. Listing, chat, and avatar photos are not scanned.
- Remediation: Scan photos before publish. Do not add a dating or escort category.
- Confidence: 7

### [ASR-BYS.4] Safety notes are written but not shown as submitted
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Include detailed explanations of non-obvious features in App Review notes.
- Evidence: `docs/compliance/app-review-notes.md` covers the 18+ gate, report, block, and hard-off rails. The same file says the paste into App Store Connect is still open.
- Remediation: Paste that block into App Review Notes before submission.
- Confidence: 8

### [ASR-1.2.d] In-app contact exists; public Support URL does not resolve
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Publish contact information so users can reach the developer.
- Evidence: Account → Support is a native mailto to `support@no-markup.com`. `https://no-markup.com/support` did not resolve on 2026-10-03. Mailbox monitoring was not verified.
- Remediation: Serve the contact page on the public URL and confirm the mailbox is watched.
- Confidence: 8

### [ASR-1.2.f] Incidental explicit web UGC is not hidden by default
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Incidental mature content from a web service may display only if hidden by default and enabled on the website.
- Evidence: iOS shows the same listings, jobs, and chat as the web. There is no NSFW hide. `ModeratedAsyncImage` is a loader name. Imaging does not classify.
- Remediation: Reject explicit media before display, or hide it until a website preference allows it. Do not add an in-app-only “show NSFW” toggle.
- Confidence: 7

Safety counts: registry 52, applicable 29, PASS 18, FAIL 5, GAP 6, RISK 0, N/A 23. `ASR-1.6` is N/A because `data_handling` was false. That N/A is not a security pass. Data security is under Legal 5.1.

### Performance

#### Blocker FAIL

### [ASR-2.1.a.1] Final version, metadata, and live URLs
- Status: FAIL
- Severity: blocker
- Notarization: yes
- Rule: Submissions must be final, with complete metadata and fully functional URLs. Placeholder sites must be removed.
- Evidence: `https://no-markup.com/support`, `/privacy`, and `https://api.no-markup.com` were NXDOMAIN on 2026-10-03. `LegalWebView` treats DNS failure as “Can't load page”. `docs/compliance/submission-blockers.md` still lists the App Store Connect record, screenshots, nutrition labels, age rating, demo password, and review contact as open. `Info.plist` `APIBaseURL` is empty (release uses `AppConfig.productionAPIBaseURL`).
- Remediation: Publish privacy, support, marketing, and the review API over HTTPS. Enter the App Store Connect listing before upload.
- Confidence: 9

### [ASR-2.1.a.3] Demo account and live backend
- Status: FAIL
- Severity: blocker
- Notarization: yes
- Rule: If the app includes login, provide demo account info and keep backend services live.
- Evidence: Signed-in use requires login (`RootView`). Demo emails are in `docs/compliance/app-review-notes.md`. That file says the password is not in git and the API is not provisioned. DEBUG `LoginView.scaffoldBypass` is not a review demo.
- Remediation: Seed the accounts on a host that stays up through review. Put the password only in App Store Connect.
- Confidence: 9

### [ASR-2.3.1.a.3] Unqualified “zero markup” next to a platform fee
- Status: FAIL
- Severity: blocker
- Notarization: yes
- Rule: Do not market content, services, or prices the app does not offer.
- Evidence: `docs/compliance/release-notes/1.0.0.md` says “the local two-sided marketplace with zero markup.” `ShareCardText.lifetimeSavings` says “no markup.” Seller-side take is non-zero: `DefaultFeeConfig` is 8% platform plus 2% guarantee, and the comment says the buyer pays the agreed price (`services/payment/internal/domain/types.go`). `listingPlatformFeeBpsDefault = 1000` in `gateway/internal/handler/listings_bid.go`. `ContractDetailView` shows a Platform fee row. The What’s New line does not say the fee comes from the seller.
- Remediation: Say, in What’s New and the share card, that the buyer pays the agreed price and the platform fee is taken from the seller payout, and show that fee before pay. Drop the bare “zero markup” sentence.
- Confidence: 7

#### RISK

### [ASR-2.1.b.1] IAP product IDs ship while purchase is off
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: In-app purchases offered in the app must be complete, visible to the reviewer, and functional.
- Evidence: `StoreKitEnabled` is false. `StoreKitProductIDs` still lists four provider plan IDs. `StoreKitManager.purchase` returns false when disabled. `PlanLimitsView` does not offer purchase in this build.
- Remediation: Delete the product IDs from the shipping plist, or turn StoreKit on with matching App Store Connect products and a working purchase and restore path. Do not add a web digital upsell.
- Confidence: 8

### [ASR-2.5.14] Local UI action log has no consent
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Explicit consent and a clear indication are required when recording or logging user activity.
- Evidence: Camera uses `AVCaptureDevice.requestAccess` and the system picker, with purpose strings. `NoMarkupApp.init` always installs `ActionAuditProbe`, which swizzles `sendAction` and `viewDidAppear` and stores screen names and control labels in `ClientActionLog`. The log is local (Account → Request log) and is not uploaded. There is no consent prompt for that log.
- Remediation: Keep the system camera consent. Compile the tap/screen probe out of Release, or put it behind a visible diagnostic toggle.
- Confidence: 7

### [ASR-2.3.1.a.1] Hard-off rails and StoreKit code remain in the binary
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Do not include hidden, dormant, or undocumented features.
- Evidence: `FeatureFlags.iOSHardOffKeys` forces off BNPL, working capital, insurance, legal services, lead-gen, and instant payout. The hub can still say “Not available in this App Store build.” StoreKit purchase code remains behind `StoreKitEnabled`. The explanation is drafted in review notes and is not confirmed pasted.
- Remediation: Paste the hard-off list into App Review Notes. Keep those keys off on the review server. Do not flip StoreKit on for the reviewed build.
- Confidence: 7

### [ASR-2.3.2.c] No promoted-IAP transaction observer while product IDs exist
- Status: RISK
- Severity: major
- Notarization: no
- Rule: Handle the payment queue so a promoted IAP can finish when the app launches.
- Evidence: No `SKPaymentTransactionObserver`. StoreKit 2 `Transaction.updates` runs only from `startIfEnabled()`, which returns immediately when `storeKitEnabled` is false.
- Remediation: If nothing is promoted, keep the listener off and do not list the products in App Store Connect. If a product is promoted, start the listener at launch and finish the transaction.
- Confidence: 8

#### GAP

### [ASR-2.1.a.2] On-device stability test
- Status: GAP
- Severity: blocker
- Notarization: yes
- Rule: Apps must be tested on-device for bugs and stability before submission.
- Evidence: `docs/compliance/device-smoke-results-2026-07-26.md` is build 0.1.0 (2) with no human primary-flow pass. Current marketing version is 1.0.0. `submission-blockers.md` row 11 is still unsigned.
- Remediation: Cold-launch the archive on a device against the review API and record login, browse, bid or buy, messages, and account.
- Confidence: 8

### [ASR-2.1.b.2] Hidden IAP explained in notes
- Status: GAP
- Severity: major
- Notarization: no
- Rule: If a configured in-app purchase cannot be reviewed, explain why in the notes.
- Evidence: The draft says `StoreKitEnabled=false`. Notes are not pasted. No App Store Connect IAP catalog is in the tree.
- Remediation: If there is no IAP, say that in pasted notes and remove client product IDs.
- Confidence: 8

### [ASR-2.3.0] Metadata matches the binary
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: Privacy information, description, screenshots, and previews must match the core experience.
- Evidence: Drafts exist. `asc-packaging-checklist.md` still marks nutrition labels and screenshots as not entered. Privacy manifests exist for the app and the widget.
- Remediation: Enter labels from `PrivacyInfo.xcprivacy` and upload screenshots of this binary.
- Confidence: 8

### [ASR-2.3.1.a.2] Specific Notes for Review
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: New features must be described in Notes for Review and must be reachable.
- Evidence: `app-review-notes.md` has a paste block. `submission-blockers.md` says notes and the demo password are not in App Store Connect. The review API does not resolve.
- Remediation: Paste the block after each bullet works on the live review API.
- Confidence: 8

### [ASR-2.3.2.a] IAP disclosure in listing media
- Status: GAP
- Severity: major
- Notarization: no
- Rule: If the app includes IAP, listing media must show that featured items need extra purchases.
- Evidence: No App Store Connect description or screenshot set is in the tree. Purchase UI is flag-off.
- Remediation: Do not feature Pro or Business plans in shots while IAP is off.
- Confidence: 8

### [ASR-2.3.2.b] Promoted IAP metadata
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Promoted IAP name, screenshot, and description must be appropriate for a public audience.
- Evidence: No promoted-IAP assets. Checklist says v1 IAP is none. Product ID strings remain in `Info.plist`.
- Remediation: Do not promote IAP until metadata matches `PlanLimitsView`.
- Confidence: 8

### [ASR-2.3.3] Screenshots show the app in use
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Screenshots must show the app in use.
- Evidence: `app-store-screenshot-matrix.md` names real screens and says no pixel set is committed.
- Remediation: Capture the signed-in app on the required device sizes.
- Confidence: 9

### [ASR-2.3.4.a] Previews are app screen capture
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Previews may only use video screen captures of the app.
- Evidence: No App Preview video in the tree.
- Remediation: Omit previews, or submit only device capture of this binary.
- Confidence: 8

### [ASR-2.3.7.a] Name and keywords
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: Use a unique, accurate name and keywords.
- Evidence: Display name `NoMarkup` is in `Info.plist`. No keyword field is in the tree. The checklist marks keywords as not entered.
- Remediation: Enter keywords for local jobs, auctions, and the marketplace. Do not add competitor names or prices.
- Confidence: 8

### [ASR-2.3.8.a] Store art is 4+ appropriate
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: Icons, screenshots, and previews must stay appropriate for a 4+ rating.
- Evidence: `AppIcon-1024.png` is a metallic “M” and the word NoMarkup. No screenshot set to review.
- Remediation: Keep the icon. Review every uploaded shot against the same bar.
- Confidence: 8

### [ASR-2.3.9.a] Rights to metadata assets
- Status: GAP
- Severity: major
- Notarization: no
- Rule: You must have rights to all materials in icons, screenshots, and previews.
- Evidence: `brand/ICON_DECISION.md` treats the icon as an owned master. Screenshots are not produced. No third-party image license file was found.
- Remediation: Keep store media to first-party UI and the owned icon.
- Confidence: 7

### [ASR-2.3.9.b] Fictional people in metadata
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Use fictional account information in metadata.
- Evidence: Demo emails are seed addresses. No screenshot set to inspect.
- Remediation: Capture shots only from seed accounts.
- Confidence: 8

### [ASR-2.5.5] IPv6-only networks
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Apps must be fully functional on IPv6-only networks.
- Evidence: Release base is the hostname `https://api.no-markup.com`, not an IPv4 literal. The host does not resolve, so IPv6 behavior is unproven. `127.0.0.1` is DEBUG only.
- Remediation: After DNS exists, run core flows on an IPv6-only network.
- Confidence: 8

### [ASR-2.3.4.b] Preview overlays
- Status: GAP
- Severity: advisory
- Notarization: no
- Rule: Narration and overlays may only explain what the preview does not make clear.
- Evidence: No preview video.
- Remediation: If a preview is added, limit overlays to on-screen labels.
- Confidence: 8

### [ASR-2.3.7.e] Keyword abuse is enforceable
- Status: GAP
- Severity: advisory
- Notarization: yes
- Rule: Apple may modify inappropriate keywords.
- Evidence: No keyword field in the tree.
- Remediation: Keep the list descriptive once it exists.
- Confidence: 8

### [ASR-2.3.10.b] Metadata stays on the app
- Status: GAP
- Severity: advisory
- Notarization: no
- Rule: Metadata must focus on the app.
- Evidence: Proposed subtitle “Local jobs & marketplace” is on-product. A full description is not in the tree.
- Remediation: Write a description limited to jobs, goods, chat, and payments.
- Confidence: 8

Performance counts: registry 99, applicable 55, PASS 32, FAIL 3, GAP 16, RISK 4, N/A 44. Mac, beta, pre-order, and `hardware`-gated device items are the N/A bulk.

### Business

#### Blocker FAIL

### [ASR-3.1.1.1] Digital ranking boost sold with Stripe, not IAP
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Unlocking features or functionality within the app must use In-App Purchase.
- Evidence: Seller-owned listings show **Promote listing** and charge a placement boost ($5/24h, $12/72h, $25/168h) through Stripe SetupIntent, then set `is_promoted`. `ListingDetailView.promoteOwnedListing`, `APIClient+Commerce.swift` `ListingPromotionTier`, gateway `POST /listings/{id}/promote`. This is in-app search ranking. Subscriptions are not this hole: `StoreKitEnabled` is false and `PlanLimitsView` has no Subscribe control. BNPL, insurance, working capital, legal, lead-gen, and instant payout are not reachable (`FeatureFlags.iOSHardOffKeys`, migration `129_disable_regulated_feature_flags`).
- Remediation: Remove the Stripe promote purchase and the web-promote fallback, or sell the boost only as a StoreKit consumable. Apple Pay for ranking is not a physical-goods checkout.
- Confidence: 9

### [ASR-3.1.1.a.2] Web promote instructions without External Purchase Link entitlement
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: External Purchase Link entitlements are limited to specific storefronts, and IAP must still be offered.
- Evidence: No `com.apple.developer.storekit.external-purchase` in `NoMarkup.entitlements`. On promote setup failure, `ListingDetailView` says “Open the listing on the web to promote.” No storefront check. IAP is not offered for this boost.
- Remediation: Delete the web-promote instructions.
- Confidence: 8

### [ASR-3.1.1.a.3] Digital purchase steering is not limited to the US storefront
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Outside the United States storefront, apps may not include CTAs to purchasing mechanisms other than IAP.
- Evidence: The same ungated strings in `ListingDetailView.swift`. Review notes claim there is no “buy digital cheaper on the web” CTA. Bid-bond “open the listing on the web” copy is a real-world auction deposit and is not this finding.
- Remediation: Remove the digital-purchase web CTA from every storefront build.
- Confidence: 8

### [ASR-3.1.3.1] Multiplatform app encourages non-IAP purchase of a digital boost
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Apps that may use other purchase methods still may not encourage a method other than IAP inside the app, except on the US storefront and entitled cases.
- Evidence: Same promote fallback copy. `manageSubscriptionURL` in `AppConfig.swift` has no callers. No storefront split.
- Remediation: Stop in-app encouragement to buy listing promotion on the web.
- Confidence: 8

### [ASR-3.1.3.b.1] Web-purchased placement boost is usable on iOS with no IAP equivalent
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Digital items acquired on the web may be used in the app only if they are also available as in-app purchases.
- Evidence: `is_promoted` / `promoted_until` render in `ListingDetailView` and `MyListingsView`. The in-app purchase path is Stripe. iOS plan-limit clamping does not cover paid promotion rank.
- Remediation: Offer the same boost as IAP, or do not apply web-purchased promotion rank in the iOS client.
- Confidence: 8

#### Major FAIL

### [ASR-3.1.1.a.1] US external-purchase exception is not storefront-gated
- Status: FAIL
- Severity: major
- Notarization: no
- Rule: External digital-purchase CTAs that rely on the US exception must not ship to every storefront.
- Evidence: Promote error copy points at the developer site with no US-only check (`ListingDetailView.swift`, `NoMarkup.entitlements`).
- Remediation: Remove the CTA, or gate it to the US storefront only.
- Confidence: 8

### [ASR-3.0.1] Review notes deny a monetization path the binary sells
- Status: FAIL
- Severity: major
- Notarization: no
- Rule: If the business model is not obvious, explain it in metadata and App Review notes.
- Evidence: `app-review-notes.md` says there is no digital unlock purchase and no web CTA for digital goods. It does not mention listing promotion. The binary sells that boost.
- Remediation: Describe goods and services Apple Pay, and either describe the boost or remove it, before those notes are pasted.
- Confidence: 8

#### RISK

### [ASR-3.2.1.viii] Marketplace escrow versus a money-management institution
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Apps used for financial trading, investing, or money management should be submitted by the financial institution performing those services.
- Evidence: No binary-options, CFD, or FOREX UI. Job and goods funds use Stripe Connect escrow (`ContractDetailView`, Apple Pay, merchant `merchant.com.nomarkup.app`). Working-capital advances are hard-off. No license file is in the tree. Whether Connect escrow is “money management” under this guideline is counsel’s call.
- Remediation: Have counsel confirm escrow does not require an institution developer account. Keep advances hard-off until licensed.
- Confidence: 5

Business counts: registry 80, applicable 61, PASS 53, blocker FAIL 5, major FAIL 2, RISK 1, GAP 0, N/A 19. Real-world goods and 1:1 job escrow stay on Apple Pay / Stripe (`ASR-3.1.3.e.1`, `ASR-3.1.3.d.1` PASS). Insurance and loan UIs are compiled and unreachable.

### Design

#### Major FAIL

### [ASR-4.5.4.marketing] Marketing push opt-in and opt-out
- Status: FAIL
- Severity: major
- Notarization: yes
- Rule: Push must not be used for promotions unless the customer explicitly opted in, and the app must offer an in-app opt-out.
- Evidence: The in-app gate covers `price_drop`, `seller_new_listing`, `promotional`, `marketing`, and `welcome_day*` (`NotificationPreferencesView.swift`). The server classifies `nps_survey` as promotional (`notif_class.go`) but `insertAndPromptNPS` forces channels `in_app` and `push` with “recommend NoMarkup to a friend” (`nps.go`). A missing preference row does not strip an explicit push channel (`filterByExplicitPrefs`).
- Remediation: Do not request push for `nps_survey` unless the marketing-consent toggle is on. Treat a missing preference as push-off for every promotional type.
- Confidence: 8

#### RISK

### [ASR-4.5.4.sensitive] Sensitive data in pushes
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Push Notifications should not send sensitive personal or confidential information.
- Evidence: Payment and bid templates avoid card numbers and passwords. Chat pushes the sender name plus up to 140 runes of the message (`gateway/internal/handler/chat.go` `messagePreview`), so a lock-screen alert can show an address or phone the user typed.
- Remediation: Push a generic “New message” body. Keep the message text in the app.
- Confidence: 7

#### GAP

### [ASR-4.3.a] One binary, not city or locale clones
- Status: GAP
- Severity: blocker
- Notarization: yes
- Rule: Do not create multiple Bundle IDs of the same app.
- Evidence: This tree has `com.nomarkup.app` plus the widget and test bundles. Other apps on the developer account were not visible from the repo.
- Remediation: Confirm the account lists only this app and its widget.
- Confidence: 6

### [ASR-4.4] Widget extension compliance and marketing disclosure
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: Extensions must follow the extension guide, should be disclosed in marketing text, and may not include marketing, ads, or IAP.
- Evidence: WidgetKit extension ships Active Bids, Next Closing, Live Activity, and Control Center controls. No ads or StoreKit in `ios/NoMarkupWidget/`. In-app help exists. The App Store description is not entered (`asc-packaging-checklist.md` §10.2).
- Remediation: List the widget, Live Activity, and Control Center controls in the public description.
- Confidence: 8

Design counts: registry 70, applicable 32, PASS 24, major FAIL 1, RISK 1, GAP 2, N/A 42 (4 omitted guideline numbers inside the applicable set, plus 38 excluded by flag). Sign in with Apple is present beside Google and Facebook (`ASR-4.8` PASS). Apple Pay buttons are the system control (`ASR-4.9` PASS).

### Legal

#### Blocker FAIL

### [ASR-PRE-04] Demo account / full access
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Provide an active demo account or a fully featured demo mode for account-based features.
- Evidence: Demo emails are documented. The password is not in git. `https://api.no-markup.com` did not resolve on 2026-10-03, so those accounts are not an active review login.
- Remediation: Seed the accounts on the review API and put the password only in App Store Connect.
- Confidence: 9

### [ASR-PRE-05] Backend live during review
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Backend services must be live and accessible during review.
- Evidence: Release API default is `https://api.no-markup.com` (`AppConfig.swift`). DNS failed on 2026-10-03. `DEPLOY_PROVISIONED` is unset in the September readiness note.
- Remediation: Keep the review API up for the whole review window.
- Confidence: 10

### [ASR-5.1] Privacy program
- Status: FAIL
- Severity: blocker
- Notarization: yes
- Rule: Handle personal data in line with privacy laws, the Program License Agreement, and customer expectations.
- Evidence: Policy text, purpose strings, and manifests exist. The policy URL does not resolve. Nutrition labels are still open (`submission-blockers.md` row 5). The only linked iOS SDK is `stripe-ios` 24.25.0. `NSPrivacyTracking` is false. No ATT or IDFA use was found.
- Remediation: Host the policy and enter App Store Connect privacy labels that match the binary and Stripe’s manifest.
- Confidence: 8

### [ASR-5.1.1.i] Privacy policy link and required content
- Status: FAIL
- Severity: blocker
- Notarization: yes
- Rule: Include a working privacy-policy link in App Store Connect and in the app. The policy must cover collection, use, third parties, and deletion.
- Evidence: Account and the login footer open `LegalWebView` to `https://no-markup.com/privacy`. That host failed DNS on 2026-10-03. The failure UI is “Can't load page” plus mailto, not the policy. Source text in `web/src/app/(public)/privacy/page.tsx` covers collection, third parties, and deletion.
- Remediation: Publish `https://no-markup.com/privacy`, confirm it loads in the app, and put that URL in App Store Connect.
- Confidence: 10

#### Major FAIL

### [ASR-PRE-01] Test for crashes and bugs
- Status: FAIL
- Severity: major
- Notarization: no
- Rule: Test the app for crashes and bugs before submission.
- Evidence: UI tests exist. Human device smoke for 1.0.0 is unsigned. Shipping hosts do not resolve, so review flows cannot complete.
- Remediation: Run a crash-free review smoke on a live review backend before submit.
- Confidence: 7

### [ASR-PRE-02] Complete, accurate metadata
- Status: FAIL
- Severity: major
- Notarization: no
- Rule: App information and metadata must be complete and accurate.
- Evidence: `submission-blockers.md` still marks name, description, screenshots, age rating, privacy labels, and export answers as open. `ITSAppUsesNonExemptEncryption` is false in `Info.plist`.
- Remediation: Fill App Store Connect metadata to match the binary.
- Confidence: 8

### [ASR-PRE-03] App Review contact
- Status: FAIL
- Severity: major
- Notarization: no
- Rule: Keep contact information updated so App Review can reach the developer.
- Evidence: Intended contact is `support@no-markup.com`. The packaging checklist still has App Review email and phone as not entered. `https://no-markup.com` does not resolve.
- Remediation: Put a monitored phone and email in App Store Connect.
- Confidence: 7

### [ASR-PRE-06] Review notes for non-obvious features
- Status: FAIL
- Severity: major
- Notarization: no
- Rule: Explain non-obvious features and in-app purchases in App Review notes.
- Evidence: Paste-ready notes exist and are not pasted. They also omit listing promotion (see `ASR-3.0.1`).
- Remediation: Update the block for Promote, then paste it after the review API works.
- Confidence: 8

### [ASR-PRE-08] App still supported and functional
- Status: FAIL
- Severity: major
- Notarization: no
- Rule: Apps that no longer function as intended or are no longer supported will be removed.
- Evidence: In-app support mailto exists. The production site and API do not resolve, so the shipping binary cannot run the marketplace against its release host.
- Remediation: Keep a working backend and a monitored support channel.
- Confidence: 8

### [ASR-5.6.2] Accurate developer identity
- Status: FAIL
- Severity: major
- Notarization: yes
- Rule: Developer identity and contact must be accurate and current.
- Evidence: Support mailto exists. Public support and privacy URLs do not resolve. App Store Connect contact fields are unchecked.
- Remediation: Publish the site, confirm the mailbox, and match the seller name and support URL.
- Confidence: 8

#### RISK

### [ASR-5.0] Legal requirements and no criminal facilitation
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Comply with legal requirements in every location where the app is available. Do not solicit criminal behavior.
- Evidence: Terms and community guidelines prohibit illegal goods, weapons, drugs, and cannabis. Age gate is 18+. No counsel memo or storefront matrix is in the repo. Those pages sit on the dead host.
- Remediation: Have counsel confirm storefronts and publish the prohibitions on a live site.
- Confidence: 6

### [ASR-5.1.1.ix] Regulated services submitted by the providing legal entity
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Apps in highly regulated fields should be submitted by the legal entity that provides the services.
- Evidence: Regulated rails are hard-off. `background_checks` is not in `iOSHardOffKeys`; Checkr UI is flag-gated and not configured. No organization-enrollment record is in the repo. Payments are Stripe marketplace checkout.
- Remediation: Submit from the legal entity that operates NoMarkup. Keep regulated rails off. Keep background checks off for review.
- Confidence: 7

### [ASR-5.2.1] No unlicensed third-party material; correct IP owner
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Do not use protected third-party material without permission. Submit under the owner or licensee.
- Evidence: Display name is NoMarkup. No trademark-clearance or submitter-entity record is in the repo.
- Remediation: Submit as the IP owner and keep a license list for brand, fonts, and SDK assets.
- Confidence: 6

### [ASR-5.2.2] Third-party service authorization
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Use of a third-party service must be permitted by that service’s terms, and authorization must be available on request.
- Evidence: `stripe-ios` is linked. Google and Facebook client IDs are empty in `Info.plist`. Sign in with Apple is implemented. Review notes do not attach partner authorization letters.
- Remediation: Finish Stripe, Apple, Google, and Facebook console setup and be ready to show it in Resolution Center.
- Confidence: 7

#### GAP

### [ASR-5.6.4] App quality
- Status: GAP
- Severity: advisory
- Notarization: no
- Rule: Maintain quality. Excessive refunds or complaints can factor into Code of Conduct decisions.
- Evidence: The app is not on the store. There is no rating or refund series.
- Remediation: After launch, watch ratings, refunds, and support volume.
- Confidence: 8

### [ASR-POST-01] Repeated same-guideline rejections
- Status: GAP
- Severity: advisory
- Notarization: no
- Rule: Do not resubmit the same guideline violation or try to manipulate review.
- Evidence: No submission record in the tree. Orchestrator scored this `Applies_when: always` item after the Legal agent omitted the After You Submit block.
- Remediation: Fix the blocker FAILs in this report before the first upload.
- Confidence: 8

### [ASR-POST-02] Watch App Store Connect status
- Status: GAP
- Severity: advisory
- Notarization: no
- Rule: Current status is in App Store Connect.
- Evidence: No app record is claimed complete (`submission-blockers.md`).
- Remediation: Name who watches status during the review window.
- Confidence: 8

### [ASR-POST-03] Expedite requests
- Status: GAP
- Severity: advisory
- Notarization: no
- Rule: Request expedited review only for a real critical need.
- Evidence: No expedite request in the tree.
- Remediation: Do not expedite the first submission to paper over the dead API.
- Confidence: 8

### [ASR-POST-04] Future release date
- Status: GAP
- Severity: advisory
- Notarization: no
- Rule: A future release date holds the app until that date, and storefronts can take up to 24 hours.
- Evidence: No release-date setting in the tree.
- Remediation: Plan launch copy around the chosen date plus propagation.
- Confidence: 8

### [ASR-POST-05] Rejection dialogue
- Status: GAP
- Severity: advisory
- Notarization: no
- Rule: If rejected, reply in App Store Connect with the requested evidence.
- Evidence: No Resolution Center thread.
- Remediation: Answer in App Store Connect with the evidence this report names.
- Confidence: 8

### [ASR-POST-06] Appeals
- Status: GAP
- Severity: advisory
- Notarization: no
- Rule: Disagree with an outcome by filing an appeal.
- Evidence: No appeal record.
- Remediation: Appeal only with evidence, after the binary matches the notes.
- Confidence: 8

### [ASR-POST-07] Bug-fix submissions
- Status: GAP
- Severity: advisory
- Notarization: no
- Rule: For apps already on the store, bug fixes are not delayed for non-legal, non-safety guideline issues.
- Evidence: The app is not on the store. Current blockers include safety and legal items, which this path does not waive.
- Remediation: Do not treat the first submission as a bug-fix exception.
- Confidence: 8

Legal counts after the POST add: registry 66, scored 45, PASS 23, FAIL 10 (4 blocker, 6 major), RISK 4, GAP 8, N/A 21. N/A covers kids, health research, gambling, VPN, MDM, and review-response items `ASR-5.6.1` and `ASR-5.6.3` (`reviews` false). In-app account deletion is a real `DELETE` (`ASR-5.1.1.v` PASS) and still cannot succeed until the API is live.

## Pre-submit operational checklist

| ID | Status | Note |
|---|---|---|
| ASR-PRE-01 | FAIL | Device smoke for 1.0.0 unsigned; review host down |
| ASR-PRE-02 | FAIL | App Store Connect metadata still open |
| ASR-PRE-03 | FAIL | Review phone and email not entered |
| ASR-PRE-04 | FAIL | Demo accounts are not a live login |
| ASR-PRE-05 | FAIL | `api.no-markup.com` NXDOMAIN on 2026-10-03 |
| ASR-PRE-06 | FAIL | Notes drafted, not pasted, and they omit Promote |
| ASR-PRE-07 | PASS | SwiftUI, visible Safari sheet, system Apple Pay button |
| ASR-PRE-08 | FAIL | Release binary cannot reach its API or support site |

## Registry coverage

| Section | Registry | PASS+FAIL+GAP+RISK | PASS | FAIL | GAP | RISK | N/A |
|---|---:|---:|---:|---:|---:|---:|---:|
| Safety | 52 | 29 | 18 | 5 | 6 | 0 | 23 |
| Performance | 99 | 55 | 32 | 3 | 16 | 4 | 44 |
| Business | 80 | 61 | 53 | 7 | 0 | 1 | 19 |
| Design | 70 | 28 | 24 | 1 | 2 | 1 | 42 |
| Legal (incl. POST) | 66 | 45 | 23 | 10 | 8 | 4 | 21 |
| Total | 367 | 218 | 150 | 26 | 32 | 10 | 149 |

Design’s 42 N/A include 4 omitted guideline numbers the section still opened (`ASR-4.2.4`, `ASR-4.2.5`, `ASR-4.4.3`, `ASR-4.6`) and 38 items excluded by flag. 218 + 149 = 367. Every FAIL, GAP, and RISK ID in this file was checked against `references/01-safety.md` through `05-legal.md`.

Same theme, different IDs (kept, not merged): dead review API (`ASR-BYS.3`, `ASR-PRE-05`, `ASR-2.1.a.1`); missing demo login (`ASR-BYS.2`, `ASR-PRE-04`, `ASR-2.1.a.3`); dead support URL (`ASR-BYS.5`, `ASR-1.2.d`, `ASR-PRE-08`, `ASR-5.6.2`).

## Phase 5 — Remediation plan (not implemented)

Readiness is **NOT READY**. No code was changed for this audit.

### 1. Review environment (ops)
Publish `no-markup.com` and `api.no-markup.com`. Seed `customer@nomarkup.com`, `provider@nomarkup.com`, `provider2@nomarkup.com`, and `admin@nomarkup.com`. Put the password only in App Store Connect. Paste updated review notes. Enter screenshots, age rating, export, and privacy nutrition labels. Sign device smoke on the 1.0.0 archive.

### 2. Payments (one PR, well under 400 lines)
Remove Promote listing’s Stripe charge and the “open on the web to promote” strings from `ListingDetailView`, or replace that purchase with a StoreKit consumable and delete the web CTA. Do not apply a web-only `is_promoted` rank in the iOS client unless the same boost is an IAP. If StoreKit stays off, delete `StoreKitProductIDs` from the shipping plist. Leave `StoreKitEnabled` false. Leave `iOSHardOffKeys` in place. Do not add `payment_method_types` or move Connect to Accounts v2.

### 3. UGC (one PR for text and block, one for images)
Call the existing text filter from display-name, bio, chat-template, and quote-template writes. Check `areUsersBlocked` in `PlaceBid` and `Follow`, fail closed. Refuse chat send when `db` is nil. Add Block next to Report on job and listing detail. Make report resolution hide the object. Quarantine photos until a scanner exists. Bundle community guidelines for offline display.

### 4. Metadata honesty (docs plus two strings)
Rewrite What’s New and `ShareCardText.lifetimeSavings` so the buyer-pays-agreed-price rule and the seller-side fee are the same sentence. Update `app-review-notes.md` so it matches whatever Promote decision landed. Then paste.

### 5. Push (one small PR)
Stop `insertAndPromptNPS` from forcing the push channel. Default promotional types to push-off when no preference row exists. Send chat pushes as “New message” without the message body.

### 6. Counsel, before upload
Confirm Connect escrow is not “money management” under 3.2.1(viii). Confirm the Apple Developer account is the operating legal entity. Keep background checks off for the reviewed build. Keep a trademark and SDK license list.

## Disclaimer

This audit maps product evidence to Apple’s published App Store Review Guidelines. It is not legal advice and does not guarantee App Review approval. Guidelines are a living document; re-verify against the canonical URL before submission. The registry snapshot is 2026-06-08. Apple’s Last Updated date on 2026-10-03 was still June 8, 2026.
