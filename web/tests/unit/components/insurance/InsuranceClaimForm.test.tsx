import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
});

vi.mock('@/hooks/useInsurance', () => ({
  useFileInsuranceClaim: vi.fn(),
}));

const uploadMock = vi.fn();

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    upload: uploadMock,
    status: 'idle',
    progress: 0,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { InsuranceClaimForm } from '@/components/insurance/InsuranceClaimForm';

const { useFileInsuranceClaim } = await import('@/hooks/useInsurance');
const useFile = vi.mocked(useFileInsuranceClaim);
const { toast } = await import('sonner');

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
    uploadMock.mockImplementation(async (file: File) => ({
      ok: true as const,
      result: {
        objectKey: `claims/${file.name}`,
        confirmedUrl: `https://cdn.example.com/claims/${file.name}`,
      },
    }));
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

  it('uploads evidence via useImageUpload and shows file count', async () => {
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

    await waitFor(() => {
      expect(uploadMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(/2 files attached/)).toBeDefined();
    expect(uploadMock.mock.calls[0]?.[0]).toBe(f1);
    expect(uploadMock.mock.calls[1]?.[0]).toBe(f2);
  });

  it('handleFileUpload returns early when no files are selected', async () => {
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
    await waitFor(() => {
      expect(uploadMock).not.toHaveBeenCalled();
    });
    expect(screen.queryByText(/files attached/)).toBeNull();
  });

  it('shows singular "file attached" copy when one file is uploaded', async () => {
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
    expect(await screen.findByText(/1 file attached/)).toBeDefined();
  });

  it('toasts an error when an evidence upload fails', async () => {
    uploadMock.mockResolvedValueOnce({
      ok: false as const,
      error: 'Max 10 MB — this file is 12.0 MB.',
    });

    const { container } = render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
      }),
    );
    const fileInput = container.querySelector('#claim-evidence');
    const f = new File(['a'], 'big.png', { type: 'image/png' });
    Object.defineProperty(fileInput as HTMLInputElement, 'files', {
      configurable: true,
      value: [f],
    });
    fireEvent.change(fileInput as HTMLInputElement);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Max 10 MB — this file is 12.0 MB.');
    });
    expect(screen.queryByText(/files attached/)).toBeNull();
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

  it('submits successfully with confirmed evidence URLs', async () => {
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

    const { container } = render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 1_000_00,
        onSuccess,
      }),
    );

    // Upload evidence first so mutate payload includes confirmed S3 URLs.
    const fileInput = container.querySelector('#claim-evidence');
    const f = new File(['a'], 'proof.png', { type: 'image/png' });
    Object.defineProperty(fileInput as HTMLInputElement, 'files', {
      configurable: true,
      value: [f],
    });
    fireEvent.change(fileInput as HTMLInputElement);
    await screen.findByText(/1 file attached/);

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
    expect((vars as { claim_type: string }).claim_type).toBe('property_damage');
    expect((vars as { claimed_amount_cents: number }).claimed_amount_cents).toBe(5000);
    expect((vars as { evidence_urls: string[] }).evidence_urls).toEqual([
      'https://cdn.example.com/claims/proof.png',
    ]);
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
    const option = await screen.findByRole('option', { name: 'Property Damage' });
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

  it('does not call mutate when amount exceeds coverage even if validation passes', async () => {
    // Hits the onSubmit `if (amountCents > coverageAmountCents) return;` defensive
    // guard. The submit button is disabled in this state, so we trigger the form
    // submit directly via requestSubmit() to exercise the onSubmit handler.
    const user = userEvent.setup();
    const longDescription = 'f'.repeat(120);
    const mutate = vi.fn();
    useFile.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useFileInsuranceClaim>);

    const { container } = render(
      createElement(InsuranceClaimForm, {
        policyId: 'pol-1',
        coverageAmountCents: 100_00,
      }),
    );
    // Choose a claim type so the schema validates.
    await user.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: 'Property Damage' });
    await user.click(option);

    await user.type(screen.getByLabelText(/Description/), longDescription);
    await user.type(screen.getByLabelText(/Claimed Amount/), '500');

    // Submit via form.requestSubmit (button is disabled by exceedsCoverage).
    const form = container.querySelector('form');
    form?.requestSubmit();
    await waitFor(() => {
      expect(mutate).not.toHaveBeenCalled();
    });
  });
});
