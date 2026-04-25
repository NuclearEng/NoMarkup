import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { InsuranceClaimForm } from '@/components/insurance/InsuranceClaimForm';

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
});
