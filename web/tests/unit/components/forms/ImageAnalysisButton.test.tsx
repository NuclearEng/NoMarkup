import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ImageAnalysisButton } from '@/components/forms/ImageAnalysisButton';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const SOFT_NOTICE =
  "Couldn't auto-analyze the photo — you can still fill in the details manually.";

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

  it('shows a soft non-blocking notice on a 503 / aiUnavailable response', async () => {
    // AI auto-fill is optional. A 503 (or aiUnavailable flag) must degrade to a
    // soft info notice — never a hard error — and never block job posting.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () =>
        Promise.resolve({
          aiUnavailable: true,
          error: 'AI photo analysis is not configured.',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    const onResult = vi.fn();
    render(createElement(ImageAnalysisButton, { onResult }));

    const input = screen
      .getByRole('button', { name: /Analyze a photo/ })
      .parentElement?.querySelector('input[type="file"]');
    const goodFile = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
    await user.upload(input as HTMLInputElement, goodFile);

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(SOFT_NOTICE);
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('falls back to a generic error when error JSON has no string error field', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      // No "error" key — message extraction should fall through to the default.
      json: () => Promise.resolve({ message: 'something else' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(createElement(ImageAnalysisButton, { onResult: vi.fn() }));

    const input = screen
      .getByRole('button', { name: /Analyze a photo/ })
      .parentElement?.querySelector('input[type="file"]');
    const goodFile = new File(['x'], 'p.gif', { type: 'image/gif' });
    await user.upload(input as HTMLInputElement, goodFile);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to analyze image');
    });
  });

  it('falls back to a generic error when error JSON parsing rejects', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      // Body parsing fails — errorBody becomes null, so the message extraction
      // falls through to the generic default.
      json: () => Promise.reject(new Error('bad body')),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(createElement(ImageAnalysisButton, { onResult: vi.fn() }));

    const input = screen
      .getByRole('button', { name: /Analyze a photo/ })
      .parentElement?.querySelector('input[type="file"]');
    const goodFile = new File(['x'], 'p.webp', { type: 'image/webp' });
    await user.upload(input as HTMLInputElement, goodFile);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to analyze image');
    });
  });

  it('shows an error toast when the response shape is unexpected', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          // Missing required string fields — schema validation should reject.
          category: 42,
          title: 'something',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const onResult = vi.fn();
    const user = userEvent.setup();
    render(createElement(ImageAnalysisButton, { onResult }));

    const input = screen
      .getByRole('button', { name: /Analyze a photo/ })
      .parentElement?.querySelector('input[type="file"]');
    const goodFile = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
    await user.upload(input as HTMLInputElement, goodFile);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Unexpected response from image analysis. Please try again.',
      );
    });
    expect(onResult).not.toHaveBeenCalled();
  });

  it('shows a soft non-blocking notice when fetch rejects (network failure)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const onResult = vi.fn();
    const user = userEvent.setup();
    render(createElement(ImageAnalysisButton, { onResult }));

    const input = screen
      .getByRole('button', { name: /Analyze a photo/ })
      .parentElement?.querySelector('input[type="file"]');
    const goodFile = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
    await user.upload(input as HTMLInputElement, goodFile);

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(SOFT_NOTICE);
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('opens the file picker when the button is clicked', async () => {
    const user = userEvent.setup();
    render(createElement(ImageAnalysisButton, { onResult: vi.fn() }));

    const button = screen.getByRole('button', { name: /Analyze a photo/ });
    const input = button.parentElement?.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');

    await user.click(button);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('shows a soft non-blocking notice when FileReader yields a non-string result', async () => {
    const OriginalFileReader = globalThis.FileReader;
    class FakeReader {
      public result: ArrayBuffer | null = new ArrayBuffer(4);
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      readAsDataURL() {
        // Schedule the callback so the promise resolves to a non-string result.
        setTimeout(() => {
          this.onload?.();
        }, 0);
      }
    }
    vi.stubGlobal('FileReader', FakeReader);

    const user = userEvent.setup();
    render(createElement(ImageAnalysisButton, { onResult: vi.fn() }));

    const input = screen
      .getByRole('button', { name: /Analyze a photo/ })
      .parentElement?.querySelector('input[type="file"]');
    const goodFile = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
    await user.upload(input as HTMLInputElement, goodFile);

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(SOFT_NOTICE);
    });
    vi.stubGlobal('FileReader', OriginalFileReader);
  });

  it('shows a soft non-blocking notice when FileReader returns a result without base64 payload', async () => {
    const OriginalFileReader = globalThis.FileReader;
    class FakeReader {
      public result: string = 'data:image/jpeg;base64'; // no comma → split[1] undefined
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      readAsDataURL() {
        setTimeout(() => {
          this.onload?.();
        }, 0);
      }
    }
    vi.stubGlobal('FileReader', FakeReader);

    const user = userEvent.setup();
    render(createElement(ImageAnalysisButton, { onResult: vi.fn() }));

    const input = screen
      .getByRole('button', { name: /Analyze a photo/ })
      .parentElement?.querySelector('input[type="file"]');
    const goodFile = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
    await user.upload(input as HTMLInputElement, goodFile);

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(SOFT_NOTICE);
    });
    vi.stubGlobal('FileReader', OriginalFileReader);
  });

  it('shows a soft non-blocking notice when FileReader fires an error event', async () => {
    const OriginalFileReader = globalThis.FileReader;
    class FakeReader {
      public result: string | null = null;
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      readAsDataURL() {
        setTimeout(() => {
          this.onerror?.();
        }, 0);
      }
    }
    vi.stubGlobal('FileReader', FakeReader);

    const user = userEvent.setup();
    render(createElement(ImageAnalysisButton, { onResult: vi.fn() }));

    const input = screen
      .getByRole('button', { name: /Analyze a photo/ })
      .parentElement?.querySelector('input[type="file"]');
    const goodFile = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
    await user.upload(input as HTMLInputElement, goodFile);

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(SOFT_NOTICE);
    });
    vi.stubGlobal('FileReader', OriginalFileReader);
  });
});
