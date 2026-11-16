// printAuthenticatedDocument — fetches a gateway-rendered HTML document with
// the bearer token and prints it from an off-screen iframe (not the live app).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { printAuthenticatedDocument } from '@/lib/print';

const getAccessToken = vi.fn<() => string | null>();
vi.mock('@/lib/auth', () => ({
  getAccessToken: () => getAccessToken(),
}));

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function frame(): HTMLIFrameElement {
  const el = document.querySelector('iframe');
  if (!el) throw new Error('no iframe was appended');
  return el;
}

/**
 * jsdom loads the srcdoc frame itself a moment later and would then run the
 * real handler against its unimplemented window.print. Detach the handler so
 * each test decides if and when "load" happens.
 */
function takeLoadHandler(el: HTMLIFrameElement): () => void {
  const handler = el.onload;
  if (!handler) throw new Error('iframe has no onload handler');
  el.onload = null;
  return () => {
    handler.call(el, new Event('load'));
  };
}

/** Run the function under test and return the frame plus its detached load handler. */
async function printDoc(path: string): Promise<{ el: HTMLIFrameElement; load: () => void }> {
  await printAuthenticatedDocument(path);
  const el = frame();
  return { el, load: takeLoadHandler(el) };
}

beforeEach(() => {
  getAccessToken.mockReturnValue('tok-123');
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('<html><body>Invoice #7</body></html>', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('printAuthenticatedDocument', () => {
  it('fetches the document with the bearer token and cookies', async () => {
    await printDoc('/api/v1/invoices/7/print');

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/invoices/7/print', {
      headers: { Authorization: 'Bearer tok-123' },
      credentials: 'include',
    });
  });

  it('sends no Authorization header when there is no access token', async () => {
    getAccessToken.mockReturnValue(null);

    await printDoc('/api/v1/invoices/7/print');

    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ headers: {}, credentials: 'include' });
  });

  it('rejects with the status and appends no frame when the document fails to load', async () => {
    fetchMock.mockResolvedValue(new Response('forbidden', { status: 403 }));

    await expect(printAuthenticatedDocument('/api/v1/invoices/7/print')).rejects.toThrow(
      'Failed to load document (403)',
    );
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('seeds a hidden zero-size iframe with the fetched HTML', async () => {
    const { el } = await printDoc('/api/v1/invoices/7/print');

    expect(el.parentElement).toBe(document.body);
    expect(el.srcdoc).toBe('<html><body>Invoice #7</body></html>');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.position).toBe('fixed');
    expect(el.style.width).toBe('0px');
    expect(el.style.height).toBe('0px');
  });

  it('prints the frame — not the app window — on load, then removes it after 1s', async () => {
    vi.useFakeTimers();
    const appPrint = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { el, load } = await printDoc('/api/v1/invoices/7/print');
    const focus = vi.fn();
    const print = vi.fn();
    vi.spyOn(el, 'contentWindow', 'get').mockReturnValue({ focus, print } as unknown as Window);

    load();

    expect(focus).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();
    expect(appPrint).not.toHaveBeenCalled();
    // Kept mounted while the print dialog is open…
    vi.advanceTimersByTime(999);
    expect(document.querySelector('iframe')).toBe(el);
    // …then cleaned up.
    vi.advanceTimersByTime(1);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('removes the frame immediately when it has no content window', async () => {
    const { el, load } = await printDoc('/api/v1/invoices/7/print');
    vi.spyOn(el, 'contentWindow', 'get').mockReturnValue(null);

    load();

    expect(document.querySelector('iframe')).toBeNull();
  });
});
