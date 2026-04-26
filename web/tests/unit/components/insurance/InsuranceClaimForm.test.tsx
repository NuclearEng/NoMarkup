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
  if (!('hasPointerCapture' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    });
  }
  if (!('scrollIntoView' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => {},
    });
  }
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

  it('shows the claimed amount validation error when blank/invalid on submit', async () => {
    const user = userEvent.setup();
    const longDescription = 'a'.repeat(120);
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

    await user.type(screen.getByLabelText(/Description/), longDescription);
    // Leave Claimed Amount blank — RHF default value is ''. Submit should show the
    // refine() error on claimed_amount_dollars.
    await user.click(screen.getByRole('button', { name: /Submit Claim/ }));

    expect(await screen.findByText(/Enter a valid amount/)).toBeDefined();
    expect(mutate).not.toHaveBeenCalled();

    // The Input should now point to the claimed-amount-error region via aria-describedby
    const amountInput = screen.getByLabelText(/Claimed Amount/);
    expect(amountInput.getAttribute('aria-describedby')).toBe('claimed-amount-error');
  });

  it('does not call mutate when amount exceeds coverage on submit (early return)', async () => {
    const user = userEvent.setup();
    const longDescription = 'b'.repeat(120);
    const mutate = vi.fn();
    useFile.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useFileInsuranceClaim>);

    render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 100_00,
      }),
    );

    await user.type(screen.getByLabelText(/Description/), longDescription);
    await user.type(screen.getByLabelText(/Claimed Amount/), '500');
    await user.click(screen.getByRole('button', { name: /Submit Claim/ }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('submits successfully and invokes onSuccess when no errors', async () => {
    const user = userEvent.setup();
    const longDescription = 'c'.repeat(120);
    const onSuccess = vi.fn();
    const mutate = vi.fn(
      (
        _vars: unknown,
        opts: { onSuccess: () => void },
      ) => {
        opts.onSuccess();
      },
    );
    useFile.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useFileInsuranceClaim>);

    render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
        onSuccess,
      }),
    );

    // Choose claim type
    await user.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: 'Property Damage' });
    await user.click(option);

    await user.type(screen.getByLabelText(/Description/), longDescription);
    await user.type(screen.getByLabelText(/Claimed Amount/), '50');

    await user.click(screen.getByRole('button', { name: /Submit Claim/ }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    const [vars] = mutate.mock.calls[0] ?? [];
    expect((vars as { policy_id: string }).policy_id).toBe('pol-1');
    expect((vars as { claim_type: string }).claim_type).toBe('damage');
    expect((vars as { claimed_amount_cents: number }).claimed_amount_cents).toBe(5000);
  });

  it('does not call onSuccess if it is undefined when mutation succeeds', async () => {
    const user = userEvent.setup();
    const longDescription = 'd'.repeat(120);
    const mutate = vi.fn(
      (
        _vars: unknown,
        opts: { onSuccess: () => void },
      ) => {
        opts.onSuccess();
      },
    );
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

    await user.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: 'Other' });
    await user.click(option);

    await user.type(screen.getByLabelText(/Description/), longDescription);
    await user.type(screen.getByLabelText(/Claimed Amount/), '25');

    // No onSuccess prop passed — should not throw when undefined
    await user.click(screen.getByRole('button', { name: /Submit Claim/ }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('shows validation error when claim type is missing on submit', async () => {
    const user = userEvent.setup();
    const longDescription = 'e'.repeat(120);
    render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
      }),
    );
    await user.type(screen.getByLabelText(/Description/), longDescription);
    await user.type(screen.getByLabelText(/Claimed Amount/), '25');
    await user.click(screen.getByRole('button', { name: /Submit Claim/ }));
    expect(await screen.findByText(/Select a claim type/)).toBeDefined();
  });
});
