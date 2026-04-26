import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  Element.prototype.scrollIntoView = function (): void { /* noop */ };
  Element.prototype.hasPointerCapture = function (): boolean { return false; };
  globalThis.ResizeObserver = class {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
  } as unknown as typeof ResizeObserver;
});

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: { src: string; alt: string; className?: string }) => (
    <img src={props.src} alt={props.alt} className={props.className} />
  ),
}));

const mockSubmit = vi.fn();
const submitState = { mutate: mockSubmit, isPending: false, isError: false };

vi.mock('@/hooks/useGuarantee', () => ({
  useSubmitGuaranteeClaim: () => submitState,
}));

const uploadFn = vi.fn();
const imageUploadState: {
  upload: typeof uploadFn;
  status: 'idle' | 'getting_url' | 'uploading' | 'confirming' | 'complete' | 'error';
  progress: number;
  error: string | null;
  onSuccessRef: ((r: { confirmedUrl: string; publicId: string }) => void) | null;
  onErrorRef: ((m: string) => void) | null;
} = {
  upload: uploadFn,
  status: 'idle',
  progress: 0,
  error: null,
  onSuccessRef: null,
  onErrorRef: null,
};

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: (opts: {
    onSuccess: (r: { confirmedUrl: string; publicId: string }) => void;
    onError: (m: string) => void;
  }) => {
    imageUploadState.onSuccessRef = opts.onSuccess;
    imageUploadState.onErrorRef = opts.onError;
    return imageUploadState;
  },
}));

import { GuaranteeClaimForm } from '@/components/contracts/GuaranteeClaimForm';

function resetState(): void {
  submitState.isPending = false;
  submitState.isError = false;
  imageUploadState.status = 'idle';
  imageUploadState.progress = 0;
  imageUploadState.error = null;
  uploadFn.mockReset();
  uploadFn.mockResolvedValue(undefined);
}

describe('GuaranteeClaimForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
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

  it('clears the description error after typing more', async () => {
    const user = userEvent.setup();
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess: vi.fn(),
      }),
    );
    // Trigger validation
    await user.click(screen.getByRole('button', { name: /submit claim/i }));
    // Type a single char into description — clears the description error
    const desc = screen.getByLabelText(/Description/i);
    await user.type(desc, 'a');
    // The description-specific error should be gone
    expect(screen.queryByText(/Description must be at least/)).toBeNull();
  });

  it('triggers the file picker when Add Photo is clicked', async () => {
    const user = userEvent.setup();
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess: vi.fn(),
      }),
    );
    const fileInput = screen.getByLabelText(/Upload evidence photo/);
    const clickSpy = vi.fn();
    fileInput.addEventListener('click', clickSpy);
    await user.click(screen.getByRole('button', { name: /add photo/i }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('uploads a selected file and adds the URL to the evidence list', async () => {
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess: vi.fn(),
      }),
    );
    const fileInput = screen.getByLabelText(/Upload evidence photo/);
    const file = new File([new Uint8Array(10)], 'evidence.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(uploadFn).toHaveBeenCalled();
    });
    // Now invoke the onSuccess callback that the form gave to useImageUpload
    expect(imageUploadState.onSuccessRef).not.toBeNull();
    act(() => {
      imageUploadState.onSuccessRef?.({ confirmedUrl: 'https://cdn/e1.png', publicId: 'p1' });
    });
    await screen.findByAltText(/Evidence photo 1/);
  });

  it('removes an uploaded evidence photo when its remove button is clicked', async () => {
    const user = userEvent.setup();
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess: vi.fn(),
      }),
    );
    const fileInput = screen.getByLabelText(/Upload evidence photo/);
    const file = new File([new Uint8Array(10)], 'evidence.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(uploadFn).toHaveBeenCalled();
    });
    act(() => {
      imageUploadState.onSuccessRef?.({ confirmedUrl: 'https://cdn/e1.png', publicId: 'p1' });
    });
    const remove = await screen.findByLabelText(/Remove photo 1/);
    await user.click(remove);
    expect(screen.queryByAltText(/Evidence photo 1/)).toBeNull();
  });

  it('shows the upload error when onError fires', async () => {
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess: vi.fn(),
      }),
    );
    const fileInput = screen.getByLabelText(/Upload evidence photo/);
    const file = new File([new Uint8Array(10)], 'big.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(uploadFn).toHaveBeenCalled();
    });
    act(() => {
      imageUploadState.onErrorRef?.('File is too large');
    });
    await screen.findByText('File is too large');
  });

  it('shows the in-flight upload progress label and disables Add Photo', () => {
    imageUploadState.status = 'uploading';
    imageUploadState.progress = 42;
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess: vi.fn(),
      }),
    );
    const btn = screen.getByRole('button', { name: /Uploading/ });
    expect(btn.textContent).toMatch(/42%/);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders an error from the image-upload hook when present', () => {
    imageUploadState.error = 'Server unavailable';
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess: vi.fn(),
      }),
    );
    expect(screen.getByText('Server unavailable')).toBeDefined();
  });

  it('does nothing when file selection has no file', () => {
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess: vi.fn(),
      }),
    );
    const fileInput = screen.getByLabelText(/Upload evidence photo/);
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(uploadFn).not.toHaveBeenCalled();
  });

  it('shows submit-claim error message when mutation fails', () => {
    submitState.isError = true;
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess: vi.fn(),
      }),
    );
    expect(screen.getByText(/Failed to submit claim/i)).toBeDefined();
  });

  it('disables submit while pending', () => {
    submitState.isPending = true;
    render(
      createElement(GuaranteeClaimForm, {
        contractId: 'c-1',
        onSuccess: vi.fn(),
      }),
    );
    const btn = screen.getByRole('button', { name: /submit claim/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
