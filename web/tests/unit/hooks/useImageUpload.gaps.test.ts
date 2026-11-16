// useImageUpload — branches useImageUpload.test.ts does not reach: how the
// accepted-format list is worded (PDF, one type, none), byte-sized limits,
// progress events without a known total, and the relative-URL upload when no
// access token is available.
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageUpload } from '@/hooks/useImageUpload';

const mocks = vi.hoisted(() => ({
  post: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
  getAccessToken: vi.fn<() => string | null>(),
}));

vi.mock('@/lib/api', () => ({
  api: { post: mocks.post },
  getApiErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error && err.message ? err.message : fallback,
}));

vi.mock('@/lib/auth', () => ({
  getAccessToken: mocks.getAccessToken,
}));

vi.mock('@/lib/constants', () => ({
  API_BASE_URL: 'https://api.test',
  MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
}));

type Listener = (event: { lengthComputable: boolean; loaded: number; total: number }) => void;

class FakeXHR {
  static last: FakeXHR | null = null;
  status = 0;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  private listeners: Record<string, (() => void)[]> = {};
  private progressListeners: Listener[] = [];
  upload = {
    addEventListener: (_event: string, cb: Listener) => {
      this.progressListeners.push(cb);
    },
  };

  constructor() {
    FakeXHR.last = this;
  }

  addEventListener(event: string, cb: () => void) {
    (this.listeners[event] ??= []).push(cb);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.emit('abort');
  }
  emit(event: string) {
    for (const cb of this.listeners[event] ?? []) cb();
  }
  progress(event: { lengthComputable: boolean; loaded: number; total: number }) {
    for (const cb of this.progressListeners) cb(event);
  }
}

function currentXhr(): FakeXHR {
  if (!FakeXHR.last) throw new Error('no XMLHttpRequest was created');
  return FakeXHR.last;
}

function makeFile(type: string, size: number): File {
  const file = new File([new Uint8Array(1)], 'doc', { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

beforeEach(() => {
  mocks.post.mockReset();
  mocks.getAccessToken.mockReset();
  FakeXHR.last = null;
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useImageUpload — rejected file type wording', () => {
  const cases: { name: string; accepted: string[]; message: string }[] = [
    { name: 'a single PDF type', accepted: ['application/pdf'], message: 'Use PDF.' },
    { name: 'a single image type', accepted: ['image/webp'], message: 'Use WEBP.' },
    {
      name: 'images plus PDF',
      accepted: ['image/jpeg', 'image/png', 'application/pdf'],
      message: 'Use JPEG, PNG, or PDF.',
    },
    { name: 'an empty accept list', accepted: [], message: 'Use a supported format.' },
  ];

  it.each(cases)('$name → "$message"', async ({ accepted, message }) => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useImageUpload({ context: 'document', acceptedTypes: accepted, onError }),
    );

    let outcome: Awaited<ReturnType<typeof result.current.upload>> | undefined;
    await act(async () => {
      outcome = await result.current.upload(makeFile('image/gif', 10));
    });

    expect(outcome).toEqual({ ok: false, error: message });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(message);
    expect(onError).toHaveBeenCalledWith(message);
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

describe('useImageUpload — size limit wording', () => {
  it('reports sizes under 1 KB in bytes', async () => {
    const { result } = renderHook(() =>
      useImageUpload({ context: 'document', maxSizeBytes: 500 }),
    );

    let outcome: Awaited<ReturnType<typeof result.current.upload>> | undefined;
    await act(async () => {
      outcome = await result.current.upload(makeFile('image/png', 600));
    });

    expect(outcome).toEqual({ ok: false, error: 'Max 500 B — this file is 600 B.' });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the limit', async () => {
    mocks.post.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() =>
      useImageUpload({ context: 'document', maxSizeBytes: 500 }),
    );

    act(() => {
      void result.current.upload(makeFile('image/png', 500));
    });

    await waitFor(() => {
      expect(result.current.status).toBe('getting_url');
    });
    expect(mocks.post).toHaveBeenCalledWith('/api/v1/images/upload-url', {
      filename: 'doc',
      mime_type: 'image/png',
      file_size_bytes: 500,
      context: 'document',
    });
  });
});

describe('useImageUpload — upload transport', () => {
  async function startUpload(uploadUrl: string) {
    mocks.post.mockResolvedValueOnce({ upload_url: uploadUrl, object_key: 'obj-1' });
    const hook = renderHook(() => useImageUpload({ context: 'document' }));
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = hook.result.current.upload(makeFile('image/png', 100));
    });
    await waitFor(() => {
      expect(hook.result.current.status).toBe('uploading');
    });
    return { ...hook, pending };
  }

  it('prefixes a relative upload URL with the API base and omits Authorization when there is no token', async () => {
    mocks.getAccessToken.mockReturnValue(null);
    const { pending } = await startUpload('/api/v1/images/upload/obj-1');

    const xhr = currentXhr();
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://api.test/api/v1/images/upload/obj-1');
    expect(xhr.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(mocks.getAccessToken).toHaveBeenCalledTimes(1);

    act(() => {
      xhr.abort();
    });
    await act(async () => {
      await pending;
    });
  });

  it('never asks for the access token when uploading to an absolute pre-signed URL', async () => {
    const { pending } = await startUpload('https://s3.test/bucket/obj-1?sig=abc');

    const xhr = currentXhr();
    expect(xhr.url).toBe('https://s3.test/bucket/obj-1?sig=abc');
    expect(xhr.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(mocks.getAccessToken).not.toHaveBeenCalled();

    act(() => {
      xhr.abort();
    });
    await act(async () => {
      await pending;
    });
  });

  it('leaves progress untouched for events without a computable length', async () => {
    const { result, pending } = await startUpload('https://s3.test/bucket/obj-1');
    const xhr = currentXhr();

    act(() => {
      xhr.progress({ lengthComputable: false, loaded: 50, total: 0 });
    });
    expect(result.current.progress).toBe(0);

    act(() => {
      xhr.progress({ lengthComputable: true, loaded: 1, total: 3 });
    });
    expect(result.current.progress).toBe(33);

    act(() => {
      xhr.abort();
    });
    await act(async () => {
      await pending;
    });
    expect(result.current.error).toBe('Upload cancelled');
  });
});
