/**
 * FE-11 contract: globals.css must kill continuous / entrance motion under
 * prefers-reduced-motion: reduce (Tailwind utilities + custom keyframes used
 * in production UI — pulse/spin loaders, marquee ticker, confetti, page-enter).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const globalsCss = readFileSync(
  resolve(__dirname, '../../../src/styles/globals.css'),
  'utf8',
);

/** Extract selector lists from every prefers-reduced-motion: reduce block. */
function reducedMotionSelectors(css: string): string {
  const blocks: string[] = [];
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push(css.slice(match.index, i));
  }
  return blocks.join('\n');
}

const reduceCss = reducedMotionSelectors(globalsCss);

describe('FE-11 prefers-reduced-motion (globals.css)', () => {
  it('defines at least one prefers-reduced-motion: reduce media query', () => {
    expect(reduceCss.length).toBeGreaterThan(0);
    expect(globalsCss).toMatch(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
  });

  it.each([
    // Tailwind continuous utilities (core FE-11 scope)
    '.animate-pulse',
    '.animate-spin',
    '.animate-ping',
    '.animate-bounce',
    // Named residual scope: marquee / confetti / page-enter
    '.ticker-track',
    '.animate-confetti-fall',
    '.animate-confetti-cascade',
    '.animate-page-enter',
    // Common entrances + auth error shake/slide
    '.animate-fade-in',
    '.animate-fade-in-up',
    '.animate-auth-card-enter',
    '.animate-auth-error',
  ])('kills %s under reduce', (selector) => {
    // Selector must appear in a reduce block (not only in a keyframes definition).
    expect(reduceCss).toContain(selector);
  });

  it('sets animation: none inside reduce blocks for continuous utilities', () => {
    expect(reduceCss).toMatch(/animation:\s*none\s*!important/);
  });
});
