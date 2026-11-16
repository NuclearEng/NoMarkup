// ReportListingButton — payload shaping, toasts and dialog lifecycle beyond
// the happy path in ReportListingButton.test.tsx.
// MOCKED: useReportListing (controllable mutate), sonner, and the Radix
// Select (→ native <select> with the same value / onValueChange contract).
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Fragment, createElement, type ChangeEvent, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ReportInput {
  listingId: string;
  reason: string;
  description?: string;
}

interface ReportOptions {
  onSuccess: (res: { status: string }) => void;
  onError: (err: unknown) => void;
}

const report = vi.hoisted(() => ({
  mutate: vi.fn<(input: ReportInput, options: ReportOptions) => void>(),
  isPending: false,
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock('@/hooks/useListingReports', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useListingReports')>(
    '@/hooks/useListingReports',
  );
  return {
    ...actual,
    useReportListing: () => ({ mutate: report.mutate, isPending: report.isPending }),
  };
});

vi.mock('sonner', () => ({
  toast: { success: report.toastSuccess, error: report.toastError },
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) =>
    createElement(
      'select',
      {
        'aria-label': 'Reason for report',
        value,
        onChange: (e: ChangeEvent<HTMLSelectElement>) => {
          onValueChange(e.target.value);
        },
      },
      createElement('option', { value: '' }, 'Select a reason'),
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement('option', { value }, children),
}));

import { ReportListingButton } from '@/components/marketplace/ReportListingButton';

function openDialog(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Report listing' }));
  return screen.getByRole('dialog');
}

function chooseReason(value: string) {
  fireEvent.change(screen.getByLabelText('Reason for report'), { target: { value } });
}

function describeIssue(value: string) {
  fireEvent.change(screen.getByLabelText('Details (optional)'), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
}

function lastOptions(): ReportOptions {
  const call = report.mutate.mock.calls.at(-1);
  if (!call) throw new Error('report was not submitted');
  return call[1];
}

beforeEach(() => {
  report.mutate.mockReset();
  report.isPending = false;
  report.toastSuccess.mockReset();
  report.toastError.mockReset();
});

describe('ReportListingButton — dialog', () => {
  it('names the listing in the title when one is given', () => {
    render(<ReportListingButton listingId="l-1" listingTitle="Oak table" />);
    const dialog = openDialog();
    expect(within(dialog).getByRole('heading', { name: 'Report "Oak table"' })).toBeInTheDocument();
  });

  it('uses a generic title otherwise', () => {
    render(<ReportListingButton listingId="l-1" />);
    const dialog = openDialog();
    expect(within(dialog).getByRole('heading', { name: 'Report this listing' })).toBeInTheDocument();
  });

  it('offers every report reason', () => {
    render(<ReportListingButton listingId="l-1" />);
    openDialog();
    const labels = within(screen.getByLabelText('Reason for report'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toEqual([
      'Select a reason',
      'Stolen goods',
      'Counterfeit or fake',
      'Prohibited item',
      'Misleading description',
      'Spam',
      'Something else',
    ]);
  });

  it('keeps Submit disabled until a reason is chosen', () => {
    render(<ReportListingButton listingId="l-1" />);
    openDialog();
    expect(screen.getByRole('button', { name: 'Submit report' })).toBeDisabled();
    describeIssue('Looks stolen');
    expect(screen.getByRole('button', { name: 'Submit report' })).toBeDisabled();
    chooseReason('stolen');
    expect(screen.getByRole('button', { name: 'Submit report' })).toBeEnabled();
  });

  it('Cancel closes the dialog without reporting', () => {
    render(<ReportListingButton listingId="l-1" />);
    openDialog();
    chooseReason('spam');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(report.mutate).not.toHaveBeenCalled();
  });

  it('applies a custom className to the trigger, or the 44px default', () => {
    const { unmount } = render(<ReportListingButton listingId="l-1" className="w-full" />);
    expect(screen.getByRole('button', { name: 'Report listing' })).toHaveClass('w-full');
    unmount();
    render(<ReportListingButton listingId="l-1" />);
    expect(screen.getByRole('button', { name: 'Report listing' })).toHaveClass('min-h-[44px]');
  });
});

describe('ReportListingButton — submitting', () => {
  it('sends the listing, reason and trimmed details', () => {
    render(<ReportListingButton listingId="l-42" />);
    openDialog();
    chooseReason('counterfeit');
    describeIssue('  Logo is wrong.  ');
    submit();
    expect(report.mutate).toHaveBeenCalledTimes(1);
    expect(report.mutate.mock.calls[0]?.[0]).toEqual({
      listingId: 'l-42',
      reason: 'counterfeit',
      description: 'Logo is wrong.',
    });
  });

  it('omits the description when details are blank or whitespace', () => {
    render(<ReportListingButton listingId="l-42" />);
    openDialog();
    chooseReason('spam');
    describeIssue('    ');
    submit();
    expect(report.mutate.mock.calls[0]?.[0]).toEqual({
      listingId: 'l-42',
      reason: 'spam',
      description: undefined,
    });
  });

  it('thanks the reporter, closes, and clears the form on success', () => {
    render(<ReportListingButton listingId="l-42" />);
    openDialog();
    chooseReason('prohibited');
    describeIssue('Not allowed');
    submit();
    act(() => {
      lastOptions().onSuccess({ status: 'submitted' });
    });
    expect(report.toastSuccess).toHaveBeenCalledWith(
      'Report submitted. Thanks for keeping the marketplace safe.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    openDialog();
    expect(screen.getByLabelText('Reason for report')).toHaveValue('');
    expect(screen.getByLabelText('Details (optional)')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Submit report' })).toBeDisabled();
  });

  it('tells a repeat reporter the listing is already under review', () => {
    render(<ReportListingButton listingId="l-42" />);
    openDialog();
    chooseReason('other');
    submit();
    act(() => {
      lastOptions().onSuccess({ status: 'already_reported' });
    });
    expect(report.toastSuccess).toHaveBeenCalledWith(
      "You've already reported this listing — our team is reviewing it.",
    );
  });

  it('shows the failure reason and keeps the dialog and form intact', () => {
    render(<ReportListingButton listingId="l-42" />);
    openDialog();
    chooseReason('misleading');
    describeIssue('Photos do not match');
    submit();
    act(() => {
      lastOptions().onError(new Error('Too many reports, slow down'));
    });
    expect(report.toastError).toHaveBeenCalledWith('Too many reports, slow down');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Reason for report')).toHaveValue('misleading');
    expect(screen.getByLabelText('Details (optional)')).toHaveValue('Photos do not match');
  });

  it('falls back to a specific message when the failure carries none', () => {
    render(<ReportListingButton listingId="l-42" />);
    openDialog();
    chooseReason('spam');
    submit();
    act(() => {
      lastOptions().onError(null);
    });
    expect(report.toastError).toHaveBeenCalledWith('Could not submit report');
  });

  it('shows "Submitting…" and blocks a second submit while the request is in flight', () => {
    report.isPending = true;
    render(<ReportListingButton listingId="l-42" />);
    openDialog();
    chooseReason('spam');
    const busy = screen.getByRole('button', { name: /Submitting…/ });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(report.mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Submit report' })).toBeNull();
  });
});
