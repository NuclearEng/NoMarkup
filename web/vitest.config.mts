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
      // Vitest 4 removed `all: true`; the v4 equivalent is an explicit
      // `coverage.include` — every file matching these globs is included in the
      // report even if no test imports it (untested files count at 0%). Without
      // an explicit include, v8 counts only touched files, so the % reflects
      // "coverage of the tested files" — misleadingly high. Keeps the gate honest.
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
      // Honest whole-app floors. RULER CHANGE 2026-06 (vitest 2 -> 4): vitest 4's
      // mandatory AST-aware remapping instruments untested files' branches and
      // functions for real. Under vitest 2 a never-imported file had EMPTY
      // branch/function maps and counted as a vacuous 100%, inflating those
      // columns. Verified on identical code + tests (421 files, 4109 tests):
      //   vitest 2: 83.68 stmts / 90.93 branch / 88.14 funcs / 83.68 lines
      //   vitest 4: 79.40 stmts / 75.73 branch / 79.62 funcs / 80.70 lines
      // Coverage did NOT regress — the measurement got more honest. Floors are
      // recalibrated to the v4 ruler with the same ~4-6pt margin below measured
      // as before; RATCHET UP as coverage grows, never down.
      thresholds: {
        branches: 71,
        functions: 75,
        lines: 77,
        statements: 76,
      },
    },
  },
});
