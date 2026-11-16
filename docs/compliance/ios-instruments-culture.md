# iOS Instruments culture — NoMarkup (IOS-PERF.1)

**Program:** Pre-ship performance discipline for the native iOS client  
**Updated:** 2026-08-05  
**Related:** [`ios/README.md`](../../ios/README.md) · [`device-smoke-checklist.md`](./device-smoke-checklist.md) · monorepo budgets in `Claude.md` §8 / `docs/performance.md`

This doc is the **required Instruments culture** for Release candidates. Unit tests and simulator dogfood are not a substitute for a Time Profiler + Allocations pass on a physical device (or closest available simulator when hardware is blocked).

---

## Required templates (pre-ship)

| Template | Required? | What to look for |
|----------|:---------:|------------------|
| **Time Profiler** | **Yes** | Main-thread hangs; hotspots on cold launch, tab switch, list scroll, job/listing detail open |
| **Allocations** | **Yes** | Steady growth while scrolling marketplace/jobs; retain cycles after open→back on detail |
| **SwiftUI** (or **Hangs**) | Optional | Body recompute storms; hang ≥250ms on interactive surfaces |
| Leaks | Optional | Confirm no growing leaked objects after 3–5 open/close cycles on detail |

Run against the **NoMarkup** scheme, **Release** configuration (Debug optimizes poorly and inflates noise).

---

## Target budgets (iOS-adapted)

Align with project p95 / LCP-style goals; iOS equivalents:

| Metric | Target | Notes |
|--------|--------|-------|
| Cold launch → first interactive chrome | **&lt; 2.0 s** | Login or tab shell visible and tappable |
| Scroll (Marketplace / Jobs lists) | **60 fps** sustained | No multi-frame freezes on default seed data |
| Tab switch | **&lt; 100 ms** perceived | No blank multi-second stalls |
| Memory (steady browse) | **Flat after warm-up** | No unbounded climb across 2–3 min scroll/open cycles |
| Detail open (job or listing) | **&lt; 500 ms** to skeleton / first paint | Network may finish later; UI must not hang |

These are **acceptance targets for the Instruments sign-off**, not CI-gated SLAs. Failures need a ticket or accepted residual before ASC upload.

---

## How to capture

1. Open `ios/NoMarkup.xcodeproj` in **Xcode 26.x**.
2. Select scheme **NoMarkup**, destination a **physical iPhone** preferred (SE or Pro Max class from the device matrix).
3. Product → **Scheme → Edit Scheme…** → **Profile** → Build Configuration = **Release**.
4. Product → **Profile** (`⌘I`).
5. Choose **Time Profiler** (first pass). Record:
   - Cold launch
   - Sign-in or scaffold → switch all five tabs
   - Scroll Marketplace + Jobs ~30 s each
   - Open a job detail + listing detail, back out twice
6. Stop recording. In Call Tree: invert + hide system libraries; note top app symbols on main thread.
7. Repeat with **Allocations**: mark generations after launch and after each detail cycle; confirm Generations do not climb unboundedly.
8. (Optional) **SwiftUI** / **Hangs** template on the same path.

CLI alternative (when GUI Instruments is inconvenient):

```bash
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-26.5.0.app/Contents/Developer}"
cd ios
# Build Release for device/sim, then attach Instruments templates via Xcode Profile UI.
# Prefer Product → Profile for Time Profiler / Allocations; CLI `xctrace` is optional.
```

Archive the `.trace` only if filing a performance bug; otherwise keep a short note in the sign-off table below (date, device, pass/fail).

---

## Sign-off checkbox

Copy into release notes / launch board when claiming PERF.1 culture for a build:

| # | Check | Pass | Fail | Tester / date | Notes |
|---|-------|:----:|:----:|---------------|-------|
| I1 | Time Profiler — cold launch &lt; 2 s interactive | [ ] | [ ] | | |
| I2 | Time Profiler — list scroll no multi-frame freezes | [ ] | [ ] | | |
| I3 | Allocations — steady memory after warm-up browse | [ ] | [ ] | | |
| I4 | (Optional) SwiftUI/Hangs — no ≥250 ms hangs on primary paths | [ ] | [ ] | | |
| I5 | Residual tickets filed for any Fail | [ ] | [ ] | | ticket IDs |

**Overall Instruments culture:** [ ] PASS · [ ] FAIL (block ship claim) · [ ] PASS with accepted residual

---

## What this does *not* replace

- **Device smoke matrix** (`device-smoke-checklist.md`) — functional + a11y human pass  
- **k6 / backend p99 budgets** — server-side  
- **Field RUM / MetricKit** — not required for v1 eng close; future residual  

---

## DIST note (support URL)

Founder ASC packaging already locks **Support URL** to `https://no-markup.com/support` ([`asc-packaging-checklist.md`](./asc-packaging-checklist.md)). Live HTTP reachability from the review network remains a **founder/ops** verification step (IOS-DIST.17), not an Instruments item.
