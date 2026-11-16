# NoMarkup iOS — close loop 1

**Target:** `/Users/nuclearisotope/Desktop/Personal/NoMarkup/ios` (`com.nomarkup.app`)
**Date:** 2026-11-16
**Prior report:** `docs/compliance/ios-app-studio-audit-2026-11-16.md` (round 0, unchanged)
**This round's compile:** Debug generic iOS Simulator build, `EXIT:0` (log `/tmp/nomarkup-ios-build-loop3.log`, `** BUILD SUCCEEDED **`).

```
cd ios && xcodebuild -project NoMarkup.xcodeproj -scheme NoMarkup -destination 'generic/platform=iOS Simulator' -configuration Debug build CODE_SIGNING_ALLOWED=NO SYMROOT="$PWD/build" OBJROOT="$PWD/build"
```

## Labels

Unchanged from round 0. App Review is **NOT READY**. Platform is **NOT READY**. Device is **RIGID** (the four-device matrix has not been run). Accessibility is **NON-CONFORMANT**. Craft is not best in class. The excellence critic gate was not run. Human steps stay open and are not PASS.

## Fixes

Code changes only. A status edit is not a fix. Each row is what the tree now does.

| ID | What changed | Proof |
| --- | --- | --- |
| WCAG-2.2.1 | Idle window matches the server role timeout (admin 30 min, customer 60, provider 120, smallest role wins). Twenty seconds before it ends, the signed-in shell shows “Stay signed in” and posts an announcement. Choosing it refreshes the session. Ignoring it signs out and announces that. Auction clocks are unchanged. | Build EXIT:0. Not timed on a device. |
| WCAG-4.1.3 | Session-end and stay-signed-in use `AccessibilityNotification.Announcement`. | Build EXIT:0. VoiceOver not run. |
| CRAFT-MOT.12 | Cited price, age-gate, savings, and primary/ghost press animations go through `BrandTheme.animation` / `brandAnimation` / the Reduce Motion environment. A search of `.animation(` under `ios/NoMarkup` shows only those gated call sites. | Build EXIT:0. Reduce Motion was not toggled in a simulator. |
| SWIFT-6 | `KeychainTokenStore` is checked `Sendable`. `ClientActionLog` is `@MainActor`; the API actor enqueues hops with `enqueueHTTP`. | Build EXIT:0. `ActivityUpdateBox` stays `@unchecked Sendable` with a `// SAFETY:` comment: making it `@MainActor` failed `SendingRisksDataRace` on `Activity` (`ios-build-loop2.log`). |
| SWIFT-5 | `APIClient.tokenStore` is a `nonisolated` `Sendable` let. `didLogInsecureBase`, Spotlight donation fields, and the debug audit install flag are guarded by a named lock and a `// SAFETY:` comment. Session observer tokens stay `nonisolated(unsafe)` with a lifetime `// SAFETY:` comment so `deinit` can remove them. | Build EXIT:0. |
| MKT-18 | Site keywords no longer say “verified providers”. Report footers say moderators review the job, provider, or listing. The review share line no longer says “verified providers”. | Build EXIT:0. `brand_check.py` was not run. |
| HIG-privacy.1 | Location primers for nearby jobs and nearby listings have one button, “Continue”. | Build EXIT:0. |
| CRAFT-UX.6 | Notification primer has one button, “Continue”, which still confirms the system prompt. Location primers match that shape. Camera still has no primer before the system sheet. | Build EXIT:0. Not PASS. |
| HIG-alerts.3 | Pay-escrow and goods “Review payment” dismiss buttons are “Cancel”. Permission primers no longer use a “Not now” cancel button. | Build EXIT:0. |
| CRAFT-APP.16 | Text and icon gold uses `goldBright` (`#806316` in light). CTA fills stay `goldFill` / `goldBrightFill` so navy labels stay readable. | Build EXIT:0. No contrast scan. Not PASS. |

Commit `3beb9fc8` (already on this branch) is the earlier slice: server-priced service payments, Sign in with Apple code exchange and deletion revoke, goods fee and tax before PaymentSheet, server-escrow confirmation copy, purpose strings, and the round-0 accessibility copy. This report does not re-quote that commit’s Go tests.

## Still open

Human steps, unchanged: Apple Developer signing, a live privacy and support URL, App Store Connect metadata, screenshots, the nutrition label, age-rating answers, the review password, VoiceOver, Voice Control, Switch Control, and a physical device matrix.

Code still open includes the camera permission primer (CRAFT-UX.6), full contrast scan (CRAFT-APP.16), Dynamic Type `lineLimit` (WCAG-1.4.4), App Attest and live-key split (STRIPE-12, STRIPE-21), deterministic PaymentIntent keys when the client omits one (STRIPE-9), warnings as errors (CRAFT-PERF.11), and the excellence gate.

Migration `136_oauth_apple_refresh_token` is in `3beb9fc8` and is not applied here. Sign in with Apple revoke needs that migration and a real `APPLE_CLIENT_SECRET` for the stored client id. This report does not claim revoke is live.

The privacy page was not opened in a browser. `no-markup.com` is not provisioned from this tree.

## Disclaimer

This maps product evidence to Apple's published guidelines and documentation. It is not legal advice and not App Review, and does not guarantee approval. Re-verify against the canonical URLs before submission.
