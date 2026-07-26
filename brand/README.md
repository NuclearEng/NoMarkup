# NoMarkup brand assets

## App icon (master)

| Asset | Path | Spec |
|-------|------|------|
| **App Store / iOS** | `ios/NoMarkup/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | 1024×1024 RGB, **no alpha** |
| **Web master** | `web/public/app-icon-1024.png` | same |
| **PWA** | `web/public/icons/icon-{192,512,maskable-512}.png` | generated from master |
| **Archive** | `brand/app-icon-1024.png` | source of truth copy |

### Design intent

Champagne-gold **embossed N** inside dual precision rings with a **large brilliant-cut diamond** at 12 o’clock on void navy (`#070b14`). The gem is intentionally oversized for home-screen presence (auction seal × escrow trust × luxury). Not a flat monogram sticker.

Apple applies the home-screen mask; the PNG is full-bleed square.

### Regeneration

Prefer regenerating from the design session masters under Grok session `images/`, or re-run the pipeline that:

1. Starts from the approved photoreal master
2. Forces outer canvas to navy (squircle exterior only)
3. Exports RGB 1024 with no alpha

Do **not** reintroduce the old flat “NM rings” Pillow monogram.

## Wordmark

In-product: `web/src/components/layout/Logo.tsx` + `BrandMark.tsx` (SVG mark + Syne wordmark, gold gradient on “Markup”).
