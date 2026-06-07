import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageUpload } from '@/hooks/useImageUpload';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    code = 'ERR';
    userMessage(fallback: string) {
      return this.message || fallback;
    }
  },
  getApiErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error && err.message ? err.message : fallback,
}));

vi.mock('@/lib/auth', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
}));

const { api } = await import('@/lib/api');
const auth = await import('@/lib/auth');

// ─── Fake XMLHttpRequest ────────────────────────────────────────────
// Captures the most recently constructed instance so tests can drive
// progress, success, error, and abort lifecycle events synchronously.
interface FakeXHR {
  upload: { listeners: Record<string, Array<(ev: ProgressEvent) => void>> };
  listeners: Record<string, Array<() => void>>;
  status: number;
  openArgs: { method: string; url: string } | null;
  headers: Record<string, string>;
  sentBody: unknown;
  aborted: boolean;
  open: (method: string, url: string) => void;
  setRequestHeader: (k: string, v: string) => void;
  send: (body: unknown) => void;
  abort: () => void;
  addEventListener: (event: string, cb: () => void) => void;
}

let lastXhr: FakeXHR | null = null;

function makeFakeXHR(): FakeXHR {
  const xhr: FakeXHR = {
    upload: { listeners: {} },
    listeners: {},
    status: 0,
    openArgs: null,
    headers: {},
    sentBody: null,
    aborted: false,
    open(method, url) {
      this.openArgs = { method, url };
    },
    setRequestHeader(k, v) {
      this.headers[k] = v;
    },
    send(body) {
      this.sentBody = body;
    },
    abort() {
      this.aborted = true;
      for (const cb of this.listeners['abort'] ?? []) cb();
    },
    addEventListener(event, cb) {
      this.listeners[event] ??= [];
      this.listeners[event].push(cb);
    },
  };
  // upload uses a separate addEventListener (for 'progress' events).
  Object.assign(xhr.upload, {
    addEventListener(event: string, cb: (ev: ProgressEvent) => void) {
      xhr.upload.listeners[event] ??= [];
      xhr.upload.listeners[event].push(cb);
    },
  });
  return xhr;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  // resetAllMocks() drops the mock implementation, so re-prime the auth stub.
  vi.mocked(auth.getAccessToken).mockImplementation(() => 'test-token');
  lastXhr = null;
  vi.stubGlobal(
    'XMLHttpRequest',
    vi.fn(() => {
      const x = makeFakeXHR();
      lastXhr = x;
      return x;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeFile(opts: { name?: string; type?: string; size?: number } = {}): File {
  const { name = 'photo.jpg', type = 'image/jpeg', size = 1024 } = opts;
  // Create a Blob of the requested size, then wrap as a File.
  const blob = new Blob([new Uint8Array(size)], { type });
  const file = new File([blob], name, { type });
  // jsdom's File ignores the constructor's reported size for typed arrays in
  // some environments — pin via property override to keep the assertion stable.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function fireXhrLoad(status: number) {
  if (!lastXhr) throw new Error('no xhr captured');
  lastXhr.status = status;
  for (const cb of lastXhr.listeners['load'] ?? []) cb();
}

function fireXhrError() {
  if (!lastXhr) throw new Error('no xhr captured');
  for (const cb of lastXhr.listeners['error'] ?? []) cb();
}

describe('useImageUpload', () => {
  it('starts in idle status with progress=0 and no error', () => {
    const { result } = renderHook(() => useImageUpload({ context: 'job_photo' }));

    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('rejects unsupported MIME types without hitting the network', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useImageUpload({ context: 'job_photo', onError }),
    );

    const bad = makeFile({ type: 'application/pdf' });

    let returned: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      returned = (await result.current.upload(bad)) as typeof returned;
    });

    expect(returned?.ok).toBe(false);
    expect(returned?.error).toContain('Use ');
    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('JPEG');
    expect(onError).toHaveBeenCalled();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('rejects files over the size limit', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useImageUpload({ context: 'job_photo', maxSizeBytes: 1024, onError }),
    );

    const big = makeFile({ size: 2048 });

    let returned: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      returned = (await result.current.upload(big)) as typeof returned;
    });

    expect(returned?.ok).toBe(false);
    expect(returned?.error).toContain('Max ');
    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Max');
    expect(onError).toHaveBeenCalled();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('runs the full happy path: get-url -> PUT -> confirm -> complete', async () => {
    vi.mocked(api.post)
      // Step 1: pre-signed URL
      .mockResolvedValueOnce({
        upload_url: 'https://s3.example/upload/xyz',
        object_key: 'uploads/abc.jpg',
      })
      // Step 3: confirm
      .mockResolvedValueOnce({
        content_type_valid: true,
        actual_content_type: 'image/jpeg',
        confirmed_url: 'https://cdn.example/abc.jpg',
      });

    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useImageUpload({ context: 'job_photo', onSuccess }),
    );

    const file = makeFile();

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.upload(file);
    });

    // Wait for the XHR to be opened.
    await waitFor(() => { expect(lastXhr).not.toBeNull(); });
    expect(lastXhr?.openArgs?.method).toBe('PUT');
    expect(lastXhr?.openArgs?.url).toBe('https://s3.example/upload/xyz');
    // Absolute (http) URL — auth header should NOT be attached.
    expect(lastXhr?.headers['Authorization']).toBeUndefined();
    expect(lastXhr?.headers['Content-Type']).toBe('image/jpeg');

    await act(async () => {
      fireXhrLoad(200);
      await pending;
    });

    expect(result.current.status).toBe('complete');
    expect(result.current.progress).toBe(100);
    expect(onSuccess).toHaveBeenCalledWith({
      objectKey: 'uploads/abc.jpg',
      confirmedUrl: 'https://cdn.example/abc.jpg',
    });
  });

  it('attaches the bearer token when the upload URL is a relative path', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        upload_url: '/api/v1/images/proxy-upload/xyz',
        object_key: 'uploads/abc.jpg',
      })
      .mockResolvedValueOnce({
        content_type_valid: true,
        actual_content_type: 'image/jpeg',
        confirmed_url: '/cdn/abc.jpg',
      });

    const { result } = renderHook(() => useImageUpload({ context: 'job_photo' }));

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.upload(makeFile());
    });

    await waitFor(() => { expect(lastXhr).not.toBeNull(); });

    expect(lastXhr?.headers['Authorization']).toBe('Bearer test-token');

    await act(async () => {
      fireXhrLoad(204);
      await pending;
    });

    expect(result.current.status).toBe('complete');
  });

  it('reports an error when the PUT returns a non-2xx status', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      upload_url: 'https://s3.example/upload/xyz',
      object_key: 'uploads/abc.jpg',
    });

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useImageUpload({ context: 'job_photo', onError }),
    );

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.upload(makeFile());
    });

    await waitFor(() => { expect(lastXhr).not.toBeNull(); });

    await act(async () => {
      fireXhrLoad(500);
      await pending;
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('500');
    expect(onError).toHaveBeenCalled();
  });

  it('flags an invalid content-type from the confirm step as an error', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        upload_url: 'https://s3.example/upload/xyz',
        object_key: 'uploads/abc.jpg',
      })
      .mockResolvedValueOnce({
        content_type_valid: false,
        actual_content_type: 'application/octet-stream',
        confirmed_url: '',
      });

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useImageUpload({ context: 'job_photo', onError }),
    );

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.upload(makeFile());
    });

    await waitFor(() => { expect(lastXhr).not.toBeNull(); });

    await act(async () => {
      fireXhrLoad(200);
      await pending;
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('octet-stream');
    expect(onError).toHaveBeenCalled();
  });

  it('updates the progress field as upload progress events fire', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      upload_url: 'https://s3.example/upload/xyz',
      object_key: 'uploads/abc.jpg',
    });

    const { result } = renderHook(() => useImageUpload({ context: 'job_photo' }));

    await act(async () => {
      void result.current.upload(makeFile());
      // Allow the api.post microtask to resolve so the XHR is constructed.
      await Promise.resolve();
    });

    await waitFor(() => { expect(lastXhr).not.toBeNull(); });

    act(() => {
      const cbs = lastXhr?.upload.listeners['progress'] ?? [];
      for (const cb of cbs) {
        cb({ lengthComputable: true, loaded: 50, total: 100 } as unknown as ProgressEvent);
      }
    });

    expect(result.current.progress).toBe(50);
  });

  it('reset() aborts the in-flight XHR (abort handler then surfaces "Upload cancelled")', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      upload_url: 'https://s3.example/upload/xyz',
      object_key: 'uploads/abc.jpg',
    });

    const { result } = renderHook(() => useImageUpload({ context: 'job_photo' }));

    await act(async () => {
      void result.current.upload(makeFile());
      await Promise.resolve();
    });

    await waitFor(() => { expect(lastXhr).not.toBeNull(); });

    await act(async () => {
      result.current.reset();
      // Let the abort listener resolve and the upload's catch run.
      await Promise.resolve();
      await Promise.resolve();
    });

    // The XHR was actually aborted.
    expect(lastXhr?.aborted).toBe(true);
    // After reset, the upload promise's abort handler rejects with "Upload cancelled",
    // which the catch block surfaces as an error state. This is the documented behavior.
    expect(result.current.error).toBe('Upload cancelled');
  });

  it('reset() with no in-flight upload returns the hook to idle', () => {
    const { result } = renderHook(() => useImageUpload({ context: 'job_photo' }));

    act(() => { result.current.reset(); });

    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('reports a "Network error" when the XHR error event fires', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      upload_url: 'https://s3.example/upload/xyz',
      object_key: 'uploads/abc.jpg',
    });

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useImageUpload({ context: 'job_photo', onError }),
    );

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.upload(makeFile());
    });

    await waitFor(() => { expect(lastXhr).not.toBeNull(); });

    await act(async () => {
      fireXhrError();
      await pending;
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Network error during upload');
    expect(onError).toHaveBeenCalledWith('Network error during upload');
  });

  it('formatBytes formats KB and MB sizes in the size-limit error message', async () => {
    // Trigger the >= 1024 KB branch. maxSize is 2 MB, file is 3 MB.
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useImageUpload({
        context: 'job_photo',
        maxSizeBytes: 2 * 1024 * 1024,
        onError,
      }),
    );

    const huge = makeFile({ size: 3 * 1024 * 1024 });

    let returned: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      returned = (await result.current.upload(huge)) as typeof returned;
    });

    expect(returned?.ok).toBe(false);
    expect(typeof returned?.error).toBe('string');
    expect(result.current.status).toBe('error');
    // Both numbers should be formatted as MB (>= 1024 KB).
    expect(result.current.error).toContain('3.0 MB');
    expect(result.current.error).toContain('2.0 MB');
    expect(onError).toHaveBeenCalled();
  });
});
