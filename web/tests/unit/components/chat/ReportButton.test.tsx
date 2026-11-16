import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createContext, useContext, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ReportCallbacks {
  onSuccess: (res: { status: string }) => void;
  onError: (err: unknown) => void;
}

const reportState = { isPending: false };
const mutate = vi.fn<(vars: Record<string, unknown>, callbacks: ReportCallbacks) => void>();

vi.mock('@/hooks/useUserReports', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useUserReports')>('@/hooks/useUserReports');
  return {
    ...actual,
    useReportUser: () => ({
      mutate,
      get isPending(): boolean {
        return reportState.isPending;
      },
    }),
  };
});

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

import { ReportButton } from '@/components/chat/ReportButton';

function callbacks(): ReportCallbacks {
  const call = mutate.mock.calls[0];
  if (!call) throw new Error('report was not submitted');
  return call[1];
}

async function openDialog(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Report user' }));
  await screen.findByRole('dialog');
}

beforeEach(() => {
  vi.clearAllMocks();
  reportState.isPending = false;
});

describe('ReportButton', () => {
  it('applies a caller class to the trigger only when one is given', () => {
    const { rerender } = render(<ReportButton userId="u-2" />);
    expect(screen.getByRole('button', { name: 'Report user' })).toHaveClass('min-h-[44px]');
    expect(screen.getByRole('button', { name: 'Report user' })).not.toHaveClass('ml-auto');
    rerender(<ReportButton userId="u-2" className="ml-auto" />);
    expect(screen.getByRole('button', { name: 'Report user' })).toHaveClass('ml-auto');
  });

  it('titles the dialog with the display name, or a generic fallback', async () => {
    const { unmount } = render(<ReportButton userId="u-2" displayName="Dana" />);
    await openDialog();
    expect(screen.getByRole('heading', { name: 'Report Dana' })).toBeInTheDocument();
    unmount();

    render(<ReportButton userId="u-2" />);
    await openDialog();
    expect(screen.getByRole('heading', { name: 'Report this user' })).toBeInTheDocument();
  });

  it('offers every moderation reason and blocks submit until one is chosen', async () => {
    render(<ReportButton userId="u-2" />);
    await openDialog();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Harassment or bullying',
      'Spam',
      'Scam or fraud',
      'Inappropriate content',
      'Something else',
    ]);
    const submit = screen.getByRole('button', { name: 'Submit report' });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('option', { name: 'Spam' }));
    expect(screen.getByTestId('select')).toHaveAttribute('data-value', 'spam');
    expect(submit).toBeEnabled();
  });

  it('submits the reason with trimmed details and the chat context', async () => {
    render(<ReportButton userId="u-2" channelId="chan-1" messageId="msg-9" />);
    await openDialog();
    fireEvent.click(screen.getByRole('option', { name: 'Scam or fraud' }));
    fireEvent.change(screen.getByLabelText('Details (optional)'), {
      target: { value: '  asked for a wire transfer  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      userId: 'u-2',
      reason: 'scam',
      description: 'asked for a wire transfer',
      channelId: 'chan-1',
      messageId: 'msg-9',
    });
  });

  it('omits a whitespace-only description', async () => {
    render(<ReportButton userId="u-2" />);
    await openDialog();
    fireEvent.click(screen.getByRole('option', { name: 'Spam' }));
    fireEvent.change(screen.getByLabelText('Details (optional)'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      userId: 'u-2',
      reason: 'spam',
      description: undefined,
      channelId: undefined,
      messageId: undefined,
    });
  });

  it('thanks the reporter, closes, and resets the form after a new report', async () => {
    render(<ReportButton userId="u-2" />);
    await openDialog();
    fireEvent.click(screen.getByRole('option', { name: 'Spam' }));
    fireEvent.change(screen.getByLabelText('Details (optional)'), { target: { value: 'bots' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
    act(() => {
      callbacks().onSuccess({ status: 'submitted' });
    });
    expect(toast.success).toHaveBeenCalledWith(
      'Report submitted. Thanks for keeping the community safe.',
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    await openDialog();
    expect(screen.getByLabelText('Details (optional)')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Submit report' })).toBeDisabled();
  });

  it('tells the reporter when the same report already exists', async () => {
    render(<ReportButton userId="u-2" />);
    await openDialog();
    fireEvent.click(screen.getByRole('option', { name: 'Spam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
    act(() => {
      callbacks().onSuccess({ status: 'already_reported' });
    });
    expect(toast.success).toHaveBeenCalledWith(
      "You've already reported this — our team is reviewing it.",
    );
  });

  it('keeps the dialog open with the entered data and shows the reason on failure', async () => {
    render(<ReportButton userId="u-2" />);
    await openDialog();
    fireEvent.click(screen.getByRole('option', { name: 'Spam' }));
    fireEvent.change(screen.getByLabelText('Details (optional)'), { target: { value: 'bots' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
    act(() => {
      callbacks().onError(new Error('rate limited'));
    });
    expect(toast.error).toHaveBeenCalledWith('rate limited');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Details (optional)')).toHaveValue('bots');

    act(() => {
      callbacks().onError(undefined);
    });
    expect(toast.error).toHaveBeenLastCalledWith('Could not submit report');
  });

  it('shows a submitting state and cannot double-submit while pending', async () => {
    const { rerender } = render(<ReportButton userId="u-2" />);
    await openDialog();
    fireEvent.click(screen.getByRole('option', { name: 'Spam' }));
    reportState.isPending = true;
    rerender(<ReportButton userId="u-2" />);
    const submitting = screen.getByRole('button', { name: 'Submitting…' });
    expect(submitting).toBeDisabled();
    fireEvent.click(submitting);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('cancel closes the dialog without reporting', async () => {
    render(<ReportButton userId="u-2" />);
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mutate).not.toHaveBeenCalled();
  });
});
