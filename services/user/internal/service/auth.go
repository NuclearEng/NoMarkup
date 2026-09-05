package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// Argon2id parameters.
const (
	argonMemory      = 65536
	argonIterations  = 3
	argonParallelism = 4
	argonSaltLength  = 16
	argonKeyLength   = 32
)

// verificationTokenExpiry is the validity duration for email verification tokens.
const verificationTokenExpiry = 24 * time.Hour

// Auth implements authentication business logic.
type Auth struct {
	repo                  domain.UserRepository
	jwt                   *JWTManager
	verificationSecret    []byte
	skipEmailVerification bool
	// reuseGraceWindow is how recently a token may have been rotated for a
	// replay of it to be forgiven as a benign client race. See
	// defaultReuseGraceWindow.
	reuseGraceWindow time.Duration
}

// defaultReuseGraceWindow is the tolerance for the ONE legitimate way a client
// presents an already-rotated refresh token: it raced itself.
//
// Two real-world cases produce a replay with no attacker involved:
//  1. Concurrent refresh — two in-flight API calls both 401, both trigger a
//     refresh, and the loser presents a token the winner already spent.
//  2. Retry after a network timeout that actually succeeded — the client never
//     saw the new pair and retries with the old token.
//
// Both resolve within a couple of seconds of the rotation; neither is
// distinguishable from theft by inspection. Theft, by contrast, is a replay
// separated from the rotation by however long it took the attacker to exfiltrate
// and use the token — and the damaging case (attacker refreshes first, victim
// replays later) has the victim's replay arriving a full refresh-interval after
// the attacker's rotation, far outside any few-second window.
//
// So: forgive replays within the window, prosecute outside it. 30s is
// deliberately generous relative to the ~1s a client race actually needs,
// because the cost asymmetry runs the other way — a false positive logs a real
// user out of every device, while a false negative only delays detection to the
// victim's NEXT refresh, at which point the same check fires and still catches
// the thief. Widening the window cannot let an attacker keep a session
// indefinitely; it only costs one extra refresh cycle of exposure.
//
// Note the window is measured from rotated_at, not created_at, so a client that
// legitimately refreshes every 14 minutes never approaches it.
const defaultReuseGraceWindow = 30 * time.Second

// NewAuth creates a new Auth service. The verificationSecret is used to sign
// email verification tokens with HMAC-SHA256. It must not be empty. When
// skipEmailVerification is true, newly registered users are automatically
// marked as email-verified (useful when no email delivery service is configured).
func NewAuth(repo domain.UserRepository, jwt *JWTManager, verificationSecret string, skipEmailVerification bool) *Auth {
	return &Auth{
		repo:                  repo,
		jwt:                   jwt,
		verificationSecret:    []byte(verificationSecret),
		skipEmailVerification: skipEmailVerification,
		reuseGraceWindow:      defaultReuseGraceWindow,
	}
}

// Register creates a new user account and returns the user ID, token pair, and a
// verification token that should be sent to the user's email address.
func (a *Auth) Register(ctx context.Context, input domain.RegisterInput) (string, *domain.TokenPair, string, error) {
	hash, err := hashPassword(input.Password)
	if err != nil {
		return "", nil, "", fmt.Errorf("register user: %w", err)
	}

	user := &domain.User{
		Email:         input.Email,
		EmailVerified: a.skipEmailVerification,
		PasswordHash:  hash,
		DisplayName:   input.DisplayName,
		Roles:         input.Roles,
		Status:        "active",
		Timezone:      "America/Los_Angeles",
	}

	if err := a.repo.CreateUser(ctx, user); err != nil {
		return "", nil, "", fmt.Errorf("register user: %w", err)
	}

	pair, err := a.generateTokenPair(ctx, user, "", "", "", nil)
	if err != nil {
		return "", nil, "", fmt.Errorf("register user: %w", err)
	}

	verificationToken := a.GenerateVerificationToken(user.ID)

	slog.Info("user registered",
		"user_id", user.ID,
		"email", user.Email,
		"email_auto_verified", a.skipEmailVerification,
	)
	return user.ID, pair, verificationToken, nil
}

