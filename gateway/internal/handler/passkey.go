package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
)

// IOS-SEC.2 (server half): WebAuthn passkey registration + assertion.
//
// Routes (all gated behind the `passkeys` feature flag — fails closed in
// production, ships disabled):
//
//	POST /api/v1/auth/passkeys/register/options  (authed)   → {"publicKey": <CreationOptions>}
//	POST /api/v1/auth/passkeys/register/verify   (authed)   → 204
//	POST /api/v1/auth/passkeys/assert/options    (unauthed) → {"publicKey": <RequestOptions>}
//	POST /api/v1/auth/passkeys/assert/verify     (unauthed) → password-login-shaped session response
//
// Design notes (security posture — the non-obvious parts):
//   - Ceremony state (challenge → webauthn.SessionData) lives in Redis with a
//     5-minute TTL (passkeyCeremonyTTL), the repo's standard short-lived-state
//     store (idle sessions, rate limits, flag cache). Retrieval is
//     destructive (GETDEL): a challenge is single-use, and a failed
//     verification burns it — replaying either ceremony leg is impossible.
//   - Assertion state is keyed by the CHALLENGE (which the authenticator
//     echoes back inside clientDataJSON), because the assert endpoints are
//     unauthenticated and the wire contract is the standard WebAuthn
//     credential JSON — there is no side-channel session id.
//   - Enumeration resistance: assert/options answers an unknown email, an
//     email with no passkeys, and no email at all with the IDENTICAL response
//     shape — valid options with an empty allowCredentials list (a
//     discoverable-credential request). Only "this account has passkeys" is
//     ever revealed, never "this account exists".
//   - assert/verify failures all collapse to one generic 401: expired
//     challenge, unknown credential, bad signature, and sign-count regression
//     are indistinguishable to the caller (details go to slog only).
//   - Sign-count regressions (go-webauthn's CloneWarning) REJECT the login:
//     a counter that went backwards means a second copy of the private key
//     may exist. Authenticators that never increment (counter always 0 —
//     iCloud Keychain) do not trip this.
//   - Token minting reuses the existing user-service RPC surface (no proto
//     change): FindOrCreateByOAuth(provider="passkey", provider_id=<user id>).
//     The user row is loaded from OUR credential record first, so the RPC can
//     only ever resolve-or-link that exact existing user — it cannot create a
//     new account. The response path is AuthHandler.completeSessionLogin, the
//     same terminal step as password login.

const (
	// passkeyRPIDDefault is the Relying Party ID — the registrable domain
	// passkeys are scoped to. iOS apps assert with origin https://<rp id>
	// via the webcredentials:no-markup.com associated domain.
	passkeyRPIDDefault = "no-markup.com"

	// passkeyRPName is the human-facing Relying Party display name.
	passkeyRPName = "NoMarkup"

	// passkeyCeremonyTTL bounds how long an issued challenge stays valid.
	// Mirrored into the WebAuthn options `timeout` field (client hint) and
	// enforced twice server-side: Redis key TTL + go-webauthn's SessionData
	// expiry check. 5 minutes matches the library default and comfortably
	// covers Face ID / security-key interaction without leaving stale
	// challenges around.
	passkeyCeremonyTTL = 5 * time.Minute

	// passkeySessionPrefix namespaces ceremony-state keys in Redis.
	passkeySessionPrefix = "passkey_session"

	// passkeyAssertFailedMsg is the single client-facing message for every
	// assert/verify failure mode (anti-oracle; see design notes above).
	passkeyAssertFailedMsg = "Passkey sign-in failed. Please try again or sign in another way."

	// passkeyUnavailableMsg is returned when the ceremony state backend is
	// down — a platform problem, not a user problem (CLAUDE.md §15).
	passkeyUnavailableMsg = "Passkeys are temporarily unavailable. Please try again shortly."
)

// passkeyRPID returns the Relying Party ID (PASSKEY_RP_ID overrides for local
// web development where the effective domain is localhost; production uses the
// default).
func passkeyRPID() string {
	if v := strings.TrimSpace(os.Getenv("PASSKEY_RP_ID")); v != "" {
		return v
	}
	return passkeyRPIDDefault
}

