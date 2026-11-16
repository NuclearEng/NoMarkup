import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingNPS } from '@/hooks/useNPS';

const pendingState: { data: { pending: PendingNPS[] } | undefined } = { data: undefined };
const submitState = { isPending: false };
const mutateAsync = vi.fn<(vars: { id: string; score: number; comment: string }) => Promise<unknown>>();

vi.mock('@/hooks/useNPS', () => ({
  usePendingNPS: () => pendingState,
  useSubmitNPS: () => ({
    mutateAsync,
    get isPending(): boolean {
      return submitState.isPending;
    },
  }),
}));

import { NPSSurvey } from '@/components/post-transaction/NPSSurvey';

function survey(id: string): PendingNPS {
  return { id, context_type: 'contract', context_id: `ctx-${id}`, prompted_at: '2026-01-01T00:00:00Z' };
}

function score(n: number): HTMLElement {
  return screen.getByRole('radio', { name: String(n) });
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingState.data = { pending: [survey('s1')] };
  submitState.isPending = false;
  mutateAsync.mockResolvedValue({});
});

describe('NPSSurvey', () => {
  it('renders nothing while the pending list is loading or empty', () => {
    pendingState.data = undefined;
    const { container, rerender } = render(<NPSSurvey />);
    expect(container).toBeEmptyDOMElement();
    pendingState.data = { pending: [] };
    rerender(<NPSSurvey />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a modal with scores 0–10 and Submit disabled until a score is picked', () => {
    render(<NPSSurvey />);
    expect(screen.getByRole('dialog', { name: 'How was your experience?' })).toHaveAttribute(
      'aria-modal',
      'true',
    );
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    ]);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('does nothing if the form is submitted without a score', () => {
    render(<NPSSurvey />);
    const form = screen.getByRole('dialog').querySelector('form');
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('moves the single selection between scores', () => {
    render(<NPSSurvey />);
    fireEvent.click(score(7));
    expect(score(7)).toBeChecked();
    fireEvent.click(score(10));
    expect(score(10)).toBeChecked();
    expect(score(7)).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  it('submits the score and comment for the first pending survey, then resets the form', async () => {
    pendingState.data = { pending: [survey('s1'), survey('s2')] };
    render(<NPSSurvey />);
    fireEvent.click(score(9));
    fireEvent.change(screen.getByLabelText(/Anything you'd like us to know/), {
      target: { value: 'Smooth pickup' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Anything you'd like us to know/)).toHaveValue('');
    });
    expect(mutateAsync).toHaveBeenCalledWith({ id: 's1', score: 9, comment: 'Smooth pickup' });
    expect(score(9)).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('submits a zero score (0 is a valid answer, not "no answer")', async () => {
    render(<NPSSurvey />);
    fireEvent.click(score(0));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ id: 's1', score: 0, comment: '' });
    });
  });

  it('"Maybe later" skips to the next survey with a clean form, then hides the modal', async () => {
    pendingState.data = { pending: [survey('s1'), survey('s2')] };
    const { container } = render(<NPSSurvey />);
    fireEvent.click(score(3));
    fireEvent.change(screen.getByLabelText(/Anything you'd like us to know/), { target: { value: 'meh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));

    expect(score(3)).not.toBeChecked();
    expect(screen.getByLabelText(/Anything you'd like us to know/)).toHaveValue('');
    fireEvent.click(score(8));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ id: 's2', score: 8, comment: '' });
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a submitting state and blocks resubmission while pending', () => {
    const { rerender } = render(<NPSSurvey />);
    fireEvent.click(score(5));
    submitState.isPending = true;
    rerender(<NPSSurvey />);
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
  });
});
