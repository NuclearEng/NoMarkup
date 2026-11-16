# NoMarkup brand assets

## Single source of truth

| Layer | Path |
|-------|------|
| **Visual + narrative master** | `qa/showcase/index.html` |
| **Token tables** | `docs/brand/showcase-ssot.md` |
| **App icon lock** | `brand/ICON_DECISION.md` |
| **Mission pillars** | `docs/brand/mission-brand-north-star.md` |

**Tagline:** The Market Sets The Price. Not The Markup.  
**Wordmark:** `No` + gold **Markup** (Syne).  
**Shell:** `#07080b` · gold `#c9a84c` / `#e4c566`.  
**App icon:** Champagne metal **M↓** (not terminal N).

---

## App icon (current master)

| Asset | Path | Spec |
|-------|------|------|
| **App Store / iOS** | `ios/NoMarkup/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | 1024×1024 RGB, **no alpha** |
| **Web master** | `web/public/app-icon-1024.png` | same |
| **PWA** | `web/public/icons/icon-{192,512,maskable-512}.png` | from master |
| **Archive** | `brand/app-icon-1024.png` · `brand/app-icon-champagne-m.png` | source copies |

### Design intent (current)

Brushed **champagne-gold** field, crystal **M** with holographic edges, **down arrow** (price competition), optional **NoMarkup** caption. Full-bleed metal for SpringBoard.

**Previous master (archived):** terminal amber **N** on pure black — `brand/app-icon-terminal-master-37-archive.png`.

Apple applies the home-screen mask; the PNG is full-bleed square.

---

## Wordmark / mark in product

- Web: `Logo.tsx` + `BrandMark.tsx` (M↓ SVG)  
- iOS in-app: `NoMarkupIcon.swift`  
