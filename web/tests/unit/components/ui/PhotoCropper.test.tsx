import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Radix Slider observes its container size — jsdom has no ResizeObserver.
if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    writable: true,
    configurable: true,
  });
}

// Mock react-easy-crop with a stub that fires onCropComplete once
// inside an effect so the Save button has a valid croppedAreaPixels
// after mount (firing during render would cause an infinite loop).
vi.mock('react-easy-crop', async () => {
  const React = await import('react');
  const Cropper = (props: {
    onCropComplete?: (a: unknown, b: unknown) => void;
  }) => {
    React.useEffect(() => {
      props.onCropComplete?.(
        { x: 0, y: 0, width: 100, height: 75 },
        { x: 0, y: 0, width: 100, height: 75 },
      );
      // We only want to fire once; props.onCropComplete is stable enough
      // for our purposes since the parent uses useCallback.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="cropper-canvas" />;
  };
  return { default: Cropper };
});

// Replace next/dynamic with the static import — vitest can resolve the
// real react-easy-crop module synchronously because we mocked it above.
vi.mock('next/dynamic', async () => {
  const mod = (await import('react-easy-crop')) as { default: unknown };
  return {
    default: () => mod.default,
  };
});

// Import AFTER the mocks above so the dynamic loader picks up the stub.
import { PhotoCropper, renderCroppedJpeg } from '@/components/ui/PhotoCropper';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PhotoCropper', () => {
  it('renders the dialog header and controls', async () => {
    render(<PhotoCropper src="blob:test" onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('dialog', { name: /crop photo/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Zoom')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Rotation')).toBeInTheDocument();
  });

  it('fires onCancel when the close button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<PhotoCropper src="blob:test" onSave={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByLabelText('Close cropper'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('fires onCancel when the Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<PhotoCropper src="blob:test" onSave={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows the Reset button so the user can revert their adjustments', async () => {
    render(<PhotoCropper src="blob:test" onSave={() => {}} onCancel={() => {}} />);
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /reset crop, zoom, and rotation/i }),
      ).toBeInTheDocument();
    });
  });

  it('exposes accessible rotation and zoom sliders', async () => {
    render(<PhotoCropper src="blob:test" onSave={() => {}} onCancel={() => {}} />);
    await waitFor(() => {
      expect(screen.getByLabelText('Zoom')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Rotation')).toBeInTheDocument();
  });

  it('fires onSave with a Blob when the user saves', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    // Stub the heavy renderer so the test doesn't need a real canvas.
    const fakeBlob = new Blob(['hi'], { type: 'image/jpeg' });
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        translate: () => {},
        rotate: () => {},
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(0) }),
        putImageData: () => {},
      }),
      toBlob: (cb: (b: Blob) => void) => {
        cb(fakeBlob);
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- DOM API, not React.createElement
    const originalCreate = document.createElement.bind(document);
     
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
      return originalCreate(tag);
    /* eslint-disable-next-line @typescript-eslint/no-deprecated -- mocking the DOM Document.createElement, not React.createElement */
    }) as typeof document.createElement);

    // Stub Image so loadImage resolves immediately.
    const OriginalImage = globalThis.Image;
    class StubImage {
      width = 100;
      height = 100;
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        setTimeout(() => {
          this.onload?.();
        }, 0);
      }
    }
    // @ts-expect-error — deliberate stub.
    globalThis.Image = StubImage;

    try {
      render(<PhotoCropper src="blob:test" onSave={onSave} onCancel={() => {}} />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /save crop/i })).toBeEnabled();
      });
      await user.click(screen.getByRole('button', { name: /save crop/i }));
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledOnce();
      });
      expect(onSave.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    } finally {
      globalThis.Image = OriginalImage;
    }
  });
});

describe('renderCroppedJpeg', () => {
  it('rejects when no canvas 2d context is available', async () => {
    const OriginalImage = globalThis.Image;
    class StubImage {
      width = 100;
      height = 100;
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        setTimeout(() => {
          this.onload?.();
        }, 0);
      }
    }
    // @ts-expect-error — deliberate stub.
    globalThis.Image = StubImage;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- DOM API
    const original = document.createElement.bind(document);
     
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') {
        return {
          getContext: () => null,
          width: 0,
          height: 0,
          toBlob: () => {},
        } as unknown as HTMLCanvasElement;
      }
      return original(tag);
    /* eslint-disable-next-line @typescript-eslint/no-deprecated -- mocking the DOM Document.createElement, not React.createElement */
    }) as typeof document.createElement);

    try {
      await expect(
        renderCroppedJpeg('blob:none', { x: 0, y: 0, width: 10, height: 10 }, 0),
      ).rejects.toThrow();
    } finally {
      globalThis.Image = OriginalImage;
    }
  });
});
