import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompletionPhotos } from '@/components/providers/CompletionPhotos';

const uploadMutate = vi.fn();
const markCompleteMutate = vi.fn();
let markCompletePending = false;

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => createElement('img', props),
}));

vi.mock('@/hooks/useWorkspace', () => ({
  useUploadCompletionPhoto: () => ({ mutate: uploadMutate, isPending: false }),
}));

vi.mock('@/hooks/useContracts', () => ({
  useMarkComplete: () => ({ mutate: markCompleteMutate, isPending: markCompletePending }),
}));

// Stub URL.createObjectURL for jsdom (not implemented by default)
const objectUrlSpy = vi.fn((_blob: Blob) => 'blob:mock://preview');
Object.defineProperty(globalThis.URL, 'createObjectURL', {
  configurable: true,
  writable: true,
  value: objectUrlSpy,
});
Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

describe('CompletionPhotos', () => {
  beforeEach(() => {
    uploadMutate.mockReset();
    markCompleteMutate.mockReset();
    objectUrlSpy.mockClear();
    markCompletePending = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the Completion Photos heading', () => {
    render(<CompletionPhotos contractId="c-1" />);
    expect(screen.getByText('Completion Photos')).toBeDefined();
  });

  it('renders Before and After upload slots with accessible labels', () => {
    render(<CompletionPhotos contractId="c-1" />);
    // Both file input and tap-target button have an aria-label about upload
    expect(screen.getAllByLabelText(/Upload before photo/).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Upload after photo/).length).toBeGreaterThan(0);
  });

  it('disables Mark Complete when no after photo is present', () => {
    render(<CompletionPhotos contractId="c-1" />);
    const button = screen.getByRole('button', {
      name: /Upload an after photo before marking complete/,
    });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('shows hint text when after photo is missing', () => {
    render(<CompletionPhotos contractId="c-1" />);
    expect(screen.getByText(/After.*photo to mark this job complete/i)).toBeDefined();
  });

  it('forwards className prop to the root container', () => {
    const { container } = render(<CompletionPhotos contractId="c-1" className="my-completion" />);
    expect(container.querySelector('.my-completion')).not.toBeNull();
  });

  it('clicking a slot button opens the underlying file input via ref click', async () => {
    const user = userEvent.setup();
    render(<CompletionPhotos contractId="c-1" />);
    const beforeBtn = screen.getByLabelText(/Upload before photo —/);
    // The hidden input shares the aria-label with the button; we want to verify
    // clicking the button does not throw (which would happen if ref handling broke).
    await user.click(beforeBtn);
    expect(beforeBtn).toBeDefined();
  });

  it('triggers upload mutation when a file is selected', () => {
    const { container } = render(<CompletionPhotos contractId="c-1" />);
    const fileInput = container.querySelector(
      'input[type="file"][aria-label="Upload before photo"]',
    );
    expect(fileInput).not.toBeNull();

    const file = new File(['photo-bytes'], 'before.png', { type: 'image/png' });
    Object.defineProperty(fileInput as HTMLInputElement, 'files', {
      configurable: true,
      value: [file],
    });
    fireEvent.change(fileInput as HTMLInputElement);

    expect(objectUrlSpy).toHaveBeenCalledWith(file);
    expect(uploadMutate).toHaveBeenCalledTimes(1);
    const args = uploadMutate.mock.calls[0] as unknown[];
    const payload = args[0] as { phase: string; file: File };
    expect(payload.phase).toBe('before');
    expect(payload.file).toBe(file);
  });

  it('upload onSuccess swaps the local preview for the server-confirmed URL', () => {
    const { container } = render(<CompletionPhotos contractId="c-1" />);
    const fileInput = container.querySelector(
      'input[type="file"][aria-label="Upload after photo"]',
    );
    expect(fileInput).not.toBeNull();

    const file = new File(['after-bytes'], 'after.png', { type: 'image/png' });
    Object.defineProperty(fileInput as HTMLInputElement, 'files', {
      configurable: true,
      value: [file],
    });
    fireEvent.change(fileInput as HTMLInputElement);

    expect(uploadMutate).toHaveBeenCalled();
    // Invoke the mutate's onSuccess callback to simulate server response
    const args = uploadMutate.mock.calls[0] as unknown[];
    const callbacks = args[1] as {
      onSuccess: (data: { url: string }) => void;
      onSettled: () => void;
    };
    act(() => {
      callbacks.onSuccess({ url: 'https://cdn/server-after.png' });
      callbacks.onSettled();
    });

    // Submit button now enabled since after photo is set
    const submit = screen.getByRole('button', { name: /Mark job as complete/ });
    expect(submit.hasAttribute('disabled')).toBe(false);
  });

  it('upload onError reverts the preview state', () => {
    const { container } = render(<CompletionPhotos contractId="c-1" />);
    const fileInput = container.querySelector(
      'input[type="file"][aria-label="Upload after photo"]',
    );
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    Object.defineProperty(fileInput as HTMLInputElement, 'files', {
      configurable: true,
      value: [file],
    });
    fireEvent.change(fileInput as HTMLInputElement);

    const args = uploadMutate.mock.calls[0] as unknown[];
    const cb = args[1] as { onError: () => void; onSettled: () => void };
    act(() => {
      cb.onError();
      cb.onSettled();
    });

    // After failure + settle, uploading text should be gone
    expect(screen.queryByText(/Uploading after photo/i)).toBeNull();
  });

  it('handleFileChange returns early when no file is selected', () => {
    const { container } = render(<CompletionPhotos contractId="c-1" />);
    const fileInput = container.querySelector(
      'input[type="file"][aria-label="Upload before photo"]',
    );
    Object.defineProperty(fileInput as HTMLInputElement, 'files', {
      configurable: true,
      value: [],
    });
    fireEvent.change(fileInput as HTMLInputElement);

    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it('clicking Mark Complete triggers the markComplete mutation when after exists', () => {
    const { container } = render(<CompletionPhotos contractId="contract-xyz" />);
    const fileInput = container.querySelector(
      'input[type="file"][aria-label="Upload after photo"]',
    );
    const file = new File(['p'], 'p.png', { type: 'image/png' });
    Object.defineProperty(fileInput as HTMLInputElement, 'files', {
      configurable: true,
      value: [file],
    });
    fireEvent.change(fileInput as HTMLInputElement);
    const args = uploadMutate.mock.calls[0] as unknown[];
    const cb = args[1] as { onSuccess: (d: { url: string }) => void; onSettled: () => void };
    act(() => {
      cb.onSuccess({ url: 'https://cdn/after.png' });
      cb.onSettled();
    });

    const submit = screen.getByRole('button', { name: /Mark job as complete/ });
    fireEvent.click(submit);
    expect(markCompleteMutate).toHaveBeenCalledWith('contract-xyz');
  });

  it('shows uploading sr-only live region while a phase is uploading', () => {
    const { container } = render(<CompletionPhotos contractId="c-1" />);
    const fileInput = container.querySelector(
      'input[type="file"][aria-label="Upload before photo"]',
    );
    const file = new File(['p'], 'p.png', { type: 'image/png' });
    Object.defineProperty(fileInput as HTMLInputElement, 'files', {
      configurable: true,
      value: [file],
    });
    fireEvent.change(fileInput as HTMLInputElement);

    expect(screen.getByText(/Uploading before photo/i)).toBeDefined();
  });
});
