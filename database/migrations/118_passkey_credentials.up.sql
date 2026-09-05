-- IOS-SEC.2: WebAuthn passkey credentials (server half).
--
-- One row per registered passkey (public-key credential source). A user may
-- hold many (iPhone, Mac, security key). Verification happens in the gateway
-- via github.com/go-webauthn/webauthn; this table is the credential record
-- store the spec requires the Relying Party to keep.
--
-- Column notes:
--   credential_id  raw credential ID bytes from the authenticator. Globally
--                  unique per spec; the UNIQUE constraint doubles as the
--                  lookup index for discoverable (usernameless) assertions.
--   public_key     COSE-encoded credential public key (opaque to SQL).
--   sign_count     authenticator signature counter (uint32 on the wire,
--                  BIGINT here). Regression => possible cloned key; the
--                  gateway rejects the login when it detects one.
--   flags          raw WebAuthn authenticator flags byte (UP/UV/BE/BS)
--                  captured at registration and refreshed on login. Stored
--                  because §7.2 login validation REQUIRES the Backup
--                  Eligible bit to be compared against the stored value —
--                  without it every iCloud-synced passkey would fail login.
--   transports     hint list from the client ("internal", "hybrid", ...);
--                  echoed into allowCredentials to speed up mediation.

CREATE TABLE passkey_credentials (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id BYTEA NOT NULL UNIQUE,
    public_key    BYTEA NOT NULL,
    sign_count    BIGINT NOT NULL DEFAULT 0,
    flags         SMALLINT NOT NULL DEFAULT 0,
    transports    TEXT[] NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);

CREATE TRIGGER set_updated_at_passkey_credentials
    BEFORE UPDATE ON passkey_credentials
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- FK + hot-path index: "list a user's live passkeys" (registration exclusions,
-- allowCredentials, settings UI). credential_id is already indexed by its
-- UNIQUE constraint.
CREATE INDEX idx_passkey_credentials_user
    ON passkey_credentials (user_id)
    WHERE deleted_at IS NULL;

COMMENT ON TABLE passkey_credentials IS
    'WebAuthn passkey credential records (IOS-SEC.2). Verified by the gateway with go-webauthn.';

-- Feature flag: ships DISABLED. The four /api/v1/auth/passkeys/* routes are
-- gated by RequireFlag("passkeys") which fails closed in production, so
-- nothing is reachable until an admin flips this row. Plain (non-money) flag.
-- ON CONFLICT DO NOTHING so a re-run or an admin's earlier choice is never
-- clobbered (same pattern as migration 060).
INSERT INTO feature_flags (key, enabled, description) VALUES
    ('passkeys', false, 'WebAuthn passkey registration and sign-in (gateway /auth/passkeys endpoints)')
ON CONFLICT (key) DO NOTHING;
