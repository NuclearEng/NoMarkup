# Apple Pay domain association — ops residual

**Status:** **Engineering closed for code path**; **domain verification is human/ops**.  
**Do not invent or commit a real merchant association file.**

## What ships in the repo

| Artifact | Reality |
|----------|---------|
| `web/public/.well-known/apple-developer-merchantid-domain-association` | **PLACEHOLDER only** — not valid for Apple/Stripe verification |
| `web/public/.well-known/README.md` | How to replace the placeholder |
| Stripe Payment Request / PaymentSheet (web + iOS Rail A) | Code-ready when domain + merchant ID + `pk_` exist |

Apple will reject domain verification against the placeholder content. Until a real file is installed on the production host, **do not claim live Apple Pay on `no-markup.com`**.

## Ops steps (human)

1. Stripe Dashboard → **Settings → Payment methods → Apple Pay → Add domain** for `no-markup.com` (and `www` / staging hosts as needed).  
2. Download the association file Stripe provides (or the file from Apple Developer for the merchant ID).  
3. **Replace** `web/public/.well-known/apple-developer-merchantid-domain-association` with that exact content (no wrapper HTML, no extra whitespace edits if Apple is picky).  
4. Deploy so  
   `https://no-markup.com/.well-known/apple-developer-merchantid-domain-association`  
   serves the real file (Next.js serves `web/public/` at the site root — no rewrite required).  
5. Complete verification in Stripe Dashboard.  
6. Configure Apple Pay merchant ID for iOS (`merchant.com.nomarkup.app` or the ASC merchant) + publishable key on the review/staging backend (`NOMARKUP_STRIPE_PUBLISHABLE_KEY` / `pk_`).

## Related

- [`privacy-purpose-string-inventory.md`](./privacy-purpose-string-inventory.md) — Payment Request / PassKit inventory  
- [`ios-payment-rails-design.md`](./ios-payment-rails-design.md) — Rail A Stripe + Apple Pay  
- [`device-smoke-checklist.md`](./device-smoke-checklist.md) — Buy now / Orders pay smoke  
- [`launch-board.md`](./launch-board.md) — B3+++ residual merchant + `pk_`  

## Honesty rule

Engineering **must not** fabricate association file bytes, claim production Apple Pay before verification, or treat the placeholder as a submit-ready payment rail. Residual stays **`[~]` ops-gated** until a human completes the steps above.

**Machine-check (does not close this residual):** `make founder-secrets-check` fails the `APPLE_PAY_DOMAIN_ASSOCIATION` row while the in-repo file still contains `PLACEHOLDER` / `TODO` / `example`.
