// ActionCapture — <input type="submit"> and <input type="button"> are taps.
// Every INPUT used to be treated as a typing target, so these two never
// reached the selector that lists them and were never logged.
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionCapture } from '@/components/providers/ActionCapture';
import { __resetClientActionsForTests, listClientActions } from '@/lib/client-action-log';

vi.mock('next/navigation', () => ({
  usePathname: () => '/login',
}));

function taps(): string[] {
  return listClientActions()
    .filter((e) => e.kind === 'ui' && e.method === 'TAP')
    .map((e) => e.path)
    .reverse();
}

afterEach(() => {
  __resetClientActionsForTests();
});

describe('ActionCapture input buttons', () => {
  it('logs a tap on a submit input, labelled by its value', () => {
    render(
      <>
        <ActionCapture />
        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <input type="submit" value="Place bid" />
        </form>
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Place bid' }));

    expect(taps()).toEqual(['Place bid']);
  });

  it('logs a tap on a button input, preferring its id over its value', () => {
    render(
      <>
        <ActionCapture />
        <input type="button" id="retry-upload" value="Retry" />
        <input type="button" value="Dismiss" />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(taps()).toEqual(['retry-upload', 'Dismiss']);
  });

  it('still ignores clicks into fields that take typed or chosen values', () => {
    render(
      <>
        <ActionCapture />
        <button type="button">
          <input type="text" aria-label="Search" defaultValue="secret query" />
        </button>
        <input type="password" aria-label="Password" defaultValue="hunter2" />
        <input type="checkbox" aria-label="Remember me" />
        <textarea aria-label="Notes" defaultValue="private" />
        <select aria-label="Country">
          <option>US</option>
        </select>
      </>,
    );

    for (const name of ['Search', 'Password', 'Remember me', 'Notes', 'Country']) {
      fireEvent.click(screen.getByLabelText(name));
    }

    expect(taps()).toEqual([]);
    expect(JSON.stringify(listClientActions())).not.toMatch(/secret query|hunter2|private/);
  });
});
