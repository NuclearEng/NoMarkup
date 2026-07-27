# NoMarkup brand — single source of truth

> **Canonical visual + narrative:** `qa/showcase/index.html`  
> All product surfaces (web dark shell, iOS native, marketing, icons) align to this document.  
> If code and this file diverge, **fix code** (or update this file only when the showcase deliberately changes).

---

## Promise

| Line | Use |
|------|-----|
| **The Market Sets The Price. Not The Markup.** | Hero / primary tagline |
| Wordmark | `No` + gold **`Markup`** (Syne 800, gold on “Markup”) |
| Product | Reverse-auction service marketplace (+ local goods rail) |
| Positioning | Customers post jobs → qualified providers compete → fair market rates. Everyone wins except the middleman. |

**Not:** jewelry / UHNW vault / flea-market chaos.  
**Is:** terminal-grade clarity, fair price discovery, craft + confidence (navy + gold).

---

## Color tokens (exact hex)

| Token | Hex / value | Role |
|-------|-------------|------|
| `bg-primary` | `#07080b` | App chrome, body, nav blur base |
| `bg-surface` | `#0e1017` | Secondary surfaces, muted fills |
| `bg-card` | `#14161e` | Cards, popovers, list rows |
| `bg-card-hover` | `#1a1d28` | Hover / pressed card |
| `bg-elevated` | `#1e2130` | Raised chrome, elevated panels |
| `gold` | `#c9a84c` | Brand gold (CTAs, wordmark Markup, accents) |
| `gold-dim` | `#a08839` | Gold shadow / dim state |
| `gold-bright` | `#e4c566` | Emphasis gold (labels, highlights) |
| `gold-glow` | `rgba(201, 168, 76, 0.4)` | Soft glow |
| `teal` | `#4ecdc4` | Secondary accent (live / data) |
| `teal-dim` | `#2a9d8f` | Teal muted |
| `red` | `#ef4444` | Destructive |
| `green` | `#22c55e` | Success / winning |
| `green-dim` | `#16a34a` | Success muted |
| `text-primary` | `#e8ecf1` | Body / titles on dark |
| `text-secondary` | `#8b949e` | Muted copy |
| `text-tertiary` | `#484f58` | Tertiary / disabled-adjacent |
| `border` | `rgba(255,255,255,0.06)` | Hairline borders |
| `border-strong` | `rgba(255,255,255,0.12)` | Stronger dividers |

**Do not use legacy navy `#070b14` or shifted dark golds `#d4af57` / `#e0c060` / `#e8c76e`.** Those were pre-showcase drift.

### Web mapping (`.dark` / light brand)

| Showcase | Web CSS var |
|----------|-------------|
| `bg-primary` | `--background` |
| `bg-surface` | `--secondary`, `--muted`, `--accent` (dark) |
| `bg-card` | `--card`, `--popover` |
| `bg-elevated` | elevated / sidebar accents |
| `gold` / dim / bright | `--brand-gold*` (same in light + dark) |
| `text-primary` | `--foreground` |
| `text-secondary` | `--muted-foreground` |

### iOS mapping (`BrandTheme`)

| Showcase | Swift |
|----------|--------|
| `bg-primary` | `navy` |
| `bg-card` | `navyElevated` |
| `bg-surface` / raised | `surfaceRaised` |
| `gold` / `gold-bright` | `gold` / `goldBright` |
| `text-primary` / `secondary` | `textPrimary` / `textSecondary` |
| `green` | `success` / bid winning |

---

## Typography

| Role | Family | Weights | CSS / use |
|------|--------|---------|-----------|
| **Display** | Instrument Serif | 400 + italic | Hero titles, section titles |
| **Heading** | Syne | 500–800 | Wordmark, UI headings |
| **Body** | Outfit | 300–700 | Body, UI copy |
| **Mono** | JetBrains Mono | 400–600 | Section labels, prices, timers, data |

**Web:** loaded via `next/font` in `web/src/app/layout.tsx`; CSS maps `--font-display` / `--font-heading` / `--font-sans` / `--font-mono`.  
**iOS:** system serif / monospaced approximations for hero + labels is acceptable on-device (no custom font bundle required for B0); voice and color must still match.

**Easings (showcase):**  
`--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` · `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)`

---

## App icon

| Item | Spec |
|------|------|
| **Master** | Champagne metal **M↓** — see `brand/ICON_DECISION.md` |
| **Mark** | Crystal-white capital **M** + down arrow (reverse auction / price down) |
| **Field** | Brushed champagne-gold metal, full-bleed RGB |
| **Wordmark** | **NoMarkup** under monogram on homescreen master |
| **Archived** | Terminal pure black + amber **N** (master 37) → `brand/app-icon-terminal-master-37-archive.png` |

### Icon canvas vs product shell

| Layer | Spec | Why |
|-------|------|-----|
| **App icon field** | Champagne brushed gold (full-bleed) | SpringBoard pop vs Tips / social |
| **In-product dark shell** | `#07080b` | Showcase body / nav / chrome |

