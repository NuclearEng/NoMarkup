import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ImageAnalysisButton } from '@/components/forms/ImageAnalysisButton';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const { toast } = await import('sonner');

describe('ImageAnalysisButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an Analyze a Photo button', () => {
    render(createElement(ImageAnalysisButton, { onResult: vi.fn() }));
    expect(screen.getByRole('button', { name: /Analyze a photo/ })).toBeDefined();
  });

  it('shows a toast for unsupported file types', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onResult = vi.fn();
    render(createElement(ImageAnalysisButton, { onResult }));

    const button = screen.getByRole('button', { name: /Analyze a photo/ });
    const input = button.parentElement?.querySelector('input[type="file"]');
    expect(input).toBeTruthy();

    const badFile = new File(['x'], 'doc.txt', { type: 'text/plain' });
    await user.upload(input as HTMLInputElement, badFile);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Please select a JPEG, PNG, GIF, or WebP image.',
      );
    });
    expect(onResult).not.toHaveBeenCalled();
  });

  it('calls onResult with parsed analysis on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          category: 'plumbing',
          title: 'Fix sink',
          description: 'Leaky kitchen sink',
          budgetMinCents: 5000,
          budgetMaxCents: 20000,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    const onResult = vi.fn();
    render(createElement(ImageAnalysisButton, { onResult }));

    const input = screen
      .getByRole('button', { name: /Analyze a photo/ })
      .parentElement?.querySelector('input[type="file"]');
    expect(input).toBeTruthy();

    const goodFile = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
    await user.upload(input as HTMLInputElement, goodFile);

    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith({
        category: 'plumbing',
        title: 'Fix sink',
        description: 'Leaky kitchen sink',
        budgetMinCents: 5000,
        budgetMaxCents: 20000,
      });
    });
  });

  it('shows toast error when the API returns a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'rate limited' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(createElement(ImageAnalysisButton, { onResult: vi.fn() }));

    const input = screen
      .getByRole('button', { name: /Analyze a photo/ })
      .parentElement?.querySelector('input[type="file"]');
    const goodFile = new File(['x'], 'p.png', { type: 'image/png' });
    await user.upload(input as HTMLInputElement, goodFile);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('rate limited');
    });
  });
});