// passkeyRPOrigins returns the allowed WebAuthn origins. The canonical origin
// is https://no-markup.com — also what iOS AuthenticationServices reports for
// app-bound ceremonies. Outside production the localhost web dev origin is
// added, mirroring the FRONTEND_URL / CORS dev-convenience pattern.
// PASSKEY_RP_ORIGINS (comma-separated) replaces the list entirely when set.
func passkeyRPOrigins() []string {
	if raw := strings.TrimSpace(os.Getenv("PASSKEY_RP_ORIGINS")); raw != "" {
		var origins []string
		for _, o := range strings.Split(raw, ",") {
			if o = strings.TrimSpace(o); o != "" {
				origins = append(origins, o)
			}
		}
		if len(origins) > 0 {
			return origins
		}
	}
	origins := []string{"https://" + passkeyRPIDDefault}
	if !strings.EqualFold(strings.TrimSpace(os.Getenv("ENVIRONMENT")), "production") {
		origins = append(origins, "http://localhost:3000")
	}
	return origins
}

// --- Ceremony state store (challenge → SessionData) ---

// errPasskeySessionNotFound reports a missing/expired/already-consumed
// ceremony state entry.
var errPasskeySessionNotFound = errors.New("passkey ceremony state not found")

// passkeySessionStore persists in-flight WebAuthn ceremony state between the
// options and verify legs. Take is destructive (single-use challenges).
type passkeySessionStore interface {
	Save(ctx context.Context, key string, data []byte, ttl time.Duration) error
	Take(ctx context.Context, key string) ([]byte, error)
}

// redisPasskeySessionStore is the production store: multi-replica safe and
// TTL-bounded. Unlike the read-through caches, errors here are surfaced (not
// swallowed) — losing ceremony state mid-flow must fail the request, not
// silently produce an unverifiable ceremony.
type redisPasskeySessionStore struct {
	rdb *redis.Client
}

func (s *redisPasskeySessionStore) Save(ctx context.Context, key string, data []byte, ttl time.Duration) error {
	return s.rdb.Set(ctx, key, data, ttl).Err()
}

func (s *redisPasskeySessionStore) Take(ctx context.Context, key string) ([]byte, error) {
	// GETDEL: atomic fetch-and-burn, so two concurrent verify calls for the
	// same challenge cannot both succeed (Redis 7 per stack; needs ≥ 6.2).
	data, err := s.rdb.GetDel(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, errPasskeySessionNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("passkey session getdel: %w", err)
	}
	return data, nil
}

// memoryPasskeySessionStore backs ceremony state when Redis is not configured
// (local dev, unit tests). Single-process only — NOT multi-replica safe; the
// constructor logs a warning when this fallback engages outside tests.
type memoryPasskeySessionStore struct {
	mu      sync.Mutex
	entries map[string]memoryPasskeySessionEntry
}

type memoryPasskeySessionEntry struct {
	data      []byte
	expiresAt time.Time
}

func newMemoryPasskeySessionStore() *memoryPasskeySessionStore {
	return &memoryPasskeySessionStore{entries: make(map[string]memoryPasskeySessionEntry)}
}

func (s *memoryPasskeySessionStore) Save(_ context.Context, key string, data []byte, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Opportunistically evict expired entries so an abandoned-ceremony drip
	// cannot grow the map unbounded.
	now := time.Now()
	for k, e := range s.entries {
		if e.expiresAt.Before(now) {
			delete(s.entries, k)
		}
	}
	s.entries[key] = memoryPasskeySessionEntry{data: data, expiresAt: now.Add(ttl)}
	return nil
}

func (s *memoryPasskeySessionStore) Take(_ context.Context, key string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[key]
	if !ok {
		return nil, errPasskeySessionNotFound
	}
	delete(s.entries, key)
	if e.expiresAt.Before(time.Now()) {
		return nil, errPasskeySessionNotFound
	}
	return e.data, nil
}

// --- Credential store (passkey_credentials + users, migration 118) ---

var (
	// errPasskeyUserNotFound reports no live user for the given id/email.
	errPasskeyUserNotFound = errors.New("passkey user not found")
	// errPasskeyCredentialExists reports a credential_id UNIQUE collision.
	errPasskeyCredentialExists = errors.New("passkey credential already registered")
	// errPasskeyCredentialNotFound reports no live credential row.
	errPasskeyCredentialNotFound = errors.New("passkey credential not found")
)

