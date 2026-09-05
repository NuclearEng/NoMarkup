import { getAccessToken } from '@/lib/auth';

/**
 * Fetch an authenticated HTML document from the gateway and print just that
 * document — not the surrounding app. The previous approach called
 * window.print() on the live page, which printed the entire dark dashboard
 * (sidebar and all) because the app chrome isn't <nav>/<header>/<footer>.
 *
 * We render the server-generated document (the single source of truth, with
 * full customer/provider data and its own institutional print stylesheet)
 * into an off-screen iframe and print that frame. The path is relative so it
 * flows through the Next.js /api proxy to the gateway.
 */
export async function printAuthenticatedDocument(path: string): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Failed to load document (${String(res.status)})`);
  }
  const html = await res.text();

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove();
    }, 1000);
  };

  const doPrint = () => {
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      return;
    }
    win.focus();
    win.print();
    cleanup();
  };

  // Seed the document via `srcdoc` rather than the deprecated
  // `document.open()/write()/close()` trio. The frame parses the full HTML
  // (including the server's institutional print stylesheet) and fires `onload`
  // once it's ready, at which point we print just that frame.
  iframe.onload = doPrint;
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}