Favicons and `BrandMark` follow the M↓ silhouette (not a second brand).

---

## Voice

- Prefer: “The market sets the price”, “Not the markup”, reverse auction, fair market rates, no middleman / no lead-gen markup.  
- Avoid: private vault, billionaire-only, jewelry metaphors as the sole story.  
- Full mission pillars: `docs/brand/mission-brand-north-star.md` (subordinate to this SSOT for visuals).  
- UHNW trust bar: `docs/brand/billionaire-seller-standard.md` (craft bar for high-ticket rails — **not** the product icon story).

---

## Surface matrix (repo scan)

Status key: **aligned** · **partial** · **out of scope** · **docs fixed** (was wrong, corrected this pass).

| Surface | Path / note | Status |
|---------|-------------|--------|
| Showcase (master) | `qa/showcase/index.html` | **aligned** |
| Token SSOT | this file | **aligned** |
| Mission north star | `docs/brand/mission-brand-north-star.md` | **aligned** (narrative; icon = M↓ champagne) |
| Billionaire-seller bar | `docs/brand/billionaire-seller-standard.md` | **partial** — craft bar OK; product icon is champagne M↓ |
| Design system doc | `docs/design-system.md` | **aligned** (showcase stack + tokens) |
| CLAUDE.md §4 | HIG + brand type | **aligned** (showcase stack named; HIG “clarity” ≠ system-only type) |
| Web dark tokens | `web/src/styles/globals.css` `.dark` | **aligned** (`#07080b`, gold scale, font maps) |
| Web fonts | `web/src/app/layout.tsx` + Tailwind `@theme` | **aligned** Instrument / Syne / Outfit / JetBrains |
| Wordmark | `web/src/components/layout/Logo.tsx` | **aligned** No + gold Markup, Syne |
| Brand mark SVG | `web/src/components/layout/BrandMark.tsx` | **aligned** M↓ monogram |
| Landing hero | `web/src/app/(public)/LandingPageClient.tsx` | **aligned** tagline + `font-display` + mono eyebrow |
| PWA manifest | `web/public/manifest.json` | **aligned** `theme_color` / `background_color` `#07080b` |
| Next `themeColor` | `web/src/app/layout.tsx` | **aligned** `#07080b` |
| Favicon / Apple touch | `web/src/app/icon.tsx`, `apple-icon.tsx` | **aligned** champagne M↓ silhouette |
| App icon 1024 masters | `brand/`, `web/public/`, iOS AppIcon | **aligned** champagne metal M↓ + NoMarkup |
| PWA icon PNGs | `web/public/icons/icon-*.png` | **aligned** from champagne master |
| iOS `BrandTheme` | `ios/NoMarkup/Core/BrandTheme.swift` | **aligned** hex table |
| iOS AccentColor | `Assets.xcassets/AccentColor` | **aligned** brand gold (verify catalog if CTAs drift) |
| iOS home / login voice | `HomeView.swift` (tagline shipped) | **aligned** voice; system serif ≈ display |
| Launch board brand lines | `docs/compliance/launch-board.md` | **docs fixed** — was “SOTA seal / diamond” |
| iOS README brand | `ios/README.md` | **docs fixed** — was diamond seal as current |
| Security / audit narratives | various `docs/` | **out of scope** unless they claim *current* brand wrong |
| Light-mode shell | `:root` light tokens | **partial** — gold tokens shared; light chrome is product UI, not showcase dark master |
| Email / transactional HTML | if any | **out of scope** unless brand campaign |
| Android / other clients | — | **out of scope** |

---

## Surface inventory (paths)

| Surface | Path | Must match |
|---------|------|------------|
| Showcase (master) | `qa/showcase/index.html` | Tokens + hero copy |
| Web tokens | `web/src/styles/globals.css` | Dark shell + brand gold |
| Web fonts | `web/src/app/layout.tsx` | Instrument / Syne / Outfit / JetBrains |
| Wordmark | `web/src/components/layout/Logo.tsx` | No + gold Markup, Syne |
| iOS theme | `ios/NoMarkup/Core/BrandTheme.swift` | Hex table above |
| Design system notes | `docs/design-system.md` | Points here for brand |
| App icon | Champagne metal **M↓** + NoMarkup (`brand/ICON_DECISION.md`) | SpringBoard / App Store master |
| Landing hero | `web/src/app/(public)/LandingPageClient.tsx` | Tagline + Instrument display + mono labels |
| iOS home / login | `HomeView.swift`, `LoginView.swift` | Same voice as showcase |

---

## Change control

1. Edit showcase first (or in the same PR as token code).  
2. Update this file’s tables.  
3. Propagate web + iOS + any hardcoded hex (`#07080b`, gold scale).  
4. Icon masters: follow `ICON_DECISION.md` (current: champagne M↓ full-bleed gold).  
5. Do not invent a third palette in feature work.
