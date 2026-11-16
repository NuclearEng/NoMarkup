import { describe, expect, it } from 'vitest';

import { sanitizeJsonLd } from '@/lib/json-ld';

describe('sanitizeJsonLd', () => {
  it('escapes the characters that let a string break out of a <script> block', () => {
    const out = sanitizeJsonLd({ name: '</script><img src=x>' });

    // The literal byte sequence the HTML tokenizer looks for must not survive.
    expect(out).not.toContain('</script');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).toContain('\\u003c');
    expect(out).toContain('\\u003e');
  });

  it('escapes ampersands so entity sequences cannot be reconstructed', () => {
    const out = sanitizeJsonLd({ name: 'Tools & Hardware' });

    expect(out).not.toContain('&');
    expect(out).toContain('\\u0026');
  });

  it('round-trips to the original values — schema.org consumers see no change', () => {
    const payload = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Drill </script><style>body{display:none}</style>',
      description: 'Barely used & still sharp <3',
      offers: { '@type': 'Offer', price: '42.00', priceCurrency: 'USD' },
    };

    expect(JSON.parse(sanitizeJsonLd(payload))).toEqual(payload);
  });

  it('leaves a benign payload semantically identical to JSON.stringify', () => {
    const payload = { '@type': 'Product', name: 'Cordless drill', price: 4200 };

    expect(JSON.parse(sanitizeJsonLd(payload))).toEqual(JSON.parse(JSON.stringify(payload)));
  });
});
