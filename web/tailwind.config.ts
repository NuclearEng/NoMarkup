import type { Config } from 'tailwindcss';

/**
 * Tailwind config (v3-compat + design-system alignment).
 * Tailwind v4 primarily resolves tokens from `src/styles/globals.css` `@theme inline`.
 * This file keeps editor/intellisense + legacy plugin paths in sync with docs/design-system.md.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        // Brand gold
        brand: {
          gold: 'var(--brand-gold)',
          'gold-dim': 'var(--brand-gold-dim)',
          'gold-bright': 'var(--brand-gold-bright)',
          'gold-glow': 'var(--brand-gold-glow)',
        },
        // NoMarkup-specific semantic tokens (HSL channel vars → hsl())
        trust: {
          low: 'hsl(var(--trust-low))',
          medium: 'hsl(var(--trust-medium))',
          high: 'hsl(var(--trust-high))',
          elite: 'hsl(var(--trust-elite))',
        },
        bid: {
          active: 'hsl(var(--bid-active))',
          winning: 'hsl(var(--bid-winning))',
          expired: 'hsl(var(--bid-expired))',
        },
        status: {
          open: 'hsl(var(--status-open))',
          'in-progress': 'hsl(var(--status-in-progress))',
          completed: 'hsl(var(--status-completed))',
          disputed: 'hsl(var(--status-disputed))',
        },
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
        sm: '0.25rem',
      },
      // Strict type scale — only these sizes (docs/design-system.md)
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
      boxShadow: {
        'elevation-1': 'var(--elevation-1)',
        'elevation-2': 'var(--elevation-2)',
        'elevation-3': 'var(--elevation-3)',
        'elevation-4': 'var(--elevation-4)',
        'elevation-5': 'var(--elevation-5)',
      },
      transitionDuration: {
        enter: 'var(--duration-enter)',
        exit: 'var(--duration-exit)',
      },
      transitionTimingFunction: {
        enter: 'var(--ease-enter)',
        exit: 'var(--ease-exit)',
        standard: 'var(--ease-standard)',
      },
    },
  },
  plugins: [],
};

export default config;
