/**
 * Shared behavior suite for the three admin report queues (goods, job, user).
 *
 * The pages are structural copies: an open-by-default status filter, a
 * paginated table, and a dismiss / take-action confirm dialog with optional
 * notes. Each test file mocks its own pair of hooks and hands the mocks here;
 * page-specific cell rendering is asserted in the test file itself.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, createElement } from 'react';
import { type Mock, beforeEach, describe, expect, it } from 'vitest';

import { closest, getDialog, nth } from './_admin-branch-helpers';
import { withQueryClient } from './_helpers';

export interface ReportOverrides {
  id?: string;
  status?: string;
  reason?: string;
  description?: string;
}

export interface ReportPageSuiteOptions {
  /** Page heading, e.g. "Goods Reports". */
  title: string;
  Page: ComponentType;
  /** Mock behind the list hook (called with the query params). */
  listHook: Mock;
  /** Mock behind the resolve mutation's `mutateAsync`. */
  resolveMutateAsync: Mock;
  /** Mutable flag the mocked resolve hook reads `isPending` from. */
  resolveState: { isPending: boolean };
  /** Builds a report row of the page's own shape. */
  makeReport: (overrides?: ReportOverrides) => object;
  /** A reason the page has a friendly label for. */
  knownReason: { value: string; label: string };
  /** Copy unique to this page's "take action" dialog. */
  actionedDescription: RegExp;
  /** Copy unique to this page's "dismiss" dialog. */
  dismissDescription: RegExp;
}

interface Pagination {
  page: number;
  page_size: number;
  total: number;
}