// Login authenticates a user and returns the user ID, token pair, whether MFA is
// required, and an MFA challenge token (non-empty only when MFA is required).
func (a *Auth) Login(ctx context.Context, input domain.LoginInput) (string, *domain.TokenPair, bool, string, error) {
	user, err := a.repo.GetUserByEmail(ctx, input.Email)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return "", nil, false, "", domain.ErrInvalidCredentials
		}
		return "", nil, false, "", fmt.Errorf("login user: %w", err)
	}

	switch user.Status {
	case "suspended":
		slog.WarnContext(ctx, "login rejected: account suspended", "user_id", user.ID, "email", user.Email)
		return "", nil, false, "", domain.ErrAccountSuspended
	case "banned":
		slog.WarnContext(ctx, "login rejected: account banned", "user_id", user.ID, "email", user.Email)
		return "", nil, false, "", domain.ErrAccountBanned
	case "deactivated":
		slog.WarnContext(ctx, "login rejected: account deactivated", "user_id", user.ID, "email", user.Email)
		return "", nil, false, "", domain.ErrAccountDeactivated
	}

	if !verifyPassword(input.Password, user.PasswordHash) {
		slog.WarnContext(ctx, "login rejected: invalid credentials", "email", user.Email)
		return "", nil, false, "", domain.ErrInvalidCredentials
	}

	if !user.EmailVerified {
		slog.WarnContext(ctx, "login rejected: email not verified", "user_id", user.ID, "email", user.Email)
		return "", nil, false, "", domain.ErrEmailNotVerified
	}

	if user.MFAEnabled {
		// MFA is required; issue a short-lived challenge token instead of auth tokens.
		challengeToken := a.GenerateMFAChallengeToken(user.ID)
		return user.ID, nil, true, challengeToken, nil
	}

	now := time.Now()
	if err := a.repo.UpdateLastLogin(ctx, user.ID, now); err != nil {
		slog.Warn("failed to update last login", "user_id", user.ID, "error", err)
	}

	pair, err := a.generateTokenPair(ctx, user, input.DeviceInfo, input.IPAddress, "", nil)
	if err != nil {
		return "", nil, false, "", fmt.Errorf("login user: %w", err)
	}

	slog.Info("user logged in", "user_id", user.ID, "email", user.Email)
	return user.ID, pair, false, "", nil
}

// FindOrCreateByOAuth authenticates a user via an OAuth provider. It follows this flow:
// 1. Look up user by OAuth provider + provider ID
// 2. If found, generate tokens and return
// 3. If not found, look up user by email
// 4. If email found, link the OAuth account and generate tokens
// 5. If no user at all, create a new user with OAuth and generate tokens
func (a *Auth) FindOrCreateByOAuth(ctx context.Context, input domain.OAuthInput) (string, *domain.TokenPair, bool, error) {
	// 1. Try to find user by OAuth provider + ID.
	user, err := a.repo.FindUserByOAuth(ctx, input.Provider, input.ProviderID)
	if err == nil {
		// Found existing OAuth-linked user.
		return a.finishOAuthLogin(ctx, user, input.Provider, false)
	}

	if !errors.Is(err, domain.ErrUserNotFound) {
		return "", nil, false, fmt.Errorf("oauth find or create: %w", err)
	}

	// 2. Not found by OAuth. Try to find by email.
	user, err = a.repo.GetUserByEmail(ctx, input.Email)
	if err == nil {
		// Email matches an existing user. Link OAuth account.
		if linkErr := a.repo.LinkOAuthAccount(ctx, user.ID, input.Provider, input.ProviderID, input.Email); linkErr != nil {
			return "", nil, false, fmt.Errorf("oauth link account: %w", linkErr)
		}

		return a.finishOAuthLogin(ctx, user, input.Provider, false)
	}

	if !errors.Is(err, domain.ErrUserNotFound) {
		return "", nil, false, fmt.Errorf("oauth find or create: %w", err)
	}

	// 3. No existing user. Create new user with OAuth.
	newUser := &domain.User{
		Email:         input.Email,
		EmailVerified: true, // OAuth providers verify email
		DisplayName:   input.Name,
		AvatarURL:     input.AvatarURL,
		Roles:         []string{"customer"},
		Status:        "active",
		Timezone:      "America/Los_Angeles",
	}

	if err := a.repo.CreateOAuthUser(ctx, newUser, input.Provider, input.ProviderID); err != nil {
		return "", nil, false, fmt.Errorf("oauth create user: %w", err)
	}

	pair, err := a.generateTokenPair(ctx, newUser, "oauth-"+input.Provider, "", "", nil)
	if err != nil {
		return "", nil, false, fmt.Errorf("oauth find or create: %w", err)
	}

	slog.Info("new user created via oauth", "user_id", newUser.ID, "provider", input.Provider)
	return newUser.ID, pair, true, nil
}

