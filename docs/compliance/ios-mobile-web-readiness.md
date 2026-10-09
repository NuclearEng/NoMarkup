# iPhone / iPad mobile web readiness

**Date:** 2026-07-26  
**Scope:** Responsive mobile web (Safari iOS / iPadOS). Not a native App Store binary.

## Goals

Operate fully on phone and tablet viewports (320px–1024px+) with:

- 44×44pt minimum touch targets (Apple HIG)
- Safe-area insets (notch, Dynamic Island, home indicator)
- No iOS input zoom (form controls ≥16px)
- Landscape allowed on iPad (manifest `orientation: any`)
- Thumb-reachable navigation (bottom tab bar when signed in; hamburger when signed out)

## Implemented controls

| Area | Implementation |
|------|----------------|
| Viewport | `viewportFit: cover`, `interactiveWidget: resizes-content` in `web/src/app/layout.tsx` |
| Dynamic height | `min-h-[100dvh]` public + dashboard layouts; globals map `.min-h-screen` → `100dvh` |
| Horizontal overflow | `overflow-x-clip` on body and main shells |
| Safe areas | Header sticky top inset; footer/cookie/dialog bottom insets; MobileTabBar spacer |
| Legal docs | Collapsible TOC under `lg`; 44px TOC links; scroll-margin under sticky header |
| Dialogs / reports | Max height `90dvh`, scrollable body, 44px close control |
| Cookie banner | Safe-area bottom; 44px toggle rows and buttons |
| Mobile nav | Marketplace, Map, Jobs, Support, Privacy, Terms on logged-out menu; Post job / Support / Account when signed in |
| Forms | Input/Textarea/Select `text-base` on small screens |
| PWA manifest | `orientation: any` (iPad landscape) |

## Manual QA checklist (device or Simulator)

1. **iPhone SE (320–375):** Landing → Marketplace → listing report dialog → Support mailto form; no horizontal scroll.
2. **iPhone 15 Pro notch:** Header under status bar; cookie banner above home indicator; bottom tabs clear content.
3. **iPad landscape:** Marketplace grid usable; sticky legal TOC on wide width; hamburger only &lt; md.
4. **Keyboard:** Focus support form fields — page resizes; field remains visible.
5. **Zoom:** Double-tap not required; pinch-zoom still allowed (a11y).

## Out of scope (native)

See `ios-payment-rails-design.md` for StoreKit dual-rail and native shell. This document is **mobile Safari / standalone web** only.
