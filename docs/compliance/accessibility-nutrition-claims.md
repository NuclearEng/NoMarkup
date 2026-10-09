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
| **Larger Text / Dynamic Type** | **No — do not claim yet** | **Code-complete (2026-07-27 re-audit):** 0 fixed `.system(size:)` fonts remain (was 69); money text scales and reflows; 11 `minimumScaleFactor` sites; `@ScaledMetric` on custom metrics (A11Y.2 FIXED in code). | AX5 on SE **not human-signed** — the remaining gate. | **Do not claim** until AX5 device pass is signed |
| **Dark Interface** | **No — do not claim yet** | **Forced dark removed (2026-07-27 re-audit):** app now adapts to the user’s system Light/Dark setting; brand tokens resolve per scheme. | Light + Dark visual pass on primary flows **not human-signed**. | **Do not claim** until the appearance pass is signed |
| **Differentiate Without Color** | **No** | Status uses chips + icons in many places, but no dedicated audit pass. | Pending. | **Defer** |
| **Enough Contrast** | Partial | Brand tokens; forced dark; high-contrast variants not shipped. | Pending. | **Defer** |
| **Reduced Motion** | **No** | Limited animation sites; no systematic `accessibilityReduceMotion` gating (A11Y.3 residual). | Pending. | **Do not claim** |
| **Captions / Audio Descriptions** | N/A | No media playback product surface. | — | **N/A** |
| **Accessible Navigation** | Partial | Tab bar + NavigationStack; full keyboard/iPad not proven. | Pending. | **Defer** as explicit claim |
| **VoiceOver — widgets / Live Activity** | Counts toward the VoiceOver claim | Labels for widget families (Active Bids, Next Closing) + Live Activity regions being added (IOS-A11Y.1 remediation, in flight 2026-07-27). | **Pending** — VoiceOver pass on Home/Lock Screen widgets + Live Activity required alongside the app VO pass. | **Implemented, pending verification** — the app-level VoiceOver claim must not be entered until widget surfaces pass too |

### ASC entry recommendation (copy)

> **Supported (intended claim after VoiceOver device pass — app AND widget/Live Activity surfaces):** VoiceOver  
> **Not declared for v1:** Larger Text, Dark Interface, Reduced Motion, Voice Control, captions  
> **Notes (internal):** Dynamic Type and un-forced dark are **code-complete** (2026-07-27); claims stay withheld until the human AX device passes (AX5, VO incl. widgets, Light/Dark) are signed — then flip Larger Text + Dark Interface here first, ASC second.

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
| VoiceOver widgets + Live Activity | | | | [ ] Pass [ ] Fail — **required before the VoiceOver claim** |
| Dynamic Type AX5 | | | | [ ] Pass [ ] Fail — **required before Larger Text claim** |
| Light/Dark appearance pass | | | | [ ] Pass [ ] Fail — **required before Dark Interface claim** |
| Reduce Motion | | | | [ ] Pass [ ] Fail |

---

## Packaging checklist link

Update [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) § Accessibility when ASC fields are filled. Mirror this table — **do not** invent extra claims.

---

*Owner: iOS a11y + ASC packaging. Dynamic Type + un-forced dark are code-complete; revisit (and flip claims) when the human AX device passes are signed.*