// MFARequiredError is returned by FindOrCreateByOAuth when an existing user
// has TOTP enabled. The gateway must issue a challenge, not a session.
type MFARequiredError struct {
	UserID    string
	Challenge string
}

func (e *MFARequiredError) Error() string {
	return "mfa required"
}

func (a *Auth) finishOAuthLogin(ctx context.Context, user *domain.User, provider string, isNew bool) (string, *domain.TokenPair, bool, error) {
	if user.MFAEnabled && provider != "passkey" {
		challenge := a.GenerateMFAChallengeToken(user.ID)
		return user.ID, nil, isNew, &MFARequiredError{UserID: user.ID, Challenge: challenge}
	}

	now := time.Now()
	if updateErr := a.repo.UpdateLastLogin(ctx, user.ID, now); updateErr != nil {
		slog.Warn("failed to update last login", "user_id", user.ID, "error", updateErr)
	}

	pair, err := a.generateTokenPair(ctx, user, "oauth-"+provider, "", "", nil)
	if err != nil {
		return "", nil, false, fmt.Errorf("oauth find or create: %w", err)
	}

	slog.Info("user logged in via oauth", "user_id", user.ID, "provider", provider)
	return user.ID, pair, isNew, nil
}

// RefreshToken validates a refresh token, rotates it, and returns a new token pair.
func (a *Auth) RefreshToken(ctx context.Context, rawToken string) (*domain.TokenPair, error) {
	tokenHash := HashToken(rawToken)

	stored, err := a.repo.GetRefreshToken(ctx, tokenHash)
	if err != nil {
		return nil, fmt.Errorf("refresh token: %w", err)
	}

	// Expiry is a cheap, side-effect-free reject; do it before the atomic
	// revoke so an expired token never consumes the single-use gate.
	if time.Now().After(stored.ExpiresAt) {
		return nil, fmt.Errorf("refresh token: %w", domain.ErrTokenExpired)
	}

	// Atomic single-use rotation gate. Instead of the racy check-then-revoke
	// (read RevokedAt == nil, then RevokeRefreshToken), we REVOKE FIRST and let
	// the database be the arbiter: the revoke UPDATE only matches a row whose
	// revoked_at IS NULL, so among N concurrent refreshes sharing one token,
	// exactly one observes rows-affected == 1 and is allowed to mint a new
	// pair. Every loser (already-revoked token, or a concurrent request that
	// won the race) sees rotated == false and is rejected with ErrTokenRevoked
	// (the gateway maps it to 401). This preserves the single-valid-refresh
	// happy path while making a leaked/forked token unusable more than once.
	rotated, err := a.repo.RotateRefreshTokenIfActive(ctx, tokenHash)
	if err != nil {
		return nil, fmt.Errorf("refresh token rotate old: %w", err)
	}
	if !rotated {
		// Losing the gate is not automatically theft. Classify it.
		return nil, a.classifyRefreshRejection(ctx, stored)
	}

	user, err := a.repo.GetUserByID(ctx, stored.UserID)
	if err != nil {
		return nil, fmt.Errorf("refresh token get user: %w", err)
	}

	// The successor inherits the lineage, so a later replay of ANY token in
	// this chain can revoke the whole chain including this new token.
	pair, err := a.generateTokenPair(ctx, user, stored.DeviceInfo, "", stored.FamilyID, &stored.ID)
	if err != nil {
		return nil, fmt.Errorf("refresh token: %w", err)
	}

	return pair, nil
}

