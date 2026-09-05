import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
  Element.prototype.scrollIntoView = function scrollIntoView() {
    /* noop */
  };
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false;
  };
  Element.prototype.releasePointerCapture = function releasePointerCapture() {
    /* noop */
  };
});

const mutateMock = vi.fn();
const mutationState = {
  mutate: mutateMock,
  isPending: false,
};

vi.mock('@/hooks/useListingReports', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useListingReports')>(
    '@/hooks/useListingReports',
  );
  return {
    ...actual,
    useReportListing: () => mutationState,
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ReportListingButton } from '@/components/marketplace/ReportListingButton';
const { toast } = await import('sonner');

describe('ReportListingButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationState.isPending = false;
    mutateMock.mockImplementation(
      (
        _vars: unknown,
        opts?: { onSuccess?: (res: { status: string }) => void; onError?: (e: Error) => void },
      ) => {
        opts?.onSuccess?.({ status: 'open' });
      },
    );
  });

  it('renders a Report trigger', () => {
    render(createElement(ReportListingButton, { listingId: 'l-1', listingTitle: 'Bike' }));
    expect(screen.getByRole('button', { name: /Report listing/i })).toBeDefined();
  });

  it('submits the selected reason via useReportListing', async () => {
    const user = userEvent.setup();
    render(createElement(ReportListingButton, { listingId: 'l-1', listingTitle: 'Bike' }));

    await user.click(screen.getByRole('button', { name: /Report listing/i }));
    expect(await screen.findByText(/Report "Bike"/)).toBeDefined();

    // Submit disabled until a reason is chosen.
    const submit = screen.getByRole('button', { name: /Submit report/i });
    expect(submit.hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('combobox', { name: /Reason for report/i }));
    await user.click(await screen.findByRole('option', { name: /Stolen goods/i }));

    await user.type(screen.getByLabelText(/Details/), 'Serial matches mine');
    await user.click(screen.getByRole('button', { name: /Submit report/i }));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith(
        {
          listingId: 'l-1',
          reason: 'stolen',
          description: 'Serial matches mine',
        },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });
    expect(toast.success).toHaveBeenCalled();
  });
});