// passkeyUserRow is the minimal user projection the ceremonies need.
type passkeyUserRow struct {
	ID          string
	Email       string
	DisplayName string
}

// passkeyCredentialRow mirrors one passkey_credentials row.
type passkeyCredentialRow struct {
	CredentialID []byte
	PublicKey    []byte
	SignCount    int64
	Flags        int16
	Transports   []string
}

// passkeyStore is the persistence seam for the passkey handler (constructor
// injection per CLAUDE.md §5; the pgx implementation is the production path,
// tests swap in an in-memory fake).
type passkeyStore interface {
	UserByID(ctx context.Context, userID string) (*passkeyUserRow, error)
	UserByEmail(ctx context.Context, email string) (*passkeyUserRow, error)
	UserCredentials(ctx context.Context, userID string) ([]passkeyCredentialRow, error)
	UserIDByCredentialID(ctx context.Context, credentialID []byte) (string, error)
	InsertCredential(ctx context.Context, userID string, row passkeyCredentialRow) error
	UpdateCredentialOnLogin(ctx context.Context, credentialID []byte, signCount int64, flags int16) error
}

// pgxPasskeyStore implements passkeyStore against PostgreSQL (parameterized
// queries only).
type pgxPasskeyStore struct {
	db *pgxpool.Pool
}

func (s *pgxPasskeyStore) UserByID(ctx context.Context, userID string) (*passkeyUserRow, error) {
	row := &passkeyUserRow{}
	err := s.db.QueryRow(ctx,
		`SELECT id::text, email, display_name FROM users WHERE id = $1 AND deleted_at IS NULL`,
		userID,
	).Scan(&row.ID, &row.Email, &row.DisplayName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errPasskeyUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("passkey user by id: %w", err)
	}
	return row, nil
}

func (s *pgxPasskeyStore) UserByEmail(ctx context.Context, email string) (*passkeyUserRow, error) {
	row := &passkeyUserRow{}
	err := s.db.QueryRow(ctx,
		`SELECT id::text, email, display_name FROM users WHERE email = $1 AND deleted_at IS NULL`,
		email,
	).Scan(&row.ID, &row.Email, &row.DisplayName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errPasskeyUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("passkey user by email: %w", err)
	}
	return row, nil
}

func (s *pgxPasskeyStore) UserCredentials(ctx context.Context, userID string) ([]passkeyCredentialRow, error) {
	rows, err := s.db.Query(ctx,
		`SELECT credential_id, public_key, sign_count, flags, transports
		 FROM passkey_credentials
		 WHERE user_id = $1 AND deleted_at IS NULL
		 ORDER BY created_at`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("passkey credentials for user: %w", err)
	}
	defer rows.Close()

	var out []passkeyCredentialRow
	for rows.Next() {
		var c passkeyCredentialRow
		if err := rows.Scan(&c.CredentialID, &c.PublicKey, &c.SignCount, &c.Flags, &c.Transports); err != nil {
			return nil, fmt.Errorf("scan passkey credential: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate passkey credentials: %w", err)
	}
	return out, nil
}

func (s *pgxPasskeyStore) UserIDByCredentialID(ctx context.Context, credentialID []byte) (string, error) {
	var userID string
	err := s.db.QueryRow(ctx,
		`SELECT user_id::text FROM passkey_credentials WHERE credential_id = $1 AND deleted_at IS NULL`,
		credentialID,
	).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errPasskeyCredentialNotFound
	}
	if err != nil {
		return "", fmt.Errorf("passkey user by credential id: %w", err)
	}
	return userID, nil
}

func (s *pgxPasskeyStore) InsertCredential(ctx context.Context, userID string, row passkeyCredentialRow) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO passkey_credentials (user_id, credential_id, public_key, sign_count, flags, transports)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		userID, row.CredentialID, row.PublicKey, row.SignCount, row.Flags, row.Transports,
	)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation on credential_id
		return errPasskeyCredentialExists
	}
	if err != nil {
		return fmt.Errorf("insert passkey credential: %w", err)
	}
	return nil
}

func (s *pgxPasskeyStore) UpdateCredentialOnLogin(ctx context.Context, credentialID []byte, signCount int64, flags int16) error {
	_, err := s.db.Exec(ctx,
		`UPDATE passkey_credentials SET sign_count = $2, flags = $3
		 WHERE credential_id = $1 AND deleted_at IS NULL`,
		credentialID, signCount, flags,
	)
	if err != nil {
		return fmt.Errorf("update passkey credential on login: %w", err)
	}
	return nil
}