// classifyRefreshRejection decides what a failed rotation gate MEANS, and acts
// on it. Every branch returns a 401-equivalent to the caller; they differ only
// in whether the token family survives, and in what ops sees.
//
// The three cases:
//
//	rotated_at IS NULL      The token was revoked by logout, password change or
//	                        admin action and never had a successor. Replaying it
//	                        is expected background noise, not evidence of
//	                        anything. Reject; family untouched.
//	rotated recently        Benign client race (see defaultReuseGraceWindow).
//	                        Reject the request; family untouched.
//	rotated long ago        Two parties hold the same token. Revoke the ENTIRE
//	                        family and alert.
func (a *Auth) classifyRefreshRejection(ctx context.Context, stored *domain.RefreshToken) error {
	// Re-read. `stored` was fetched BEFORE the atomic gate, so under a genuine
	// concurrent double-refresh our copy still shows rotated_at == NULL even
	// though the winning sibling has since stamped it. Without this re-read the
	// benign race would be misfiled as case 1 (and, worse, a real replay could
	// be misfiled the same way). The re-read is what makes the grace window
	// observable at all.
	current, err := a.repo.GetRefreshToken(ctx, stored.TokenHash)
	if err != nil {
		// Cannot classify. Fail closed on the SIGNAL (don't claim innocence)
		// but do not destroy sessions on incomplete evidence — a DB blip must
		// not log the fleet out.
		slog.ErrorContext(ctx, "refresh token: could not re-read token to classify rejection",
			"user_id", stored.UserID, "error", err)
		return fmt.Errorf("refresh token: %w", domain.ErrTokenRevoked)
	}

	if current.RotatedAt == nil {
		refreshTokenRevokedReplayTotal.Inc()
		slog.InfoContext(ctx, "refresh token rejected: revoked without rotation",
			"user_id", current.UserID,
			"token_id", current.ID,
			"device_info", current.DeviceInfo,
		)
		return fmt.Errorf("refresh token: %w", domain.ErrTokenRevoked)
	}

	sinceRotation := time.Since(*current.RotatedAt)
	if sinceRotation <= a.reuseGraceWindow {
		refreshTokenReplayGraceTotal.Inc()
		slog.InfoContext(ctx, "refresh token replay inside grace window: treating as benign client race",
			"user_id", current.UserID,
			"token_id", current.ID,
			"family_id", current.FamilyID,
			"since_rotation_ms", sinceRotation.Milliseconds(),
			"grace_window_ms", a.reuseGraceWindow.Milliseconds(),
		)
		return fmt.Errorf("refresh token: %w", domain.ErrTokenRevoked)
	}

	// Confirmed reuse. The token was spent long enough ago that no honest
	// client would still be holding it, yet somebody presented it. Either the
	// legitimate user or an attacker is replaying a stolen token — and we
	// cannot tell which of the two currently holds the live descendant. So kill
	// the lineage and force a re-authentication that requires the password.
	revokedCount, revokeErr := a.repo.RevokeRefreshTokenFamily(ctx, current.FamilyID)
	if revokeErr != nil {
		slog.ErrorContext(ctx, "refresh token reuse detected but family revocation FAILED",
			"user_id", current.UserID,
			"family_id", current.FamilyID,
			"error", revokeErr,
		)
		return fmt.Errorf("refresh token reuse: %w", revokeErr)
	}

	refreshTokenReuseTotal.Inc()
	refreshTokenFamilyRevokedTotal.Inc()
	refreshTokenFamilySessionsRevokedTotal.Add(float64(revokedCount))

	slog.ErrorContext(ctx, "refresh token reuse detected: revoked token family",
		"user_id", current.UserID,
		"token_id", current.ID,
		"family_id", current.FamilyID,
		"device_info", current.DeviceInfo,
		"since_rotation_seconds", int64(sinceRotation.Seconds()),
		"sessions_revoked", revokedCount,
		"security_event", "refresh_token_reuse",
	)

	return fmt.Errorf("refresh token: %w", domain.ErrRefreshTokenReuse)
}

