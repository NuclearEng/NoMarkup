# NoMarkup — Design System & UI Standards (detailed)

> Offloaded from `CLAUDE.md` §4 to keep the always-loaded rules file lean. CLAUDE.md keeps the
> WCAG AA mandate and the token/component rule bullets; full detail lives here.

## Design Philosophy
Follow platform-native quality. The web app must feel as polished as a native iOS/Android app.

## Apple Human Interface Guidelines (applied to web)
- **Clarity**: Content is paramount. Every design element serves the content. No decorative chrome.
- **Deference**: UI helps people understand and interact with content — never competes with it.
- **Depth**: Visual layers and realistic motion give vitality and convey hierarchy.
- **Direct manipulation**: Manipulate content directly rather than through abstract controls.
- **Feedback**: Acknowledge every action. Highlight results. Indicate progress.
- **Consistency**: Use familiar patterns. Same action = same result everywhere.
- **Typography**: System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`). Only 3-4 font sizes per page.
- **Touch targets**: Minimum 44x44px for all interactive elements (Apple's 44pt minimum).

## Material Design 3 Principles (applied to web)
- **Adaptive layouts**: breakpoints — compact (<600px), medium (600-840px), expanded (840-1200px), large (>1200px).
- **Color system**: dynamic color with semantic tokens (primary, secondary, tertiary, error, surface, on-surface). Light and dark themes mandatory.
- **Elevation**: shadow tokens, not arbitrary box-shadows. 5 elevation levels.
- **Motion**: meaningful transitions only. Enter: 250ms ease-out. Exit: 200ms ease-in.
- **Components**: established patterns (FAB, bottom sheets, cards, chips, dialogs, snackbars).
- **Navigation**: persistent nav rail on desktop, bottom nav on mobile. Never more than 5 top-level destinations.

## WCAG 2.2 AA Compliance (Mandatory)

All four principles — **Perceivable, Operable, Understandable, Robust** — at AA level minimum.

**Perceivable:**
- All images: meaningful `alt` text or `role="presentation"` for decorative
- Color contrast: 4.5:1 normal text, 3:1 large text (18px bold / 24px regular)
- Don't use color alone to convey meaning — pair with icon, text, or pattern
- Captions for all video/audio. Text resizable to 200% without breaking layout.

**Operable:**
- Full keyboard navigation. Every interactive element reachable via Tab.
- Visible focus indicators (min 2px outline, 3:1 contrast). Skip-nav link first focusable.
- No keyboard traps. Min touch targets 44x44px (24x24px absolute min w/ 44px spacing).
- No time-limited interactions without user control (bidding timers show remaining time + extension).

**Understandable:**
- Form errors: inline, associated via `aria-describedby`, specific ("Email must include @").
- Language attribute on `<html>`. Consistent navigation. `autocomplete` for input purpose.

**Robust:**
- Valid HTML — no duplicate IDs, proper nesting. ARIA only when native semantics insufficient.
- Live regions (`aria-live`) for dynamic content (bid updates, chat, notifications).
- Test with screen readers: VoiceOver (macOS/iOS), NVDA (Windows).

## Tailwind Design Tokens

**Live source of truth:** `web/src/styles/globals.css` (`:root` / `.dark` CSS vars + `@theme inline`).
Tailwind v4 maps `--color-*`, `--shadow-*`, `--duration-*`, `--ease-*`, and `--text-*` from `@theme`.
`web/tailwind.config.ts` mirrors the same tokens for editor/intellisense and v3-compat paths.

### Brand
| Token | Utilities | Notes |
|-------|-----------|--------|
| `--brand-gold` / dim / bright / glow | `bg-brand-gold`, `text-brand-gold`, … | Prefer tokens over raw hex. Existing `.gold-text` / `.gold-gradient` / `.gold-glow` utilities stay. |

### Trust / bid / status (semantic)
| Group | Keys | Utilities |
|-------|------|-----------|
| trust | low, medium, high, elite | `bg-trust-high`, `text-trust-low`, … |
| bid | active, winning, expired | `bg-bid-active`, `text-bid-winning`, … |
| status | open, in-progress, completed, disputed | `bg-status-open`, `text-status-disputed`, … |

HSL channel vars (`--trust-low: 0 84% 60%`) are wrapped as `hsl(var(--trust-*))` in `@theme`.

### Elevation & motion
- Shadows: `--elevation-1`…`5` → `shadow-elevation-1`…`5`
- Enter: `--duration-enter: 250ms` + `--ease-enter` → `duration-enter` / `ease-enter`
- Exit: `--duration-exit: 200ms` + `--ease-exit` → `duration-exit` / `ease-exit`
- Dark terminal palette background remains `#070b14` (`.dark`)

### Type scale (strict — xs…4xl only)
```typescript
// Mirrored in tailwind.config.ts + @theme --text-*
xs: ['0.75rem', { lineHeight: '1rem' }],
sm: ['0.875rem', { lineHeight: '1.25rem' }],
base: ['1rem', { lineHeight: '1.5rem' }],
lg: ['1.125rem', { lineHeight: '1.75rem' }],
xl: ['1.25rem', { lineHeight: '1.75rem' }],
'2xl': ['1.5rem', { lineHeight: '2rem' }],
'3xl': ['1.875rem', { lineHeight: '2.25rem' }],
'4xl': ['2.25rem', { lineHeight: '2.5rem' }],
```

### Brand mark
- SVG component: `web/src/components/layout/BrandMark.tsx` (dual rings + geometric N; `text-brand-gold` / currentColor only)
- Wordmark + mark: `web/src/components/layout/Logo.tsx`
- Favicon / Apple touch: `web/src/app/icon.tsx` (32px), `web/src/app/apple-icon.tsx` (180px) — code-generated ImageResponse (inline hex OK; not React component tree)

```typescript
// tailwind.config.ts — canonical shape (values resolve via CSS vars)
const config = {
  theme: {
    extend: {
      colors: {
        // Semantic tokens — NEVER use raw hex in components
        primary: { DEFAULT: '', foreground: '' },
        secondary: { DEFAULT: '', foreground: '' },
        destructive: { DEFAULT: '', foreground: '' },
        muted: { DEFAULT: '', foreground: '' },
        accent: { DEFAULT: '', foreground: '' },
        card: { DEFAULT: '', foreground: '' },
        border: '', input: '', ring: '', background: '', foreground: '',
        brand: { gold: '', 'gold-dim': '', 'gold-bright': '', 'gold-glow': '' },
        trust: { low: '', medium: '', high: '', elite: '' },
        bid: { active: '', winning: '', expired: '' },
        status: { open: '', 'in-progress': '', completed: '', disputed: '' },
      },
      borderRadius: { lg: '0.75rem', md: '0.5rem', sm: '0.25rem' },
      fontSize: { /* xs…4xl with lineHeight — see above */ },
      boxShadow: {
        'elevation-1': 'var(--elevation-1)',
        /* … elevation-2..5 */
      },
      transitionDuration: { enter: 'var(--duration-enter)', exit: 'var(--duration-exit)' },
    },
  },
}
```

## Component Rules
- Every component gets its own file. One component per file.
- Use shadcn/ui primitives as foundation. Customize via Tailwind — never override with CSS.
- All interactive components must accept `className` for composition.
- Loading states: Skeleton components, never spinners (except full-page initial load).
- Error states: every data-fetching component handles loading, error, and empty states.
- Responsive: mobile-first. All layouts must work at 320px minimum width.
