import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = { pathname: '/jobs' };

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
}));

import { ActionCapture } from '@/components/providers/ActionCapture';
import { __resetClientActionsForTests, listClientActions } from '@/lib/client-action-log';

// The log is newest-first; these helpers return oldest-first for readability.
function uiPaths(method: 'TAP' | 'SUBMIT'): string[] {
  return listClientActions()
    .filter((e) => e.kind === 'ui' && e.method === method)
    .map((e) => e.path)
    .reverse();
}

function screenPaths(): string[] {
  return listClientActions()
    .filter((e) => e.kind === 'screen')
    .map((e) => e.path)
    .reverse();
}

beforeEach(() => {
  nav.pathname = '/jobs';
  __resetClientActionsForTests();
});

afterEach(() => {
  __resetClientActionsForTests();
});

describe('ActionCapture screen hops', () => {
  it('records "/" when the pathname is empty and a new hop when the route changes', () => {
    nav.pathname = '';
    const { rerender } = render(<ActionCapture />);
    expect(screenPaths()).toEqual(['/']);

    nav.pathname = '/marketplace';
    rerender(<ActionCapture />);
    expect(screenPaths()).toEqual(['/', '/marketplace']);

    rerender(<ActionCapture />);
    expect(screenPaths()).toEqual(['/', '/marketplace']);
  });
});

describe('ActionCapture tap labels', () => {
  it('prefers a trimmed data-workflow over every other attribute', () => {
    render(
      <>
        <ActionCapture />
        <button type="button" data-workflow="  checkout  " id="btn" aria-label="Pay">
          Pay now
        </button>
      </>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(uiPaths('TAP')).toEqual(['checkout']);
  });

  it('falls through a blank data-workflow to the element id', () => {
    render(
      <>
        <ActionCapture />
        <button type="button" data-workflow="   " id="save-btn" data-testid="ignored">
          Save
        </button>
      </>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(uiPaths('TAP')).toEqual(['save-btn']);
  });

  it('uses data-testid when there is no id', () => {
    render(
      <>
        <ActionCapture />
        <button type="button" data-testid="bid-submit" aria-label="Submit bid">
          Bid
        </button>
      </>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(uiPaths('TAP')).toEqual(['bid-submit']);
  });

  it('uses aria-label, then href, then name, then visible text', () => {
    render(
      <>
        <ActionCapture />
        <button type="button" aria-label=" Close dialog " name="close">
          x
        </button>
        <a href="#pricing" aria-label="  ">
          Pricing
        </a>
        <button type="button" name="confirm">
          OK
        </button>
        <button type="button" name=" ">
          {'  Send \n   message  '}
        </button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(screen.getByText('Pricing'));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(uiPaths('TAP')).toEqual(['Close dialog', '#pricing', 'confirm', 'Send message']);
  });

  it('falls back to the tag name for an unlabeled control', () => {
    const { container } = render(
      <>
        <ActionCapture />
        <button type="button" />
      </>,
    );
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    if (button) fireEvent.click(button);
    expect(uiPaths('TAP')).toEqual(['button']);
  });

  it('attributes a click on nested content to the closest actionable ancestor', () => {
    render(
      <>
        <ActionCapture />
        <div role="button" tabIndex={0} aria-label="Open card">
          <span>inner text</span>
        </div>
        <section data-workflow="hero-banner">
          <p>Banner copy</p>
        </section>
      </>,
    );
    fireEvent.click(screen.getByText('inner text'));
    fireEvent.click(screen.getByText('Banner copy'));
    expect(uiPaths('TAP')).toEqual(['Open card', 'hero-banner']);
  });
});

describe('ActionCapture ignored clicks', () => {
  it('ignores clicks on plain content and on the document itself', () => {
    render(
      <>
        <ActionCapture />
        <p>Just text</p>
      </>,
    );
    fireEvent.click(screen.getByText('Just text'));
    fireEvent.click(document);
    expect(uiPaths('TAP')).toEqual([]);
  });

  it('never records clicks into typing targets, even inside an actionable wrapper', () => {
    const { container } = render(
      <>
        <ActionCapture />
        <div data-workflow="search-form">
          <input aria-label="Query" />
          <textarea aria-label="Notes" />
          <select aria-label="Sort">
            <option>Newest</option>
          </select>
          <div data-testid="rich-editor">Editable</div>
        </div>
      </>,
    );
    const editor = screen.getByTestId('rich-editor');
    // jsdom does not implement isContentEditable.
    Object.defineProperty(editor, 'isContentEditable', { value: true });

    fireEvent.click(screen.getByLabelText('Query'));
    fireEvent.click(screen.getByLabelText('Notes'));
    fireEvent.click(screen.getByLabelText('Sort'));
    fireEvent.click(editor);
    expect(uiPaths('TAP')).toEqual([]);

    // Sanity: the same wrapper is recorded for a non-typing child.
    const wrapper = container.querySelector('[data-workflow="search-form"]');
    if (wrapper) fireEvent.click(wrapper);
    expect(uiPaths('TAP')).toEqual(['search-form']);
  });
});

describe('ActionCapture form submits', () => {
  it('names the submit by data-workflow, aria-label, name, then id', () => {
    const { container } = render(
      <>
        <ActionCapture />
        <form data-workflow="post-job" aria-label="Job form" name="job" id="f1" />
        <form aria-label="Login form" name="login" id="f2" />
        <form name="search" id="f3" />
        <form id="f4" />
        <form />
      </>,
    );
    for (const form of container.querySelectorAll('form')) {
      fireEvent.submit(form);
    }
    expect(uiPaths('SUBMIT')).toEqual(['post-job', 'Login form', 'search', 'f4', '']);
  });

  it('ignores submit events that do not originate from a form', () => {
    render(
      <>
        <ActionCapture />
        <div data-testid="not-a-form" />
      </>,
    );
    fireEvent(screen.getByTestId('not-a-form'), new Event('submit', { bubbles: true }));
    expect(uiPaths('SUBMIT')).toEqual([]);
  });
});

describe('ActionCapture teardown', () => {
  it('stops recording once unmounted', () => {
    const { unmount } = render(<ActionCapture />);
    const button = document.createElement('button');
    button.textContent = 'Late';
    document.body.appendChild(button);
    unmount();
    fireEvent.click(button);
    button.remove();
    expect(uiPaths('TAP')).toEqual([]);
  });
});
