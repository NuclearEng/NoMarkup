# PII Encryption Key Rotation

NoMarkup encrypts the at-rest PII columns mandated by CLAUDE.md §6 with
nacl/secretbox (libsodium-compatible XSalsa20-Poly1305). Storage format is
`base64(nonce || secretbox)`, where the nonce is 24 bytes and the sealed box
carries a 16-byte Poly1305 tag.

| Table                | Columns                                                                       |
|----------------------|-------------------------------------------------------------------------------|
| `users`              | `phone`, `mfa_secret`                                                         |
| `users`              | `mfa_backup_codes` (argon2id-hashed, **one-way** — not encrypted, never re-keyed) |
| `provider_profiles`  | `service_address`, `ein_tin`, `insurance_policy_number`                       |
| `provider_employees` | `email`, `phone`, `license_number`, `insurance_policy_number`                 |
| `properties`         | `address`, `notes`                                                            |

Not encrypted, deliberately: `users.email` (auth lookup),
`provider_profiles.insurance_provider` (a carrier name, not personal data),
`properties.city` / `state` / `zip_code` / `location` (indexed search + PostGIS
proximity), `company_employees.*` (dormant table — see migration 099).

> **⚠️ If you are looking at a runbook older than migration 098**, it told you to
> clear `pii_encrypted_v1` and re-run `encrypt-pii` with both keys set. That
> procedure **double-encrypted every row**: `ENCRYPTION_KEY_PREVIOUS` was named
> in the tool's comments but never read by its code, so the "re-encrypt" step
> sealed the *existing ciphertext* a second time. Recovering such a value needs
> two unseals with two keys in the right order, which no read path performs. The
> tool no longer has that failure mode, and the flag-clearing step is gone. If
> you suspect a past rotation followed the old runbook, see
> [Recovering from a double encryption](#recovering-from-a-double-encryption).

## The `pii_encrypted_v1` flag is advisory

Every covered table carries a `pii_encrypted_v1 BOOLEAN`. **Do not branch on
it.** It is a *row* flag over a *column* property: writing `service_address`
through the encrypting update path flips the row to `TRUE` even while that same
row's `ein_tin` is still legacy plaintext.

Read paths detect ciphertext **per value** instead
(`crypto.Cipher.DecryptStringOrPassthrough`), and so does the backfill tool. The
flag survives for observability and for the tool's reporting only.

For a truthful per-column picture, use the view added by migration 098:

```sql
SELECT table_name, column_name, count(*)
  FROM pii_plaintext_audit
 GROUP BY 1, 2 ORDER BY 1, 2;
```

It lists every value that is **definitely** still plaintext. On a fully
backfilled database it is empty. It exposes table/column/row-id only — never the
value — so the audit cannot itself become a plaintext-PII sink.

## Key Format

A key is exactly 32 random bytes, base64-encoded:

```bash
openssl rand -base64 32
```

| Variable                  | Required            | Purpose                                                     |
|---------------------------|---------------------|-------------------------------------------------------------|
| `ENCRYPTION_KEY`          | **yes**, outside development | Primary key — all encryption, and the first decryption attempt. |
| `ENCRYPTION_KEY_PREVIOUS` | no                  | Decrypt-only fallback during a rotation.                     |

The ephemeral-key fallback is gated on *"is this development?"*, not on *"is
this production?"* — anything not recognisably `ENVIRONMENT=development` fails
closed and refuses to start. (The earlier polarity meant `ENVIRONMENT=staging`
silently minted a different random key per pod, making PII written by one
replica undecryptable by every other. Do not reintroduce that.)

## How the tool decides what to do with a value

`database/cmd/encrypt-pii` classifies each value independently. Classification
is by **authentication**, not by a flag and not by a guess: `secretbox.Open`
verifies a Poly1305 tag, so "does this open under key K" is decisive.

| Class       | Test                                                    | Action                                    |
|-------------|---------------------------------------------------------|-------------------------------------------|
| `empty`     | `NULL` or `''`                                          | left alone                                |
| `current`   | opens under `ENCRYPTION_KEY`                            | **skipped, byte-for-byte** — this is what makes a re-run a no-op instead of a double encryption |
| `rekey`     | opens under `ENCRYPTION_KEY_PREVIOUS` only              | decrypted with PREVIOUS, re-sealed under PRIMARY |
| `plaintext` | not base64, or decodes to < 40 bytes — cannot be our wire format | encrypted under PRIMARY           |
| `unknown`   | *is* our wire format but opens under **neither** key    | **the whole run is refused**              |

The `unknown` case is the dangerous one: it means somebody's ciphertext under a
key you were not given. Encrypting it is exactly the destruction described
above, so the tool aborts. That check runs as a **pre-flight pass over every
table before a single byte is written**, so a wrong key aborts while the
database is still untouched rather than halfway through.

Everything the tool encrypts is decrypted again with PRIMARY and compared
byte-for-byte against the source **before** the `UPDATE` is issued.

## First-time backfill

```bash
DATABASE_URL=... ENCRYPTION_KEY=$KEY make encrypt-pii
```

Preview first with `make encrypt-pii-dry-run` (classifies and reports, writes
nothing). Confirm afterwards that `SELECT count(*) FROM pii_plaintext_audit;`
returns 0.

## Rotation Procedure (zero-downtime)

### Step 1 — Generate a new key

```bash
NEW_KEY=$(openssl rand -base64 32)
```

Store **both** the old and the new key in the secret manager (Vault / K8s
Secret). Do not remove the old one yet.

### Step 2 — Roll every service with both keys configured

```
ENCRYPTION_KEY=$NEW_KEY              # new primary
ENCRYPTION_KEY_PREVIOUS=$OLD_KEY     # decrypt-only fallback
```

This applies to the **user service and the gateway** — both hold a cipher (the
gateway decrypts `provider_employees` and the GDPR data export). After the
rollout, reads still succeed because the cipher tries primary then previous, and
new writes are sealed under `$NEW_KEY`.

Nothing is broken between Step 2 and Step 3: a mixture of old-key and new-key
ciphertext in the same column is a normal, fully readable state.

### Step 3 — Re-key the historical data

```bash
DATABASE_URL=... ENCRYPTION_KEY=$NEW_KEY ENCRYPTION_KEY_PREVIOUS=$OLD_KEY \
  make encrypt-pii
```

**There is no flag to clear, and no maintenance window.** Rows already under
`$NEW_KEY` are skipped, rows under `$OLD_KEY` are re-keyed, and any plaintext
straggler is encrypted. Run it as many times as you like; every run after the
first reports `written=0`.

A successful rotation log looks like this:

```
rotation mode: PREVIOUS key configured, stale rows will be re-keyed
preflight: empty=1 current=0 rekey=4 plaintext=0 unknown=0
users: rows=1 written=1 encrypted=0 rekeyed=1 already_current=0
provider_profiles: rows=1 written=1 encrypted=0 rekeyed=3 already_current=0
encrypt-pii complete
```

and the immediate re-run looks like this:

```
preflight: empty=1 current=4 rekey=0 plaintext=0 unknown=0
users: rows=1 written=0 encrypted=0 rekeyed=0 already_current=1
provider_profiles: rows=1 written=0 encrypted=0 rekeyed=0 already_current=3
```

If the pre-flight reports `unknown > 0`, the run aborts and names the offending
`table.column` + row ids. That almost always means `ENCRYPTION_KEY_PREVIOUS` is
missing or is the wrong key. **Do not work around it** — supply the right key.
The abort is the safety feature.

### Step 4 — Drop the previous key

Only after `preflight: ... rekey=0 unknown=0` on a clean re-run:

```bash
# Roll the services once more, this time with ONLY the new key.
unset ENCRYPTION_KEY_PREVIOUS
```

The old key can now be removed from the secret manager. Until this step
completes, keep the old key — it is the only thing that can read a row the
re-key pass missed.

## Audit Verification

```bash
# 1. Schema-level: nothing left in plaintext.
psql "$DATABASE_URL" -c "SELECT table_name, column_name, count(*)
                           FROM pii_plaintext_audit GROUP BY 1,2 ORDER BY 1,2;"
#    Expect zero rows.

# 2. Key-level: everything opens under the CURRENT key and nothing under the old.
DATABASE_URL=... ENCRYPTION_KEY=$NEW_KEY make encrypt-pii-dry-run
#    Expect: current=<N> rekey=0 plaintext=0 unknown=0, and no PREVIOUS set.

# 3. Dump-level: no recognisable plaintext survives.
pg_dump "$DATABASE_URL" -F p > /tmp/dump.sql
awk '/^COPY public\.users /,/^\\\.$/' /tmp/dump.sql \
  | grep -E "[0-9]{3}-[0-9]{3}-[0-9]{4}|JBSWY3DP" || echo "users: OK"
awk '/^COPY public\.provider_profiles /,/^\\\.$/' /tmp/dump.sql \
  | grep -E "[0-9]{2}-[0-9]{7}" || echo "provider_profiles: OK"
rm -f /tmp/dump.sql
```

Check 2 is the strong one: it is an authentication test, whereas check 3 is a
pattern search that can only ever find plaintext it happens to have a regex for.

## Recovering from a double encryption

Symptom: a value opens under the current key, but the "plaintext" you get back
is itself another base64 blob rather than a phone number or an EIN.

```
open=true plaintext="AnIEAb1YopSe0qSMUv43FJbUgjXwiwLn..."   ← doubled
open=true plaintext="12-3456789"                            ← healthy
```

Recovery requires the key each layer was sealed with, applied outermost-first:
unseal with the key that was PRIMARY at the time of the bad run, then unseal the
result with the key that had been PRIMARY before that. If either key has been
destroyed, the value is unrecoverable — restore the affected rows from the
backup taken before the rotation.

There is no tool for this, deliberately: an automated "unwrap until it looks
like text" pass would be a decryption oracle. Do it as a one-off, with both keys
in hand, against a copy of the data.

## Disaster Recovery

If `ENCRYPTION_KEY` is lost with no `ENCRYPTION_KEY_PREVIOUS` fallback, the
encrypted PII is **unrecoverable** — that is the point of encryption at rest.

Mitigations baked into the platform:

1. Services refuse to start without a valid key outside development, so silent
   reuse of an ephemeral key cannot happen accidentally.
2. `encrypt-pii` refuses to run against ciphertext it cannot open, so a key
   mistake surfaces as a loud abort rather than as quiet destruction.
3. The `pii_plaintext_audit` view makes the un-encrypted surface a single
   `SELECT`, so drift is detectable rather than assumed.
4. Backup procedures (`docs/operations/backup-disaster-recovery.md`) must
   include the encryption key in the same secret-manager backup as the
   database — losing one without the other is the failure mode to avoid.

## See Also

- `services/user/internal/crypto/secretbox.go` — the wrapper (`DecryptStringOrPassthrough`, `LooksLikeCiphertext`).
- `gateway/internal/crypto/secretbox.go` — the gateway's byte-compatible sibling.
- `database/cmd/encrypt-pii/main.go` — the backfill / rotation tool.
- `database/migrations/031_encrypt_pii.up.sql`, `033_encrypt_more_pii.up.sql` — the flags.
- `database/migrations/098_pii_plaintext_audit.up.sql` — the discriminator + audit view.
- `database/migrations/099_ssn_last_four_comment_correction.up.sql` — `company_employees` is dormant and plaintext.
- CLAUDE.md §6 — the policy.