// Logout revokes a refresh token.
func (a *Auth) Logout(ctx context.Context, rawToken string) error {
	tokenHash := HashToken(rawToken)
	if err := a.repo.RevokeRefreshToken(ctx, tokenHash); err != nil {
		return fmt.Errorf("logout: %w", err)
	}
	return nil
}

// VerifyEmail validates the HMAC-signed verification token and marks the user's
// email as verified if the signature and expiration check pass.
func (a *Auth) VerifyEmail(ctx context.Context, token string) (bool, error) {
	userID, err := a.ValidateVerificationToken(token)
	if err != nil {
		slog.Warn("email verification failed", "error", err)
		return false, fmt.Errorf("verify email: %w", err)
	}

	if err := a.repo.UpdateEmailVerified(ctx, userID, true); err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return false, nil
		}
		return false, fmt.Errorf("verify email: %w", err)
	}

	slog.Info("email verified", "user_id", userID)
	return true, nil
}

// ResendVerification looks up the user by email and generates a fresh verification token.
// Returns the user and token so the caller can dispatch the email. Returns an error if the
// user doesn't exist or is already verified.
func (a *Auth) ResendVerification(ctx context.Context, email string) (*domain.User, string, error) {
	user, err := a.repo.GetUserByEmail(ctx, email)
	if err != nil {
		return nil, "", fmt.Errorf("resend verification: %w", err)
	}

	if user.EmailVerified {
		return nil, "", fmt.Errorf("resend verification: email already verified")
	}

	token := a.GenerateVerificationToken(user.ID)
	slog.Info("verification token regenerated", "user_id", user.ID)
	return user, token, nil
}

// passwordResetTokenExpiry is the validity duration for password reset tokens.
// Shorter than email verification because a reset grants account access.
const passwordResetTokenExpiry = time.Hour

// resetTokenPurpose namespaces password-reset tokens so a token minted for one
// purpose (e.g. email verification) cannot be replayed against another.
const resetTokenPurpose = "pwreset"

// RequestPasswordReset looks up the user by email and, if found, mints a
// password-reset token to be emailed to them. It ALWAYS returns success
// (a possibly-empty token + nil error) so the caller can return an identical
// response regardless of whether the email exists — defeating account
// enumeration. The boolean reports whether a real user was matched.
func (a *Auth) RequestPasswordReset(ctx context.Context, email string) (*domain.User, string, bool, error) {
	email = strings.TrimSpace(email)
	user, err := a.repo.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			// Unknown email: no-op, but report success to the caller.
			slog.Info("password reset requested for unknown email")
			return nil, "", false, nil
		}
		return nil, "", false, fmt.Errorf("request password reset: %w", err)
	}

	token := a.GeneratePasswordResetToken(user.ID, user.PasswordHash)
	slog.Info("password reset token generated", "user_id", user.ID)
	return user, token, true, nil
}

