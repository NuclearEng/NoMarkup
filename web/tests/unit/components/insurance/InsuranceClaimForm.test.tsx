import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { InsuranceClaimForm } from '@/components/insurance/InsuranceClaimForm';

beforeAll(() => {
  // Radix Select uses ResizeObserver/PointerEvent — stub in jsdom.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
  // Stub URL.createObjectURL for evidence file upload tests.
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn((_blob: Blob) => 'blob:evidence-mock'),
  });
});

vi.mock('@/hooks/useInsurance', () => ({
  useFileInsuranceClaim: vi.fn(),
}));

const { useFileInsuranceClaim } = await import('@/hooks/useInsurance');
const useFile = vi.mocked(useFileInsuranceClaim);

function defaultFile() {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useFileInsuranceClaim>;
}

describe('InsuranceClaimForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFile.mockReturnValue(defaultFile());
  });

  it('renders the claim form with the coverage limit', () => {
    render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
      }),
    );

    expect(screen.getByText('File a Claim')).toBeDefined();
    expect(screen.getByText(/max: \$1,000.00/)).toBeDefined();
    expect(screen.getByLabelText(/Description/)).toBeDefined();
  });

  it('shows validation errors for short descriptions', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();
    useFile.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useFileInsuranceClaim>);

    render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
      }),
    );

    await user.type(screen.getByLabelText(/Description/), 'too short');
    await user.type(screen.getByLabelText(/Claimed Amount/), '50');
    await user.click(screen.getByRole('button', { name: /Submit Claim/ }));

    expect(
      await screen.findByText(/Description must be at least 100 characters/),
    ).toBeDefined();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('warns when claim amount exceeds coverage', async () => {
    const user = userEvent.setup();
    render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 100_00,
      }),
    );

    await user.type(screen.getByLabelText(/Claimed Amount/), '5000');

    await waitFor(() => {
      expect(screen.getByText(/Amount exceeds coverage limit/)).toBeDefined();
    });
  });

  it('disables submit while mutation is pending', () => {
    useFile.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useFileInsuranceClaim>);

    render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
      }),
    );

    const submit = screen.getByRole('button', { name: /Submit Claim/ });
    expect(submit.hasAttribute('disabled')).toBe(true);
  });

  it('renders the error fallback when filing fails', () => {
    useFile.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
    } as unknown as ReturnType<typeof useFileInsuranceClaim>);

    render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
      }),
    );

    expect(screen.getByText(/Failed to file claim/)).toBeDefined();
  });

  it('forwards className to the Card root', () => {
    const { container } = render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
        className: 'shell-extra',
      }),
    );
    expect(container.querySelector('.shell-extra')).not.toBeNull();
  });

  it('disables submit when claim amount exceeds coverage', async () => {
    const user = userEvent.setup();
    render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 100_00,
      }),
    );
    await user.type(screen.getByLabelText(/Claimed Amount/), '5000');
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: /Submit Claim/ });
    expect(submit.disabled).toBe(true);
  });

  it('displays evidence file count after upload', () => {
    const { container } = render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
      }),
    );

    const fileInput = container.querySelector('#claim-evidence');
    expect(fileInput).not.toBeNull();

    const f1 = new File(['a'], 'a.png', { type: 'image/png' });
    const f2 = new File(['b'], 'b.png', { type: 'image/png' });
    Object.defineProperty(fileInput as HTMLInputElement, 'files', {
      configurable: true,
      value: [f1, f2],
    });
    fireEvent.change(fileInput as HTMLInputElement);

    expect(screen.getByText(/2 files attached/)).toBeDefined();
  });

  it('handleFileUpload returns early when no files are selected', () => {
    const { container } = render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
      }),
    );
    const fileInput = container.querySelector('#claim-evidence');
    Object.defineProperty(fileInput as HTMLInputElement, 'files', {
      configurable: true,
      value: [],
    });
    fireEvent.change(fileInput as HTMLInputElement);
    expect(screen.queryByText(/files attached/)).toBeNull();
  });

  it('shows singular "file attached" copy when one file is uploaded', () => {
    const { container } = render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
      }),
    );
    const fileInput = container.querySelector('#claim-evidence');
    const f = new File(['a'], 'a.png', { type: 'image/png' });
    Object.defineProperty(fileInput as HTMLInputElement, 'files', {
      configurable: true,
      value: [f],
    });
    fireEvent.change(fileInput as HTMLInputElement);
    expect(screen.getByText(/1 file attached/)).toBeDefined();
  });

  it('renders the loading spinner when filing is pending', () => {
    useFile.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useFileInsuranceClaim>);

    const { container } = render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
      }),
    );

    // Loader2 has the animate-spin class
    expect(container.querySelectorAll('.animate-spin').length).toBeGreaterThan(0);
  });
});