// --- webauthn.User adapter ---

// passkeyWebAuthnUser adapts a user row + credential rows to webauthn.User.
// WebAuthnID (= the user handle authenticators store and echo back) is the
// UUID string bytes — stable, opaque, ≤64 bytes per spec.
type passkeyWebAuthnUser struct {
	row   *passkeyUserRow
	creds []webauthn.Credential
}

func (u *passkeyWebAuthnUser) WebAuthnID() []byte { return []byte(u.row.ID) }

func (u *passkeyWebAuthnUser) WebAuthnName() string { return u.row.Email }

func (u *passkeyWebAuthnUser) WebAuthnDisplayName() string {
	if u.row.DisplayName != "" {
		return u.row.DisplayName
	}
	return u.row.Email
}

func (u *passkeyWebAuthnUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

// toWebauthnCredentials converts stored rows into the library's Credential
// records (the subset login validation reads: id, public key, sign count,
// flags — the Backup Eligible bit MUST round-trip or §7.2 step "BE
// consistency" fails every synced-passkey login).
func toWebauthnCredentials(rows []passkeyCredentialRow) []webauthn.Credential {
	creds := make([]webauthn.Credential, 0, len(rows))
	for _, r := range rows {
		transports := make([]protocol.AuthenticatorTransport, 0, len(r.Transports))
		for _, t := range r.Transports {
			transports = append(transports, protocol.AuthenticatorTransport(t))
		}
		creds = append(creds, webauthn.Credential{
			ID:        r.CredentialID,
			PublicKey: r.PublicKey,
			Transport: transports,
			Flags:     webauthn.CredentialFlagsFromMsgpByte(byte(r.Flags)),
			Authenticator: webauthn.Authenticator{
				SignCount: uint32(r.SignCount), //nolint:gosec // stored from a uint32; ≤ MaxUint32
			},
		})
	}
	return creds
}

// transportsToStrings flattens the protocol transport hints for TEXT[] storage.
func transportsToStrings(transports []protocol.AuthenticatorTransport) []string {
	out := make([]string, 0, len(transports))
	for _, t := range transports {
		out = append(out, string(t))
	}
	return out
}

// --- Handler ---

// PasskeyHandler serves the four WebAuthn passkey endpoints.
type PasskeyHandler struct {
	store      passkeyStore
	sessions   passkeySessionStore
	userClient userv1.UserServiceClient
	auth       *AuthHandler
	webAuthn   *webauthn.WebAuthn
}

// NewPasskeyHandler creates a PasskeyHandler. cacheClient backs ceremony
// state; nil falls back to a process-local store (dev convenience — logged,
// and unfit for multi-replica deployments where REDIS_URL is mandatory
// anyway). Returns an error when the WebAuthn RP configuration is invalid
// (fail fast at startup per CLAUDE.md §12).
func NewPasskeyHandler(db *pgxpool.Pool, cacheClient *cache.Client, userClient userv1.UserServiceClient, auth *AuthHandler) (*PasskeyHandler, error) {
	wa, err := webauthn.New(&webauthn.Config{
		RPID:          passkeyRPID(),
		RPDisplayName: passkeyRPName,
		RPOrigins:     passkeyRPOrigins(),
		Timeouts: webauthn.TimeoutsConfig{
			Login: webauthn.TimeoutConfig{
				Enforce:    true,
				Timeout:    passkeyCeremonyTTL,
				TimeoutUVD: passkeyCeremonyTTL,
			},
			Registration: webauthn.TimeoutConfig{
				Enforce:    true,
				Timeout:    passkeyCeremonyTTL,
				TimeoutUVD: passkeyCeremonyTTL,
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("passkey webauthn config: %w", err)
	}

	var sessions passkeySessionStore
	if cacheClient != nil && cacheClient.Redis() != nil {
		sessions = &redisPasskeySessionStore{rdb: cacheClient.Redis()}
	} else {
		slog.Warn("passkeys: redis unavailable, using process-local ceremony state (single replica only)")
		sessions = newMemoryPasskeySessionStore()
	}

	return &PasskeyHandler{
		store:      &pgxPasskeyStore{db: db},
		sessions:   sessions,
		userClient: userClient,
		auth:       auth,
		webAuthn:   wa,
	}, nil
}

// passkeyRegistrationKey scopes registration ceremony state to one user; a
// re-request simply overwrites the previous in-flight ceremony.
func passkeyRegistrationKey(userID string) string {
	return cache.Key(passkeySessionPrefix, "reg", userID)
}

// passkeyAssertionKey scopes assertion ceremony state by challenge (the value
// the authenticator signs over and echoes back in clientDataJSON).
func passkeyAssertionKey(challenge string) string {
	return cache.Key(passkeySessionPrefix, "assert", challenge)
}

// registrationOptions builds BeginRegistration options: ES256 only (the iOS
// contract; every Apple platform authenticator), resident key preferred so
// the credential is discoverable (a passkey, not a plain 2FA key), and
// exclusions for already-registered credentials so an authenticator refuses a
// duplicate enrollment instead of silently double-registering.
func registrationOptions(existing []webauthn.Credential) []webauthn.RegistrationOption {
	opts := []webauthn.RegistrationOption{
		webauthn.WithCredentialParameters([]protocol.CredentialParameter{
			{Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgES256},
		}),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementPreferred,
			UserVerification: protocol.VerificationPreferred,
		}),
	}
	if len(existing) > 0 {
		opts = append(opts, webauthn.WithExclusions(webauthn.Credentials(existing).CredentialDescriptors()))
	}
	return opts
}

// loadWebAuthnUser assembles the webauthn.User adapter for a live user id.
func (h *PasskeyHandler) loadWebAuthnUser(ctx context.Context, userID string) (*passkeyWebAuthnUser, error) {
	row, err := h.store.UserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	creds, err := h.store.UserCredentials(ctx, row.ID)
	if err != nil {
		return nil, err
	}
	return &passkeyWebAuthnUser{row: row, creds: toWebauthnCredentials(creds)}, nil
}

// RegisterOptions handles POST /api/v1/auth/passkeys/register/options (authed).
func (h *PasskeyHandler) RegisterOptions(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	user, err := h.loadWebAuthnUser(r.Context(), claims.UserID)
	if errors.Is(err, errPasskeyUserNotFound) {
		// Valid token for a user that no longer exists (deleted account).
		writeError(w, http.StatusUnauthorized, "account is not available")
		return
	}
	if err != nil {
		slog.Error("passkey register options: load user failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	creation, session, err := h.webAuthn.BeginRegistration(user, registrationOptions(user.creds)...)
	if err != nil {
		slog.Error("passkey register options: begin registration failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if err := h.saveSession(r.Context(), passkeyRegistrationKey(claims.UserID), session); err != nil {
		slog.Error("passkey register options: save ceremony state failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, passkeyUnavailableMsg)
		return
	}

	// *protocol.CredentialCreation marshals as {"publicKey": {...}} — the
	// exact envelope the iOS client passes to AuthenticationServices.
	writeJSON(w, http.StatusOK, creation)
}

// RegisterVerify handles POST /api/v1/auth/passkeys/register/verify (authed).
// Body: standard WebAuthn registration credential JSON. Success: 204.
func (h *PasskeyHandler) RegisterVerify(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	parsed, err := protocol.ParseCredentialCreationResponseBody(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid passkey registration payload")
		return
	}

	session, err := h.takeSession(r.Context(), passkeyRegistrationKey(claims.UserID))
	if errors.Is(err, errPasskeySessionNotFound) {
		writeError(w, http.StatusBadRequest, "no passkey registration in progress — request options first")
		return
	}
	if err != nil {
		slog.Error("passkey register verify: load ceremony state failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, passkeyUnavailableMsg)
		return
	}

	user, err := h.loadWebAuthnUser(r.Context(), claims.UserID)
	if errors.Is(err, errPasskeyUserNotFound) {
		writeError(w, http.StatusUnauthorized, "account is not available")
		return
	}
	if err != nil {
		slog.Error("passkey register verify: load user failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	cred, err := h.webAuthn.CreateCredential(user, *session, parsed)
	if err != nil {
		slog.Warn("passkey register verify: credential verification failed",
			"error", err, "user_id", claims.UserID)
		writeError(w, http.StatusBadRequest, "passkey registration could not be verified")
		return
	}

	err = h.store.InsertCredential(r.Context(), claims.UserID, passkeyCredentialRow{
		CredentialID: cred.ID,
		PublicKey:    cred.PublicKey,
		SignCount:    int64(cred.Authenticator.SignCount),
		Flags:        int16(cred.Flags.MsgpByte()),
		Transports:   transportsToStrings(cred.Transport),
	})
	if errors.Is(err, errPasskeyCredentialExists) {
		writeError(w, http.StatusConflict, "this passkey is already registered")
		return
	}
	if err != nil {
		slog.Error("passkey register verify: persist credential failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("passkey registered", "user_id", claims.UserID)
	w.WriteHeader(http.StatusNoContent)
}

// assertOptionsRequest is the optional body for assert/options.
type assertOptionsRequest struct {
	Email string `json:"email"`
}

// AssertOptions handles POST /api/v1/auth/passkeys/assert/options (unauthed).
// Optional {"email"} narrows allowCredentials; any miss (unknown email, no
// passkeys, no email) degrades to a discoverable request with an empty allow
// list — identical shape, no enumeration signal.
func (h *PasskeyHandler) AssertOptions(w http.ResponseWriter, r *http.Request) {
	var req assertOptionsRequest
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("request body too large: max %d bytes", maxJSONBodyBytes))
			return
		}
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// The body is OPTIONAL (usernameless flow sends none) — only a present,
	// malformed body is a client error.
	if len(strings.TrimSpace(string(body))) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}

	var (
		assertion *protocol.CredentialAssertion
		session   *webauthn.SessionData
	)

	if email := strings.TrimSpace(req.Email); email != "" {
		user, err := h.store.UserByEmail(r.Context(), email)
		switch {
		case err == nil:
			creds, err := h.store.UserCredentials(r.Context(), user.ID)
			if err != nil {
				slog.Error("passkey assert options: load credentials failed", "error", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			if len(creds) > 0 {
				waUser := &passkeyWebAuthnUser{row: user, creds: toWebauthnCredentials(creds)}
				assertion, session, err = h.webAuthn.BeginLogin(waUser,
					webauthn.WithUserVerification(protocol.VerificationPreferred))
				if err != nil {
					slog.Error("passkey assert options: begin login failed", "error", err)
					writeError(w, http.StatusInternalServerError, "internal error")
					return
				}
			}
		case errors.Is(err, errPasskeyUserNotFound):
			// Fall through to the discoverable branch — indistinguishable
			// from "account exists but has no passkeys".
		default:
			slog.Error("passkey assert options: user lookup failed", "error", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	}

	if assertion == nil {
		var err error
		assertion, session, err = h.webAuthn.BeginDiscoverableLogin(
			webauthn.WithUserVerification(protocol.VerificationPreferred))
		if err != nil {
			slog.Error("passkey assert options: begin discoverable login failed", "error", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	}

	if err := h.saveSession(r.Context(), passkeyAssertionKey(session.Challenge), session); err != nil {
		slog.Error("passkey assert options: save ceremony state failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, passkeyUnavailableMsg)
		return
	}

	writeJSON(w, http.StatusOK, assertion)
}

// AssertVerify handles POST /api/v1/auth/passkeys/assert/verify (unauthed).
// Body: standard WebAuthn assertion credential JSON. Success: the same
// session/token response as password login.
func (h *PasskeyHandler) AssertVerify(w http.ResponseWriter, r *http.Request) {
	parsed, err := protocol.ParseCredentialRequestResponseBody(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid passkey assertion payload")
		return
	}

	// The signed clientDataJSON echoes the challenge we minted in
	// assert/options — that is the state lookup key. Take() burns it:
	// success, failure, or replay, this challenge is spent.
	session, err := h.takeSession(r.Context(), passkeyAssertionKey(parsed.Response.CollectedClientData.Challenge))
	if errors.Is(err, errPasskeySessionNotFound) {
		writeError(w, http.StatusUnauthorized, passkeyAssertFailedMsg)
		return
	}
	if err != nil {
		slog.Error("passkey assert verify: load ceremony state failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, passkeyUnavailableMsg)
		return
	}

	var (
		waUser *passkeyWebAuthnUser
		cred   *webauthn.Credential
	)

	if len(session.UserID) == 0 {
		// Discoverable (usernameless) ceremony: resolve the account from the
		// credential id + user handle the authenticator returned.
		handler := func(rawID, userHandle []byte) (webauthn.User, error) {
			userID := string(userHandle)
			if _, err := uuid.Parse(userID); err != nil {
				return nil, errPasskeyCredentialNotFound
			}
			ownerID, err := h.store.UserIDByCredentialID(r.Context(), rawID)
			if err != nil {
				return nil, err
			}
			if ownerID != userID {
				// Library re-checks handle vs WebAuthnID; reject early anyway.
				return nil, errPasskeyCredentialNotFound
			}
			u, err := h.loadWebAuthnUser(r.Context(), ownerID)
			if err != nil {
				return nil, err
			}
			return u, nil
		}

		resolved, waCred, err := h.webAuthn.ValidatePasskeyLogin(handler, *session, parsed)
		if err != nil {
			slog.Warn("passkey assert verify: discoverable validation failed", "error", err)
			writeError(w, http.StatusUnauthorized, passkeyAssertFailedMsg)
			return
		}
		var ok bool
		if waUser, ok = resolved.(*passkeyWebAuthnUser); !ok {
			slog.Error("passkey assert verify: unexpected user type from validation")
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		cred = waCred
	} else {
		// Email-scoped ceremony: the session already pins the account.
		user, err := h.loadWebAuthnUser(r.Context(), string(session.UserID))
		if err != nil {
			slog.Warn("passkey assert verify: session user unavailable", "error", err)
			writeError(w, http.StatusUnauthorized, passkeyAssertFailedMsg)
			return
		}
		waCred, err := h.webAuthn.ValidateLogin(user, *session, parsed)
		if err != nil {
			slog.Warn("passkey assert verify: validation failed", "error", err)
			writeError(w, http.StatusUnauthorized, passkeyAssertFailedMsg)
			return
		}
		waUser = user
		cred = waCred
	}

	// Sign-count regression ⇒ a second copy of this private key may exist.
	// Fail closed (authenticators that never increment report 0/0 and do not
	// trip this).
	if cred.Authenticator.CloneWarning {
		slog.Warn("passkey assert verify: sign count regression — possible cloned authenticator",
			"user_id", waUser.row.ID)
		writeError(w, http.StatusUnauthorized, passkeyAssertFailedMsg)
		return
	}

	if err := h.store.UpdateCredentialOnLogin(r.Context(), cred.ID,
		int64(cred.Authenticator.SignCount), int16(cred.Flags.MsgpByte())); err != nil {
		// Without the persisted counter the replay defense degrades — treat
		// as a hard failure rather than silently weakening it.
		slog.Error("passkey assert verify: persist sign count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Mint the session through the existing user-service surface (no proto
	// change): provider "passkey" keyed by our user id. The user row above
	// came from the verified credential, and that email belongs to an
	// existing live account — so this resolves or links, never creates.
	result, err := h.userClient.FindOrCreateByOAuth(r.Context(), &userv1.FindOrCreateByOAuthRequest{
		Provider:   "passkey",
		ProviderId: waUser.row.ID,
		Email:      waUser.row.Email,
		Name:       waUser.WebAuthnDisplayName(),
	})
	if err != nil {
		slog.Error("passkey assert verify: token mint failed", "error", err, "user_id", waUser.row.ID)
		writeGRPCError(w, err)
		return
	}

	slog.Info("passkey sign-in", "user_id", waUser.row.ID)
	h.auth.completeSessionLogin(w, r, result.GetUserId(), result.GetAccessToken(),
		result.GetRefreshToken(), result.GetAccessTokenExpiresAt())
}

// saveSession serializes ceremony state into the session store.
func (h *PasskeyHandler) saveSession(ctx context.Context, key string, session *webauthn.SessionData) error {
	data, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("marshal passkey session: %w", err)
	}
	return h.sessions.Save(ctx, key, data, passkeyCeremonyTTL)
}

// takeSession destructively loads ceremony state (single-use challenges).
func (h *PasskeyHandler) takeSession(ctx context.Context, key string) (*webauthn.SessionData, error) {
	data, err := h.sessions.Take(ctx, key)
	if err != nil {
		return nil, err
	}
	session := &webauthn.SessionData{}
	if err := json.Unmarshal(data, session); err != nil {
		return nil, fmt.Errorf("unmarshal passkey session: %w", err)
	}
	return session, nil
}
