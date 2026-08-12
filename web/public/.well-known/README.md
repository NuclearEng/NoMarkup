# `.well-known` static files

## `apple-developer-merchantid-domain-association`

**PLACEHOLDER only.** Production must replace this file with the exact
content from Stripe (or Apple) when registering `no-markup.com` (and any
`www` / staging hosts) for Apple Pay.

**Do not invent or paste fabricated association bytes.** Until a human
downloads the real file from Stripe/Apple and deploys it, Apple Pay domain
verification will fail. Ops checklist: `docs/compliance/apple-pay-domain.md`.

- Stripe path: Dashboard → Settings → Payment methods → Apple Pay → Add new
  domain → download association file.
- Served at:
  `https://<host>/.well-known/apple-developer-merchantid-domain-association`
- Next.js serves files under `web/public/` at the site root; no rewrite
  required.
- Related guideline: ASR-5.1.2.vii (payment method disclosure + domain
  association). Privacy copy should mention that card payments and Apple Pay
  / Google Pay are processed by Stripe; NoMarkup never stores raw card
  numbers.
- Machine-check (does not close this residual): `make founder-secrets-check`
  **FAIL**s the Apple Pay row while this file still contains PLACEHOLDER /
  TODO / example.
