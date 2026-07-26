# NoMarkup brand assets

## Single source of truth

| Layer | Path |
|-------|------|
| **Visual + narrative master** | `qa/showcase/index.html` |
| **Token tables** | `docs/brand/showcase-ssot.md` |
| **Mission pillars** | `docs/brand/mission-brand-north-star.md` |

**Tagline:** The Market Sets The Price. Not The Markup.  
**Wordmark:** `No` + gold **Markup** (Syne).  
**Shell:** `#07080b` · gold `#c9a84c` / `#e4c566` · type Instrument Serif / Syne / Outfit / JetBrains Mono.

---

## App icon (master)

| Asset | Path | Spec |
|-------|------|------|
| **App Store / iOS** | `ios/NoMarkup/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | 1024×1024 RGB, **no alpha** |
| **Web master** | `web/public/app-icon-1024.png` | same |
| **PWA** | `web/public/icons/icon-{192,512,maskable-512}.png` | generated from master |
| **Archive** | `brand/app-icon-1024.png` | source of truth copy |

### Design intent (current)

**Terminal amber N** on **pure black `#000000`** (master **37** — `brand/ICON_DECISION.md`) — Bloomberg-grade monogram, optional down-chevron for reverse-auction “price down.” Not a jewelry diamond as the sole brand story (see mission north star).

| Layer | Hex | Notes |
|-------|-----|--------|
| Icon outer canvas | `#000000` | Shipped 1024 masters sample pure black at corners — keep it |
| In-product dark shell | `#07080b` | Showcase / web / iOS chrome only — **not** a requirement to recolor the icon field |

Apple applies the home-screen mask; the PNG is full-bleed square.

### Regeneration

Prefer regenerating from approved session masters under Grok session `images/`, or re-run the pipeline that:

1. Starts from the approved terminal monogram master (candidate 37 lineage)  
2. Keeps outer canvas **pure black `#000000`** (do not silently recolor to `#07080b`)  
3. Exports RGB 1024 with no alpha  

Do **not** reintroduce diamond-only jewelry marks as the product icon without an explicit brand decision.

---

## Wordmark

In-product: `web/src/components/layout/Logo.tsx` + `BrandMark.tsx` (SVG mark + Syne wordmark, gold on “Markup”).