export function describeReportPage(opts: ReportPageSuiteOptions): void {
  const { listHook, resolveMutateAsync, resolveState, makeReport } = opts;

  function loaded(reports: object[], pagination?: Pagination) {
    listHook.mockReturnValue({
      data: {
        reports,
        pagination: pagination ?? { page: 1, page_size: 20, total: reports.length },
      },
      isLoading: false,
      isError: false,
    });
  }

  function renderPage() {
    return render(withQueryClient(createElement(opts.Page)));
  }

  /** Row action buttons live in the table; the dialog has same-named buttons. */
  function rowButton(name: string, index = 0): HTMLElement {
    return nth(within(screen.getByRole('table')).getAllByRole('button', { name }), index);
  }

  describe(`${opts.title} — queue behavior`, () => {
    beforeEach(() => {
      listHook.mockReset();
      resolveMutateAsync.mockReset().mockResolvedValue(undefined);
      resolveState.isPending = false;
    });

    it('queries open reports, page 1 of 20, by default', () => {
      loaded([]);
      renderPage();

      expect(listHook).toHaveBeenLastCalledWith({ status: 'open', page: 1, page_size: 20 });
    });

    it('shows the error state instead of the table when the query fails', () => {
      listHook.mockReturnValue({ data: undefined, isLoading: false, isError: true });
      renderPage();

      expect(screen.getByRole('heading', { name: opts.title })).toBeInTheDocument();
      expect(screen.getByText('Failed to load reports')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('shows skeleton rows rather than the empty message while loading', () => {
      listHook.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      renderPage();

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.queryByText('No reports.')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Go to next page' })).not.toBeInTheDocument();
    });

    it('shows the empty message when the queue is clear', () => {
      loaded([]);
      renderPage();

      expect(screen.getByText('No reports.')).toBeInTheDocument();
    });

    it('labels known reasons, passes unknown ones through, and marks missing details', () => {
      loaded([
        makeReport({
          id: 'r-1',
          reason: opts.knownReason.value,
          description: 'Seen on another site',
        }),
        makeReport({ id: 'r-2', reason: 'brand_new_reason', description: '' }),
      ]);
      renderPage();

      const first = closest(screen.getByText('Seen on another site'), 'tr');
      expect(within(first).getByText(opts.knownReason.label)).toBeInTheDocument();
      expect(within(first).queryByText('no details')).not.toBeInTheDocument();

      const second = closest(screen.getByText('brand_new_reason'), 'tr');
      expect(within(second).getByText('no details')).toBeInTheDocument();
      expect(within(second).getByText('Jun 2, 2026')).toBeInTheDocument();
    });

    it('only lets open reports be dismissed or actioned', () => {
      loaded([
        makeReport({ id: 'r-1', status: 'open' }),
        makeReport({ id: 'r-2', status: 'dismissed' }),
      ]);
      renderPage();

      expect(rowButton('Dismiss', 0)).toBeEnabled();
      expect(rowButton('Take Action', 0)).toBeEnabled();
      expect(rowButton('Dismiss', 1)).toBeDisabled();
      expect(rowButton('Take Action', 1)).toBeDisabled();
    });

    it('dismisses a report with the typed notes and closes the dialog', async () => {
      const user = userEvent.setup();
      loaded([makeReport({ id: 'r-42' })]);
      const { container } = renderPage();
      const dialog = getDialog(container);
      expect(dialog).not.toHaveAttribute('open');

      await user.click(rowButton('Dismiss'));

      expect(dialog).toHaveAttribute('open');
      expect(within(dialog).getByRole('heading', { name: 'Dismiss Report' })).toBeInTheDocument();
      expect(within(dialog).getByText(opts.dismissDescription)).toBeInTheDocument();
      expect(resolveMutateAsync).not.toHaveBeenCalled();

      await user.type(within(dialog).getByLabelText('Notes (optional)'), 'duplicate report');
      await user.click(within(dialog).getByRole('button', { name: 'Dismiss' }));

      expect(resolveMutateAsync).toHaveBeenCalledExactlyOnceWith({
        reportId: 'r-42',
        action: 'dismiss',
        notes: 'duplicate report',
      });
      await waitFor(() => {
        expect(dialog).not.toHaveAttribute('open');
      });
      expect(within(dialog).getByLabelText('Notes (optional)')).toHaveValue('');
    });

    it('marks a report actioned, with notes optional', async () => {
      const user = userEvent.setup();
      loaded([makeReport({ id: 'r-7' })]);
      const { container } = renderPage();
      const dialog = getDialog(container);

      await user.click(rowButton('Take Action'));

      expect(
        within(dialog).getByRole('heading', { name: 'Take Action on Report' }),
      ).toBeInTheDocument();
      expect(within(dialog).getByText(opts.actionedDescription)).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Take Action' }));

      expect(resolveMutateAsync).toHaveBeenCalledExactlyOnceWith({
        reportId: 'r-7',
        action: 'actioned',
        notes: '',
      });
      await waitFor(() => {
        expect(dialog).not.toHaveAttribute('open');
      });
    });

    it('cancelling discards the notes and resolves nothing', async () => {
      const user = userEvent.setup();
      loaded([makeReport()]);
      const { container } = renderPage();
      const dialog = getDialog(container);

      await user.click(rowButton('Take Action'));
      await user.type(within(dialog).getByLabelText('Notes (optional)'), 'draft note');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel action' }));

      expect(dialog).not.toHaveAttribute('open');
      expect(resolveMutateAsync).not.toHaveBeenCalled();

      // The next dialog starts clean and reflects the newly chosen action.
      await user.click(rowButton('Dismiss'));
      expect(within(dialog).getByLabelText('Notes (optional)')).toHaveValue('');
      expect(within(dialog).getByRole('heading', { name: 'Dismiss Report' })).toBeInTheDocument();
    });

    it('locks the dialog while the resolution is in flight', async () => {
      const user = userEvent.setup();
      resolveState.isPending = true;
      loaded([makeReport()]);
      const { container } = renderPage();
      const dialog = getDialog(container);

      await user.click(rowButton('Dismiss'));

      const confirm = within(dialog).getByRole('button', { name: 'Dismiss' });
      expect(confirm).toBeDisabled();
      expect(confirm).toHaveTextContent('Processing...');
      expect(within(dialog).getByRole('button', { name: 'Cancel action' })).toBeDisabled();
    });

    it('filters by status and shows every status with "All Statuses"', () => {
      loaded([]);
      renderPage();
      const select = screen.getByRole('combobox');
      expect(select).toHaveValue('open');
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['All Statuses', 'Open', 'Reviewed', 'Actioned', 'Dismissed']);

      fireEvent.change(select, { target: { value: 'dismissed' } });
      expect(listHook).toHaveBeenLastCalledWith({ status: 'dismissed', page: 1, page_size: 20 });

      fireEvent.change(select, { target: { value: '__all__' } });
      expect(listHook).toHaveBeenLastCalledWith({ status: undefined, page: 1, page_size: 20 });
      expect(select).toHaveValue('__all__');
    });

    it('derives the page count, pages forward, and resets to page 1 on filter change', async () => {
      const user = userEvent.setup();
      loaded([makeReport()], { page: 1, page_size: 20, total: 45 });
      renderPage();

      expect(screen.getByText(/Showing page 1 of 3/)).toHaveTextContent('45 total');
      await user.click(screen.getByRole('button', { name: 'Go to next page' }));
      expect(listHook).toHaveBeenLastCalledWith({ status: 'open', page: 2, page_size: 20 });

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'reviewed' } });
      expect(listHook).toHaveBeenLastCalledWith({ status: 'reviewed', page: 1, page_size: 20 });
    });

    it('disables Next on the last page', () => {
      loaded([makeReport()], { page: 2, page_size: 20, total: 40 });
      renderPage();

      expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled();
    });

    it('survives a zero page_size from the API without dividing by zero', () => {
      loaded([makeReport()], { page: 1, page_size: 0, total: 5 });
      renderPage();

      expect(screen.getByText(/Showing page 1 of 5/)).toBeInTheDocument();
    });
  });
}
