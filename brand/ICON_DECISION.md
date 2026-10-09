# App icon — champagne metal M↓ master

**Date:** 2026-07-26  
**Master:** champagne **M↓** → `app-icon-1024.png` / `app-icon-champagne-m.png`  
**Positioning:** Premium reverse-auction marketplace — crystal monogram on brushed gold  
**SSOT tokens:** `docs/brand/showcase-ssot.md` · **icon lock:** this file

## Spec

| Element | Choice |
|---------|--------|
| Field | Brushed **champagne gold** metal (full-bleed RGB) |
| Mark | Crystal-white capital **M** with holographic prism edges |
| Signal | **Downward arrow** integrated with monogram = reverse auction / price down |
| Wordmark | **NoMarkup** under mark (homescreen master includes caption) |
| Rings | Dual thin gold seal rings |
| Not current | Terminal black + amber **N** (archived) |

## Files

| Path | Role |
|------|------|
| `brand/app-icon-1024.png` | Master archive copy |
| `brand/app-icon-champagne-m.png` | Named master |
| `brand/app-icon-preview-120.png` | SpringBoard-scale preview |
| `ios/.../AppIcon-1024.png` | **iOS home screen / App Store** |
| `web/public/app-icon-1024.png` + `icons/*` | Web / PWA |
| `brand/app-icon-terminal-master-37-archive.png` | Previous terminal N master (archive) |

## Mission fit

- **M** = Markup (name punch)  
- **↓** = competition drives price down  
- **Gold metal** = trust / craft / quality — not flea-market junk  
- **SpringBoard** = competes with glossy social icons  

## In-app

- SwiftUI: `ios/NoMarkup/Core/NoMarkupIcon.swift`  
- Web mark: `web/src/components/layout/BrandMark.tsx` (M↓)

## App Store notes

- 1024×1024 RGB, **no alpha**  
- Apple applies home-screen mask — canvas is full-bleed metal  
- After install: delete app + reinstall or reboot if SpringBoard caches old icon  