// ResetPassword validates a password-reset token and, if valid, replaces the
// user's password hash. Returns ErrInvalidToken / ErrTokenExpired for an
// unverifiable token so the gateway can surface a clean 400 (never a 500).
// On success it revokes all existing refresh tokens so any sessions opened
// with the old (possibly compromised) password are invalidated.
func (a *Auth) ResetPassword(ctx context.Context, token, newPassword string) error {
	// The token's HMAC is bound to the user's CURRENT password hash (see
	// GeneratePasswordResetToken), so we must load that hash before we can
	// verify the token. Peek the embedded userID (structurally validated, but
	// NOT yet trusted — the binding+signature check below is the real gate),
	// fetch the user, then validate the full token against their live hash.
	peekedUserID, err := peekResetTokenUserID(token)
	if err != nil {
		slog.Warn("password reset failed: malformed token", "error", err)
		return fmt.Errorf("reset password: %w", err)
	}

	user, err := a.repo.GetUserByID(ctx, peekedUserID)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			// Don't leak existence; treat as an invalid token.
			slog.Warn("password reset failed: token user not found")
			return fmt.Errorf("reset password: %w", domain.ErrInvalidToken)
		}
		return fmt.Errorf("reset password: %w", err)
	}

	// Full validation, including the HMAC binding to the current password hash.
	// Once the password is changed below, this same token's HMAC will no longer
	// match the (new) hash, so the link is single-use and any other outstanding
	// reset links for this user are invalidated too.
	userID, err := a.ValidatePasswordResetToken(token, user.PasswordHash)
	if err != nil {
		slog.Warn("password reset failed: invalid token", "error", err)
		return fmt.Errorf("reset password: %w", err)
	}

	hash, err := hashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("reset password: %w", err)
	}

	if err := a.repo.UpdatePassword(ctx, userID, hash); err != nil {
		return fmt.Errorf("reset password: %w", err)
	}

	// Invalidate all existing sessions after a password change.
	if err := a.repo.RevokeAllUserTokens(ctx, userID); err != nil {
		slog.Warn("failed to revoke tokens after password reset", "user_id", userID, "error", err)
	}

	slog.Info("password reset completed", "user_id", userID)
	return nil
}

// ChangePassword performs an authenticated, self-service password change. It
// re-authenticates the caller by verifying their CURRENT password (the
// re-auth gate required by CLAUDE.md §6 — a stolen access token must not be
// enough to silently take over an account by changing its password), then
// replaces the hash and revokes every existing refresh token so all other
// sessions are invalidated. Returns ErrInvalidCredentials when the current
// password is wrong so the gateway can surface a clean 401/403.
func (a *Auth) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	user, err := a.repo.GetUserByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("change password: %w", err)
	}

	if !verifyPassword(currentPassword, user.PasswordHash) {
		slog.WarnContext(ctx, "change password rejected: current password mismatch", "user_id", userID)
		return fmt.Errorf("change password: %w", domain.ErrInvalidCredentials)
	}

	hash, err := hashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("change password: %w", err)
	}

	if err := a.repo.UpdatePassword(ctx, userID, hash); err != nil {
		return fmt.Errorf("change password: %w", err)
	}

	// Invalidate all existing sessions after a password change — same posture
	// as ResetPassword: a password change logs out every device.
	if err := a.repo.RevokeAllUserTokens(ctx, userID); err != nil {
		slog.Warn("failed to revoke tokens after password change", "user_id", userID, "error", err)
	}

	slog.Info("password changed", "user_id", userID)
	return nil
}

// passwordHashBinding derives a short, stable fingerprint of the user's current
// password hash. It is folded into the reset-token HMAC payload so the token is
// cryptographically bound to the password that was in effect when the token was
// minted. After a successful reset the stored password_hash changes, the
// fingerprint changes, and the old token's HMAC no longer verifies — making
// every reset link single-use and invalidating all outstanding links on any
// password change. We hash the hash (rather than embedding it) so the password
// hash itself never travels in the emailed link.
func passwordHashBinding(passwordHash string) string {
	sum := sha256.Sum256([]byte(passwordHash))
	// 8 bytes (64 bits) of the digest is ample to make collisions infeasible
	// for an attacker who cannot read the DB; it also keeps the token compact.
	return hex.EncodeToString(sum[:8])
}

