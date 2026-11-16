/**
 * Sanitizing serializer for JSON-LD structured data injected into a
 * `<script type="application/ld+json">` block.
 *
 * `JSON.stringify` is NOT an HTML-safe serializer. It escapes `"` and `\`
 * but leaves `<`, `>`, and `&` untouched, and the HTML tokenizer leaves
 * script-data state on the literal byte sequence `</script`. Any
 * user-controlled string that reaches the payload — a listing title, a job
 * description, a provider bio — can therefore close the script element early
 * and have the remainder of its value parsed as live markup on our origin.
 *
 * The production CSP (see `web/src/middleware.ts`) has no `'unsafe-inline'`
 * in `script-src` and uses a per-request nonce with `'strict-dynamic'`, so an
 * injected `<script>` will not execute. That is not sufficient on its own:
 * `style-src` allows `'unsafe-inline'` and `img-src` allows `https:`, which
 * leaves CSS-based exfiltration, dangling-markup exfiltration, and full-page
 * overlay phishing reachable. Sanitize at the sink rather than relying on the
 * CSP to contain an injection that should never have been emitted.
 *
 * DOMPurify is the right tool for untrusted *HTML*; it is the wrong tool here,
 * because the sink is a JSON island and DOMPurify would corrupt valid JSON.
 * The correct sanitizer for this context escapes the three characters that
 * carry meaning to the HTML tokenizer. `<` / `>` / `&` are
 * valid JSON escapes that decode to the same characters, so schema.org
 * consumers (Google, Bing, structured-data validators) parse the output
 * identically to the unescaped form.
 */
export function sanitizeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
