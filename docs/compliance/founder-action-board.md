# Founder-action board — remaining human steps

**Status:** Open. Engineering cannot close these. This board is an inventory, not a claim of done.  
**Machine-check:** `make founder-secrets-check` (or `./scripts/founder-secrets-check.sh --strict` before go-live). Reports present / missing / placeholder only — **never prints values**. A green row is visibility, not a provisioned production.

Process start is already fail-closed for JWT public-key load, Stripe keys (payment service), and `ENCRYPTION_KEY` in production. Do **not** add OAuth / SendGrid / Sentry / Apple Pay as `bin/dev` startup fatals.

| Residual | Human step | Env / artifact | Check |
|----------|------------|----------------|-------|
| Google OAuth | Cloud Console → OAuth 2.0 Web client; register `{OAUTH_REDIRECT_BASE}/api/v1/auth/callback/google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `make founder-secrets-check` |
| Facebook OAuth | Meta Developer → Facebook Login; register `…/callback/facebook` | `FACEBOOK_CLIENT_ID` (+ secret in store) | same |
| Apple Sign In | Developer → Sign in with Apple Services ID | `APPLE_CLIENT_ID` (+ secret / native audience) | same |
| SendGrid | Create account → API key → from-address | `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` | same |
| Sentry | Create project → DSN | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | same |
| Stripe webhook | Dashboard endpoint `https://api.no-markup.com/api/v1/webhooks/stripe` | `STRIPE_WEBHOOK_SECRET` | same (payment also refuses to start if missing) |
| Stripe publishable | Live/test `pk_` for web + iOS Rail A | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `NOMARKUP_STRIPE_PUBLISHABLE_KEY` | same |
| PII cipher | `openssl rand -base64 32` into the secrets store | `ENCRYPTION_KEY` | same (production cipher already fail-closed) |
| Checkr | Account + package slug when background checks go live | `CHECKR_API_KEY` | same |
| Deploy gate | Only after cluster + secrets + migrate-on-deploy are real | `DEPLOY_PROVISIONED=true` | same (`present` only when `true`) |
| Apple Pay verify | Stripe/Apple → download association file → replace placeholder → verify domain. **Do not invent bytes.** | `web/public/.well-known/apple-developer-merchantid-domain-association` | same (FAIL while PLACEHOLDER / TODO / example) |

**Refs:** `docs/TODOS.md` (OAUTH-FULL-SETUP, SendGrid #6, Sentry #7, Apple Pay) · `docs/operations/prod-launch-todo.md` Phase 2 · `docs/compliance/apple-pay-domain.md` · `docs/operations/provisioning-checklist.md`
