import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GuaranteeClaimForm } from '@/components/contracts/GuaranteeClaimForm';

const mockSubmit = vi.fn();

vi.mock('@/hooks/useGuarantee', () => ({
  useSubmitGuaranteeClaim: () => ({
    mutate: mockSubmit,
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    upload: vi.fn(),
    status: 'idle',
    progress: 0,
    error: null,
  }),
}));

describe('GuaranteeClaimForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form fields and submit button', () => {
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess: vi.fn(),
      }),
    );
    expect(screen.getByText('File Guarantee Claim')).toBeDefined();
    expect(screen.getByLabelText(/Description/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /submit claim/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /add photo/i })).toBeDefined();
  });

  it('shows validation errors when submitting an empty form', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess,
      }),
    );
    await user.click(screen.getByRole('button', { name: /submit claim/i }));

    // Either type, description, or evidence error must surface; mutate should not be called.
    expect(mockSubmit).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('shows description character counter', async () => {
    const user = userEvent.setup();
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess: vi.fn(),
      }),
    );
    const desc = screen.getByLabelText(/Description/i);
    await user.type(desc, 'hello');
    expect(screen.getByText(/5 \/ 50 min/)).toBeDefined();
  });
});