// GeneratePasswordResetToken creates an HMAC-SHA256 signed token encoding the
// userID, a purpose tag, an expiration timestamp, and — folded into the signed
// payload — a binding to the user's CURRENT password hash. Purpose-namespaced
// so it is not interchangeable with a verification token; hash-bound so it
// self-invalidates after the first successful reset (see passwordHashBinding).
func (a *Auth) GeneratePasswordResetToken(userID, currentPasswordHash string) string {
	expiry := time.Now().Add(passwordResetTokenExpiry).Unix()
	binding := passwordHashBinding(currentPasswordHash)
	// The binding is part of the HMAC INPUT but is NOT carried in the token
	// itself — the validator recomputes it from the live password hash. This is
	// what makes a stale token fail after the password changes.
	payload := resetTokenPurpose + "." + userID + "." + strconv.FormatInt(expiry, 10)
	signed := payload + "." + binding

	mac := hmac.New(sha256.New, a.verificationSecret)
	mac.Write([]byte(signed))
	sig := hex.EncodeToString(mac.Sum(nil))

	raw := payload + "." + sig
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// peekResetTokenUserID extracts the embedded userID from a reset token after
// only structural + purpose checks — it does NOT verify the HMAC (which can't
// be checked without the user's current password hash). Callers MUST follow up
// with ValidatePasswordResetToken before trusting the token; the returned ID is
// only safe to use for the user lookup that yields that hash.
func peekResetTokenUserID(token string) (string, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return "", fmt.Errorf("peek password reset token: %w", domain.ErrInvalidToken)
	}
	parts := strings.SplitN(string(decoded), ".", 4)
	if len(parts) != 4 || parts[0] != resetTokenPurpose {
		return "", fmt.Errorf("peek password reset token: %w", domain.ErrInvalidToken)
	}
	if parts[1] == "" {
		return "", fmt.Errorf("peek password reset token: %w", domain.ErrInvalidToken)
	}
	return parts[1], nil
}

// ValidatePasswordResetToken validates the HMAC signature (which is bound to
// currentPasswordHash), purpose tag, and expiration. Returns the embedded
// userID if valid, else ErrInvalidToken or ErrTokenExpired. Pass the user's
// live password hash; once that hash changes the token no longer verifies,
// giving one-time-use semantics for free.
func (a *Auth) ValidatePasswordResetToken(token, currentPasswordHash string) (string, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return "", fmt.Errorf("validate password reset token: %w", domain.ErrInvalidToken)
	}

	parts := strings.SplitN(string(decoded), ".", 4)
	if len(parts) != 4 || parts[0] != resetTokenPurpose {
		return "", fmt.Errorf("validate password reset token: %w", domain.ErrInvalidToken)
	}

	purpose := parts[0]
	userID := parts[1]
	expiryStr := parts[2]
	providedSig := parts[3]

	binding := passwordHashBinding(currentPasswordHash)
	payload := purpose + "." + userID + "." + expiryStr
	signed := payload + "." + binding
	mac := hmac.New(sha256.New, a.verificationSecret)
	mac.Write([]byte(signed))
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(providedSig), []byte(expectedSig)) {
		return "", fmt.Errorf("validate password reset token: %w", domain.ErrInvalidToken)
	}

	expiry, err := strconv.ParseInt(expiryStr, 10, 64)
	if err != nil {
		return "", fmt.Errorf("validate password reset token: %w", domain.ErrInvalidToken)
	}
	if time.Now().Unix() > expiry {
		return "", fmt.Errorf("validate password reset token: %w", domain.ErrTokenExpired)
	}

	return userID, nil
}

