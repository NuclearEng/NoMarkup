import '@testing-library/jest-dom/vitest';

import { createElement, useEffect, useState, type ComponentType } from 'react';
import { beforeEach, vi } from 'vitest';

// ── next/dynamic → "chunk already loaded" ───────────────────────────────────
// Code-split boundaries (`next/dynamic`) are a bundling detail: in a browser
// the component appears once its chunk arrives. Unit tests assert on what a
// page renders, so by default they run in the state where every chunk has
// already arrived: each loader is started when the `dynamic()` call is
// evaluated (module import time) and every test waits for the loaders started
// so far before it runs. A dynamic component then renders synchronously, like
// a static import, and tests do not need to know where the split points are.
//
// A component whose loader has not settled yet (e.g. the module under test is
// imported inside the test body) renders its `loading` fallback and swaps to
// the real component when the loader resolves, like the real thing.
//
// Tests that are about the loading state itself mock `next/dynamic` in their
// own file — a file-level `vi.mock` replaces this one.
const dynamicImports = vi.hoisted(() => ({ pending: new Set<Promise<void>>() }));

vi.mock('next/dynamic', () => {
  type AnyProps = Record<string, unknown>;
  type Loaded = ComponentType<AnyProps> | { default: ComponentType<AnyProps> };
  interface DynamicOptions {
    loading?: ComponentType<AnyProps>;
  }

  function dynamic(loader: () => Promise<Loaded>, options?: DynamicOptions) {
    let Resolved: ComponentType<AnyProps> | null = null;
    const settled: Promise<void> = Promise.resolve()
      .then(loader)
      .then((mod) => {
        Resolved = typeof mod === 'object' && 'default' in mod ? mod.default : mod;
      })
      // A module that cannot load in jsdom leaves the fallback in place.
      .catch(() => undefined)
      .finally(() => {
        dynamicImports.pending.delete(settled);
      });
    dynamicImports.pending.add(settled);

    function PreloadedDynamic(props: AnyProps) {
      const [, rerender] = useState(0);
      useEffect(() => {
        if (Resolved) return;
        let active = true;
        void settled.then(() => {
          if (active) rerender((n) => n + 1);
        });
        return () => {
          active = false;
        };
      }, []);

      if (Resolved) return createElement(Resolved, props);
      return options?.loading ? createElement(options.loading, {}) : null;
    }
    return PreloadedDynamic;
  }

  return { __esModule: true, default: dynamic };
});

beforeEach(async () => {
  await Promise.all(dynamicImports.pending);
});
