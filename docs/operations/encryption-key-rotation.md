# PII Encryption Key Rotation

NoMarkup encrypts the at-rest PII columns mandated by CLAUDE.md §6 with
nacl/secretbox (libsodium-compatible XSalsa20-Poly1305). Encrypted columns:

| Table              | Columns                                                                  |
|--------------------|--------------------------------------------------------------------------|
| `users`            | `phone`, `mfa_secret`                                                    |
| `users`            | `mfa_backup_codes` (argon2id-hashed, **one-way** — not encrypted)        |
| `provider_profiles`| `service_address`, `ein_tin`, `insurance_policy_number`                  |

Each row carries a `pii_encrypted_v1 BOOLEAN` flag (added by migration 031)
that tells the read path whether to decrypt or pass through. The flag is
flipped to `TRUE` once the data is encrypted.

## Key Format

A key is exactly 32 random bytes, base64-encoded:

```bash
openssl rand -base64 32
```

Example: `Giw+Ezn4ZM6ltUUpj0CM6OFZPaFmPlbSfV+UyMBdLG8=`

## Environment Variables

| Variable                  | Required           | Purpose                                        |
|---------------------------|--------------------|------------------------------------------------|
| `ENCRYPTION_KEY`          | yes (in production)| Primary key — used for **all** encryption and the first decryption attempt. |
| `ENCRYPTION_KEY_PREVIOUS` | no                 | Decrypt-only fallback during rotation.         |

In development, missing `ENCRYPTION_KEY` falls back to an ephemeral key
(WARN-logged) so the user service can still boot. In production a missing or
invalid key is **fatal** — the service refuses to start (CLAUDE.md §6).

## Rotation Procedure (zero-downtime)

The goal: every row currently encrypted under the old key ends up encrypted
under the new key, with no read path losing access along the way.

### Step 1 — Generate a new key

```bash
NEW_KEY=$(openssl rand -base64 32)
echo "store this in your secret manager: $NEW_KEY"
```

Store both the old and new keys in your secret manager (Vault / K8s Secret).

### Step 2 — Roll services with both keys configured

Deploy the user service with:

```
ENCRYPTION_KEY=$NEW_KEY              # new primary
ENCRYPTION_KEY_PREVIOUS=$OLD_KEY     # decrypt-only fallback
```

After this rolls out:

- **Reads** still succeed because the cipher tries primary, then previous.
- **New writes** are encrypted under `$NEW_KEY` and the row's
  `pii_encrypted_v1` is already `TRUE`, so the field stays consistent — the
  raw column simply contains a ciphertext readable by the new key.

### Step 3 — Re-encrypt the historical data

The `encrypt-pii` tool only acts on rows where `pii_encrypted_v1 = FALSE`,
so a naive re-run is a no-op. To force a re-key, drop the flag for every
row first:

```sql
BEGIN;
UPDATE users              SET pii_encrypted_v1 = FALSE WHERE pii_encrypted_v1 = TRUE;
UPDATE provider_profiles  SET pii_encrypted_v1 = FALSE WHERE pii_encrypted_v1 = TRUE;
COMMIT;
```

> **Important:** between this `UPDATE` and the next step the read path will
> treat all rows as plaintext, even though the columns still contain old-key
> ciphertext. Reads will return that ciphertext to clients, which is wrong.
>
> Two ways to handle this:
>
> 1. **Maintenance window (preferred for small tables).** Take a 1-2 minute
>    write lock by running the SQL above and `make encrypt-pii` back-to-back.
>    The user service can keep serving — the ephemeral inconsistency is
>    constrained to the rows being processed in that window.
> 2. **Online rotation (large tables).** Add a `pii_encrypted_v2` flag,
>    let writes set both `v1` and `v2`, run a Go re-encryption tool that
>    decrypts with PREVIOUS and re-encrypts under the primary, then deprecate
>    `v1`. Build this as `040_rotate_pii_v2.up.sql` when the time comes.

Then run the backfill:

```bash
DATABASE_URL=...  ENCRYPTION_KEY=$NEW_KEY  ENCRYPTION_KEY_PREVIOUS=$OLD_KEY \
  make encrypt-pii
```

Each row is fetched, decrypted with PRIMARY-then-PREVIOUS, re-encrypted under
PRIMARY, and the flag flipped back to `TRUE`. Backup-code argon2id hashes are
left as-is (already prefixed with `argon2id$`).

### Step 4 — Drop the previous key

After verifying every row in users / provider_profiles has
`pii_encrypted_v1 = TRUE` and that the application is healthy:

```bash
# Roll the user service one more time, this time with ONLY the new key.
unset ENCRYPTION_KEY_PREVIOUS
```

The old key can now be removed from the secret manager.

## Audit Verification

After any rotation, confirm zero plaintext leakage:

```bash
PGPASSWORD=... pg_dump -h ... -U ... -d nomarkup -F p > /tmp/dump.sql

# These patterns must NOT appear in users or provider_profiles columns:
awk '/^COPY public\.users /,/^\\\.$/' /tmp/dump.sql \
  | grep -E "[0-9]{3}-[0-9]{3}-[0-9]{4}|JBSWY3DP" \
  || echo "users: OK (no plaintext)"

awk '/^COPY public\.provider_profiles /,/^\\\.$/' /tmp/dump.sql \
  | grep -E "[0-9]{2}-[0-9]{7}|[0-9]{3}\s(Main|Service|Trade|Pine)" \
  || echo "provider_profiles: OK (no plaintext)"
```

## Disaster Recovery

If `ENCRYPTION_KEY` is lost without a `ENCRYPTION_KEY_PREVIOUS` fallback,
the encrypted PII is **unrecoverable** — that's the whole point of
encryption-at-rest.

Mitigations baked into the platform:

1. The user service refuses to start without a valid key in production, so
   silent reuse of an ephemeral key cannot happen accidentally.
2. The flag column makes a partial-encryption state observable: a row with
   `pii_encrypted_v1 = TRUE` but garbage on disk indicates a key mismatch and
   surfaces immediately on the next read.
3. Backup procedures (see `docs/operations/backup-disaster-recovery.md`) must
   include the encryption key in the same secret manager backup as the
   database — losing one without the other is the failure mode to avoid.

## See Also

- `services/user/internal/crypto/secretbox.go` — the wrapper.
- `database/cmd/encrypt-pii/main.go` — the backfill tool.
- `database/migrations/031_encrypt_pii.up.sql` — the flag column.
- CLAUDE.md §6 — the policy.
