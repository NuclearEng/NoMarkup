// Records unhandled promise rejections for the *-failure page tests, which
// check that a rejected mutation is handled by the page that awaited it.
import { afterEach, beforeEach } from 'vitest';

const unhandled: unknown[] = [];

function onUnhandled(reason: unknown): void {
  unhandled.push(reason);
}

/** Call once at the top of a test file. */
export function trackUnhandledRejections(): void {
  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
  });
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
  });
}

/** Lets Node run its unhandled-rejection check, then returns what it saw. */
export async function unhandledRejections(): Promise<unknown[]> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  return [...unhandled];
}