// GenerateVerificationToken creates an HMAC-SHA256 signed token encoding the
// userID and an expiration timestamp (24 hours from now). The token format is:
//
//	base64url(userID + "." + expiryUnix + "." + hmacHex)
func (a *Auth) GenerateVerificationToken(userID string) string {
	expiry := time.Now().Add(verificationTokenExpiry).Unix()
	payload := userID + "." + strconv.FormatInt(expiry, 10)

	mac := hmac.New(sha256.New, a.verificationSecret)
	mac.Write([]byte(payload))
	sig := hex.EncodeToString(mac.Sum(nil))

	raw := payload + "." + sig
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// ValidateVerificationToken validates the HMAC signature and checks expiration.
// Returns the embedded userID if valid.
func (a *Auth) ValidateVerificationToken(token string) (string, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return "", fmt.Errorf("validate verification token: %w", domain.ErrInvalidToken)
	}

	parts := strings.SplitN(string(decoded), ".", 3)
	if len(parts) != 3 {
		return "", fmt.Errorf("validate verification token: %w", domain.ErrInvalidToken)
	}

	userID := parts[0]
	expiryStr := parts[1]
	providedSig := parts[2]

	// Verify HMAC signature.
	payload := userID + "." + expiryStr
	mac := hmac.New(sha256.New, a.verificationSecret)
	mac.Write([]byte(payload))
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(providedSig), []byte(expectedSig)) {
		return "", fmt.Errorf("validate verification token: %w", domain.ErrInvalidToken)
	}

	// Check expiration.
	expiry, err := strconv.ParseInt(expiryStr, 10, 64)
	if err != nil {
		return "", fmt.Errorf("validate verification token: %w", domain.ErrInvalidToken)
	}
	if time.Now().Unix() > expiry {
		return "", fmt.Errorf("validate verification token: %w", domain.ErrTokenExpired)
	}

	return userID, nil
}

// generateTokenPair creates a new access token + refresh token and stores the refresh token.
// generateTokenPair mints an access+refresh pair. familyID and parentID carry
// the session lineage: pass "" and nil to start a NEW family (a fresh
// login/register/OAuth/MFA completion), or the predecessor's family and id to
// extend an existing chain (rotation). A new family is minted by the database,
// so an empty familyID can never collide with an existing lineage.
func (a *Auth) generateTokenPair(
	ctx context.Context,
	user *domain.User,
	deviceInfo, ipAddress string,
	familyID string,
	parentID *string,
) (*domain.TokenPair, error) {
	accessToken, expiresAt, err := a.jwt.GenerateAccessToken(user.ID, user.Email, user.Roles)
	if err != nil {
		return nil, err
	}

	rawRefresh, refreshHash, err := GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	rt := &domain.RefreshToken{
		UserID:     user.ID,
		TokenHash:  refreshHash,
		DeviceInfo: deviceInfo,
		IPAddress:  net.ParseIP(ipAddress),
		ExpiresAt:  time.Now().Add(RefreshTokenExpiry()),
		FamilyID:   familyID,
		ParentID:   parentID,
	}
	if err := a.repo.CreateRefreshToken(ctx, rt); err != nil {
		return nil, err
	}

	return &domain.TokenPair{
		AccessToken:          accessToken,
		RefreshToken:         rawRefresh,
		AccessTokenExpiresAt: expiresAt,
	}, nil
}

// hashPassword hashes a password using argon2id.
func hashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}

	hash := argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLength)

	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory, argonIterations, argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

// verifyPassword checks a password against an argon2id hash string.
func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}

	var memory uint32
	var iterations uint32
	var parallelism uint8
	_, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism)
	if err != nil {
		return false
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}

	expectedHash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}

	hash := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(expectedHash)))
	return subtle.ConstantTimeCompare(hash, expectedHash) == 1
}
