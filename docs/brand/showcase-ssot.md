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

**Easings (showcase):**  
`--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` · `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)`

---

## Voice

- Prefer: “The market sets the price”, “Not the markup”, reverse auction, fair market rates, no middleman / no lead-gen markup.  
- Avoid: private vault, billionaire-only, jewelry metaphors as the sole story.  
- Full mission pillars: `docs/brand/mission-brand-north-star.md` (subordinate to this SSOT for visuals).

---

## Surface inventory

| Surface | Path | Must match |
|---------|------|------------|
| Showcase (master) | `qa/showcase/index.html` | Tokens + hero copy |
| Web tokens | `web/src/styles/globals.css` | Dark shell + brand gold |
| Web fonts | `web/src/app/layout.tsx` | Instrument / Syne / Outfit / JetBrains |
| Wordmark | `web/src/components/layout/Logo.tsx` | No + gold Markup, Syne |
| iOS theme | `ios/NoMarkup/Core/BrandTheme.swift` | Hex table above |
| Design system notes | `docs/design-system.md` | Points here for brand |
| App icon | Terminal amber **N** on black (see `brand/`) | Not jewelry diamond as sole story |

---

## Change control

1. Edit showcase first (or in the same PR as token code).  
2. Update this file’s tables.  
3. Propagate web + iOS + any hardcoded hex (`#07080b`, gold scale).  
4. Do not invent a third palette in feature work.
