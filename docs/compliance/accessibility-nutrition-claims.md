# Accessibility Nutrition Label — claims evidence (iOS)

**Audit IDs:** IOS-A11Y.6 · IOS-DIST.8  
**Updated:** 2026-07-27  
**ASC field:** App Store Connect → App Privacy / Accessibility (nutrition-style feature list; exact UI label may vary by ASC version)

## Claim discipline

| Rule | Application |
|------|-------------|
| **Claim only what is verified** | If Dynamic Type / Reduce Motion are incomplete, **do not** declare them. |
| **Evidence = code + human pass** | Code evidence is necessary; VoiceOver / AX5 device passes are required before “verified”. |
| **Overclaim = rejection risk** | Prefer fewer features with honest notes over a full green checklist. |

---

## Feature claim table (first public binary)

| ASC feature | Claim for v1? | Code / product evidence | Human verification | Status |
|-------------|---------------|-------------------------|--------------------|--------|
| **VoiceOver** | **Yes — claim** | Widespread `accessibilityLabel` / hints / combined elements; custom `MarketRangeBar` labeled; icon-only buttons labeled (audit A11Y.1). | **Pending** VoiceOver pass on Home, Marketplace, Job detail, Listing detail, Login, Account. | **Claim OK after VO pass** |
| **Voice Control** | Optional later | Uses system controls + labels → generally inherits. | Not separately tested. | **Defer** (do not claim until smoke includes Voice Control) |
| **Larger Text / Dynamic Type** | **No — do not claim yet** | Partial: some `@ScaledMetric` (e.g. `BrandTheme` seal, Home thumbs, Messages icons). Many fixed `.system(size:)` / money `lineLimit(1)` still present (A11Y.2 residual). | AX5 on SE **not human-signed**. | **Do not claim** until A11Y.2 closed + AX5 signed |
| **Dark Interface** | Product forces dark | App-wide dark shell; not “user can choose Light/Dark”. | N/A for “supports Dark Mode adaptivity”. | **Do not claim “Dark Mode support” as adaptivity** — we force dark |
| **Differentiate Without Color** | **No** | Status uses chips + icons in many places, but no dedicated audit pass. | Pending. | **Defer** |
| **Enough Contrast** | Partial | Brand tokens; forced dark; high-contrast variants not shipped. | Pending. | **Defer** |
| **Reduced Motion** | **No** | Limited animation sites; no systematic `accessibilityReduceMotion` gating (A11Y.3 residual). | Pending. | **Do not claim** |
| **Captions / Audio Descriptions** | N/A | No media playback product surface. | — | **N/A** |
| **Accessible Navigation** | Partial | Tab bar + NavigationStack; full keyboard/iPad not proven. | Pending. | **Defer** as explicit claim |

### ASC entry recommendation (copy)

> **Supported (intended claim after VoiceOver device pass):** VoiceOver  
> **Not declared for v1:** Larger Text, Reduced Motion, Voice Control, captions  
> **Notes (internal):** Dynamic Type remediation in progress; re-open nutrition label when A11Y.2/A11Y.3 + AX5 sign-off land.

---

## Evidence paths (VoiceOver)

| Surface | Primary files |
|---------|----------------|
| Labels / hints volume | Feature views under `ios/NoMarkup/Features/` |
| Market range | `ios/NoMarkup/Features/MarketRangeBar.swift` |
| Money entry | `ios/NoMarkup/Core/BrandTheme.swift` (DollarAmountField) |
| Audit baseline | `docs/compliance/ios-developer-audit-2026-07-27.md` § IOS-A11Y.1 |

## Device pass template (required before claiming more)

Use [`device-smoke-checklist.md`](./device-smoke-checklist.md) rows **AX-VO**, **AX5**, **SE**, **iPad**.  
Sign only after human execution — never mark verified from code review alone.

| Feature | Tester | Date | Device / OS | Result |
|---------|--------|------|-------------|--------|
| VoiceOver primary flows | | | | [ ] Pass [ ] Fail |
| Dynamic Type AX5 | | | | [ ] Pass [ ] Fail — **required before Larger Text claim** |
| Reduce Motion | | | | [ ] Pass [ ] Fail |

---

## Packaging checklist link

Update [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) § Accessibility when ASC fields are filled. Mirror this table — **do not** invent extra claims.

---

*Owner: iOS a11y + ASC packaging. Revisit when Dynamic Type rollout completes.*
