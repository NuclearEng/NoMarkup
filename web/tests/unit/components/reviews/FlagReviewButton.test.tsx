import { act, fireEvent, render, screen } from '@testing-library/react';
import { createContext, useContext, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FlagCallbacks {
  onSuccess: () => void;
  onError: (err: unknown) => void;
}

const flagState = { isPending: false };
const mutate = vi.fn<(vars: { reviewId: string; reason: string }, callbacks: FlagCallbacks) => void>();

vi.mock('@/hooks/useReviews', () => ({
  useFlagReview: () => ({
    mutate,
    get isPending(): boolean {
      return flagState.isPending;
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Radix Select needs pointer capture + portals in jsdom; a listbox of clickable
// options keeps the value / onValueChange contract.
vi.mock('@/components/ui/select', () => {
  const Ctx = createContext<{ value: string; onValueChange: (v: string) => void }>({
    value: '',
    onValueChange: () => undefined,
  });
  function Select({
    children,
    value,
    onValueChange,
  }: {
    children?: ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) {
    return (
      <Ctx.Provider value={{ value: value ?? '', onValueChange: onValueChange ?? (() => undefined) }}>
        <div data-testid="select" data-value={value ?? ''}>
          {children}
        </div>
      </Ctx.Provider>
    );
  }
  function SelectItem({ children, value }: { children?: ReactNode; value: string }) {
    const ctx = useContext(Ctx);
    return (
      <div
        role="option"
        tabIndex={0}
        aria-selected={ctx.value === value}
        onClick={() => {
          ctx.onValueChange(value);
        }}
        onKeyDown={() => undefined}
      >
        {children}
      </div>
    );
  }
  return {
    Select,
    SelectItem,
    SelectContent: ({ children }: { children?: ReactNode }) => <div role="listbox">{children}</div>,
    SelectTrigger: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) => (
      <span data-testid="select-trigger">{ariaLabel}</span>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  };
});

import { toast } from 'sonner';

import { FlagReviewButton } from '@/components/reviews/FlagReviewButton';

function callbacks(): FlagCallbacks {
  const call = mutate.mock.calls[0];
  if (!call) throw new Error('flag was not submitted');
  return call[1];
}

function openPicker(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Flag review' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  flagState.isPending = false;
});

describe('FlagReviewButton', () => {
  it('starts as a compact Report link, honouring a caller class', () => {
    const { rerender } = render(<FlagReviewButton reviewId="r-1" />);
    expect(screen.getByRole('button', { name: 'Flag review' })).toHaveClass('min-h-[44px]');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    rerender(<FlagReviewButton reviewId="r-1" className="custom" />);
    expect(screen.getByRole('button', { name: 'Flag review' })).toHaveClass('custom');
    expect(screen.getByRole('button', { name: 'Flag review' })).not.toHaveClass('min-h-[44px]');
  });

  it('lists the flag reasons and requires one before flagging', () => {
    render(<FlagReviewButton reviewId="r-1" />);
    openPicker();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Inappropriate',
      'Fake',
      'Harassment',
      'Spam',
      'Irrelevant',
    ]);
    const flag = screen.getByRole('button', { name: 'Flag' });
    expect(flag).toBeDisabled();
    fireEvent.click(flag);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('flags the review with the chosen reason, then collapses and thanks the user', () => {
    render(<FlagReviewButton reviewId="r-1" />);
    openPicker();
    fireEvent.click(screen.getByRole('option', { name: 'Fake' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flag' }));
    expect(mutate.mock.calls[0]?.[0]).toEqual({ reviewId: 'r-1', reason: 'fake' });

    act(() => {
      callbacks().onSuccess();
    });
    expect(toast.success).toHaveBeenCalledWith('Review flagged for moderation. Thanks for reporting.');
    expect(screen.getByRole('button', { name: 'Flag review' })).toBeInTheDocument();

    openPicker();
    expect(screen.getByRole('button', { name: 'Flag' })).toBeDisabled();
  });

  it('stays open and shows the failure reason, with fallback copy', () => {
    render(<FlagReviewButton reviewId="r-1" />);
    openPicker();
    fireEvent.click(screen.getByRole('option', { name: 'Spam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flag' }));
    act(() => {
      callbacks().onError(new Error('already flagged'));
    });
    expect(toast.error).toHaveBeenCalledWith('already flagged');
    expect(screen.getByRole('button', { name: 'Flag' })).toBeEnabled();

    act(() => {
      callbacks().onError(null);
    });
    expect(toast.error).toHaveBeenLastCalledWith('Could not flag review');
  });

  it('cancel collapses and forgets the chosen reason', () => {
    render(<FlagReviewButton reviewId="r-1" />);
    openPicker();
    fireEvent.click(screen.getByRole('option', { name: 'Spam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Flag review' })).toBeInTheDocument();
    openPicker();
    expect(screen.getByTestId('select')).toHaveAttribute('data-value', '');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('locks Flag and Cancel while the request is pending', () => {
    const { rerender } = render(<FlagReviewButton reviewId="r-1" />);
    openPicker();
    fireEvent.click(screen.getByRole('option', { name: 'Spam' }));
    flagState.isPending = true;
    rerender(<FlagReviewButton reviewId="r-1" />);
    const flag = screen.getByRole('button', { name: 'Flag' });
    expect(flag).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(flag);
    expect(mutate).not.toHaveBeenCalled();
  });
});
