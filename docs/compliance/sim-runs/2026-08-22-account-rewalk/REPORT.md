# Account re-walk — 2026-08-22

## What you saw

The previous XCUITest used `app.swipeUp()` / `swipeDown()` up to ~30 times **per row**, and required the **entire cell** to sit 130pt above the tab bar. SwiftUI list frames are often taller than the tap target, so the runner looked idle: fling the whole window, never tap.

That run was **killed**. Harness now:

- Drags **mid-list** only (y 0.58 → 0.30)
- Taps when the **tap point** (25% from top of the row) is above the tab capsule
- Caps hunt at 6+3 swipes, then skip

## Proof (tap smoke)

`test09AccountRowTapSmoke` **TEST SUCCEEDED** (~4 min including compile).

| Shot | File |
|------|------|
| Login | `test09AccountRowTapSmoke-01-tap-smoke-login-form.png` |
| Account root | `…-02-tap-smoke-account-root.png` |
| Profile | `…-03-tap-smoke-profile.png` |
| Security | `…-04-tap-smoke-security.png` |
| Payment methods | `…-05-tap-smoke-paymentMethods.png` |
| Orders | `…-06-tap-smoke-orders.png` |
| Back on Account | `…-07-tap-smoke-still-alive.png` |

Payment methods opened the methods screen, not Jobs.

## Full sweep

`test06CustomerAccountRowIDSweep` restarted with the new helpers (background). Prior killed run had already opened inner destinations (plan limits, payment methods, contracts, orders, bids, listings, watchlist) before the fling loop.

## Related (this session)

- Live catalog: 4 personas PASS (`SEED_PASSWORD` + gateway :8081)
- Device Apple Pay/APNs/Face ID: phone **online**, XCTest **BLOCKED** on Enable UI Automation / Face ID (user must accept on the device)
- Founder DNS/ASC/`DEPLOY_PROVISIONED`: still Founder-only (`docs/compliance/founder-residuals-2026-08-22.md`)
