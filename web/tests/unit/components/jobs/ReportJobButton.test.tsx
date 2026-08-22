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

vi.mock('@/hooks/useJobReports', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useJobReports')>(
    '@/hooks/useJobReports',
  );
  return {
    ...actual,
    useReportJob: () => mutationState,
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ReportJobButton } from '@/components/jobs/ReportJobButton';
const { toast } = await import('sonner');

describe('ReportJobButton', () => {
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
    render(createElement(ReportJobButton, { jobId: 'j-1', jobTitle: 'Lawn mowing' }));
    expect(screen.getByRole('button', { name: /Report job/i })).toBeDefined();
  });

  it('submits the selected reason via useReportJob', async () => {
    const user = userEvent.setup();
    render(createElement(ReportJobButton, { jobId: 'j-1', jobTitle: 'Lawn mowing' }));

    await user.click(screen.getByRole('button', { name: /Report job/i }));
    expect(await screen.findByText(/Report "Lawn mowing"/)).toBeDefined();

    const submit = screen.getByRole('button', { name: /Submit report/i });
    expect(submit.hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('combobox', { name: /Reason for report/i }));
    await user.click(await screen.findByRole('option', { name: /Prohibited content/i }));

    await user.type(screen.getByLabelText(/Details/), 'Asking for cannabis delivery');
    await user.click(screen.getByRole('button', { name: /Submit report/i }));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith(
        {
          jobId: 'j-1',
          reason: 'prohibited',
          description: 'Asking for cannabis delivery',
        },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });
    expect(toast.success).toHaveBeenCalled();
  });
});
