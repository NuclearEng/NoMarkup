# App Store screenshot matrix (iOS)

**Audit IDs:** IOS-DES.14 · IOS-DIST.5  
**Updated:** 2026-07-27  
**Related:** [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) §6 · Apple Design Resources

## Current required display sizes (prepare these)

Do **not** rely only on retired 6.7" / 12.9" guidance. Capture on **current** families:

| Priority | Display class | Example simulators | Notes |
|----------|---------------|--------------------|--------|
| **Required** | **6.9" iPhone** | iPhone 16 Pro Max / 17 Pro Max class | Primary iPhone set for modern ASC |
| **Required** (universal binary) | **13" iPad** | 13" iPad Pro | Universal `TARGETED_DEVICE_FAMILY = 1,2` |
| Optional / if ASC prompts | 6.5" / 6.7" iPhone | iPhone 15 Pro Max / 16 Plus class | Legacy slots if still shown |
| Optional | 12.9" iPad | Older iPad Pro | Only if ASC still lists |

Portrait by default. Prefer **native SwiftUI** chrome (Guideline **4.2** — not Safari shots of the marketing site).

**Status:** Media boxes open — **no** production iOS screenshots committed under `ios/` yet. Capture is **human/ops**.

---

## Scene shot list (from packaging checklist)

| # | Scene | Show | Tab / path | Avoid |
|---|--------|------|------------|--------|
| 1 | **Home** | Market context / value prop; launch gates honest | Home | Regulated rails as core pitch |
| 2 | **Marketplace** | Local pickup goods browse | Marketplace | Fake prices / stock photos that contradict seed |
| 3 | **Job detail** | Single job (budget/category; location coarsened) | Jobs → detail | Exact street if product coarsens |
| 4 | **Login + SIWA** | Email/password **and** system Sign in with Apple (equal prominence) | Login | Competitor logos |
| 5 | **Account / legal** | Privacy, Terms, Support; Delete Account entry; free-tier / no StoreKit notice OK | Account | IAP price wall |
| 6 | **Catalog beat** | Second list (Jobs **or** Marketplace scroll) proving non-thin shell | Jobs or Marketplace | Empty crash |

Optional if slots remain: Messages list/empty; listing detail; My Bids.

**Hard avoid in every frame:** BNPL, working capital, insurance purchase, legal services, lead-gen, instant payout, fake StoreKit prices, competitor keyword spam in overlays.

---

## Capture procedure

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
open ios/NoMarkup.xcodeproj
# Run on 6.9" iPhone simulator + 13" iPad simulator
# File → New Screen Recording / device screenshot shortcuts
# Use Apple Design Resources frames for marketing polish if desired
```

| Step | Done? |
|------|:-----:|
| Gateway + seed for realistic catalog | [ ] |
| 6.9" iPhone set (§ scenes 1–6) | [ ] |
| 13" iPad set (same scenes) | [ ] |
| App Icon 1024 present (`AppIcon-1024.png`) | [x] terminal master 37 |
| Uploaded to ASC Media Manager | [ ] |

---

## App preview video

Optional for v1. Same dual-rail honesty rules.

---

*DES.14 marketing assets: plan done; pixels are ops residual.*
