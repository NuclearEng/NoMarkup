import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Measure the WHOLE app, not just the files the tests happen to import.
      // Without `all: true` v8 counts only touched files, so the % reflects
      // "coverage of the tested files" — misleadingly high (it read ~93% while
      // real whole-app coverage is far lower). This makes the gate honest.
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'tests/',
        '.next/',
        '**/*.d.ts',
        '**/*.config.*',
        'src/types/**',
        'src/**/*.stories.*',
      ],
      // Honest whole-app floors. Measured 2026-06 with `all: true`: ~84% lines /
      // ~91% branches / ~88% functions / ~84% statements — the app is genuinely
      // well-covered (the prior "~7%" was a misread of the touched-files-only
      // gate). Floors sit a few points below measured at the CLAUDE.md 80% target;
      // RATCHET UP as coverage grows, never down.
      thresholds: {
        branches: 85,
        functions: 84,
        lines: 80,
        statements: 80,
      },
    },
  },
});
