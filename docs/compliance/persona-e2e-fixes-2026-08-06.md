# Persona e2e / UITest issue closeout — 2026-08-06

Closes residual product + harness findings from persona e2e, sim UI audit, and full UITest suite.

## Fixed this pass

| ID | Issue | Fix |
|----|-------|-----|
| **A1** | Admin horizontal tabs: `isHittable` throw / invalid activation point | Product: `ScrollViewReader` + a11y tab ids + hit targets (`ParitySurfacesView`). Harness: geometric `isOnScreen` / `safeTap` / `tapAdminConsoleTab` |
| **A2** | Account legal Safari pushed on nav stack (tab chrome lost) | `AccountView` legal/support open as **sheet** (`LegalWebView` / SFSafari) |
| **A3** | Account stack overflow risk | All Account `NavigationLink`s wrap destinations in `LazyView` |
| **A4** | Nested hub stack pressure (Business & finance, Providers, Contracts, Jobs, My bids) | `LazyView` on destinations in hub/list views |
| **A5** | UITest harness still used raw `isHittable` (throw under clip) | `NoMarkupUITests`, `ScreenshotWalkUITests`, `TabAuditUITests` — no product-path `isHittable` probes |
| **A6** | Soft 404 `GET /api/v1/saved-searches` in API probe | Gateway aliases `/saved-searches` → same handlers as `/me/saved-searches` |
| **A7** | Draft capacity 422 blocks customer write smoke | `scripts/dev/free-customer-draft-capacity.sh` cancels seed drafts |
| **A8** | Admin banking remove used bare `window.confirm` | `ActionConfirmDialog` (same pattern as advances) |

## Already green before this pass (verified, not re-broken)

| Area | Status |
|------|--------|
| Dual-role mobile tabs keep **Jobs** for customer+provider | Shipped in `MobileTabBar` |
| Job map NaN LngLat guard | `hasRealLocation` in `JobMap.tsx` |
| Recurring “Pause” lie | Replaced with **End recurrence** + confirm |
| Admin advances confirm | `ActionConfirmDialog` present |
| Analytics dual-role | Shows **both** customer + provider panels |
| Platform “analytics preview” | Explicitly **this browser only** (not platform-wide) |

## Intentionally not product bugs

| Item | Notes |
|------|-------|
| Concurrent multi-agent sim SIGKILL | Ops — exclusive UITest runs |
| Stripe “Not configured” without publishable key | Env expected in local Debug |
| Sealed bid list 403 for non-owner | Correct authz |
| Dual-role seed JWT | Seed design |

## Verify

```bash
# iOS
xcodebuild build-for-testing -scheme NoMarkup -project ios/NoMarkup.xcodeproj \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  NOMARKUP_API_BASE_URL=http://127.0.0.1:8081
# → TEST BUILD SUCCEEDED (2026-08-06)

# Draft free
./scripts/dev/free-customer-draft-capacity.sh http://127.0.0.1:8081 5
```

## Residual (ops / product backlog, non-blocking)

1. Exclusive re-run of `test06`–`test08` when sim free (harness ready).
2. Admin payments “custom fees” still localStorage-only — labeled in UI; wire to fee-config API later.
3. Physical device dogfood / Lightsail prod — capital-light defer.
