# NoMarkup brand assets

## App icon (master)

| Asset | Path | Spec |
|-------|------|------|
| **App Store / iOS** | `ios/NoMarkup/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | 1024×1024 RGB, **no alpha** |
| **Web master** | `web/public/app-icon-1024.png` | same |
| **PWA** | `web/public/icons/icon-{192,512,maskable-512}.png` | generated from master |
| **Archive** | `brand/app-icon-1024.png` | source of truth copy |

### Design intent

Champagne-gold **embossed N** inside dual precision rings with a **large brilliant-cut diamond** at 12 o’clock on void navy (`#070b14`). v2 home-screen pop: **full champagne-gold field** with oversized navy **N** + diamond — dark navy tiles vanish next to Instagram/Tips; gold fill competes at a glance. Not a flat monogram sticker.

Apple applies the home-screen mask; the PNG is full-bleed square.

### Regeneration

Prefer regenerating from the design session masters under Grok session `images/`, or re-run the pipeline that:

1. Starts from the approved photoreal master
2. Forces outer canvas to navy (squircle exterior only)
3. Exports RGB 1024 with no alpha

Do **not** reintroduce the old flat “NM rings” Pillow monogram.

## Wordmark

In-product: `web/src/components/layout/Logo.tsx` + `BrandMark.tsx` (SVG mark + Syne wordmark, gold gradient on “Markup”).

## v3 — Frontier home-screen icon (current)

**Master:** `brand/app-icon-1024.png` / iOS AppIcon / web PWA

Design rules that won the home-screen fight:

1. **Full gold field** (never dark navy tile) — competes with Tips / Instagram chroma  
2. **Huge navy N** — thick geometric strokes; silhouette first at ~60pt  
3. **Large brilliant diamond** at 12 o’clock — white flash + prism fire  
4. **Dual thin rings** — brand seal without noise  
5. **RGB 1024, no alpha** — App Store compliant  

Preview at home-screen scale: `brand/app-icon-preview-120.png`
