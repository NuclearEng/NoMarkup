package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/argon2"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// argon2idHashBackupCode produces an encoded argon2id digest for a single
// MFA backup code. The encoding is "argon2id$<saltB64>$<hashB64>" using
// fixed parameters (memory=65536, iterations=3, parallelism=4) which match
// CLAUDE.md §6 password-hashing guidance. Backup codes are short hex strings
// (32 bits of entropy) and only need to resist brute-force from someone who
// already has the database — argon2id with these parameters takes ~50ms per
// guess, which is sufficient given the codes are also rate-limited at the
// service layer.
func argon2idHashBackupCode(code string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate argon2id salt: %w", err)
	}
	hash := argon2.IDKey([]byte(code), salt, 3, 64*1024, 4, 32)
	return fmt.Sprintf("argon2id$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

// verifyArgon2idBackupCode returns true when code matches the encoded hash
// using a constant-time compare. Hashes that don't have the expected
// argon2id$ prefix (legacy SHA-256 hex digests) fall back to a sha256-vs-hex
// compare so users mid-rotation can still log in. New writes always use
// argon2id.
func verifyArgon2idBackupCode(code, encoded string) bool {
	if !strings.HasPrefix(encoded, "argon2id$") {
		// Legacy sha256 hex digest — kept for backwards compatibility until
		// users re-enable MFA.
		h := sha256.Sum256([]byte(code))
		want := hex.EncodeToString(h[:])
		return subtle.ConstantTimeCompare([]byte(want), []byte(encoded)) == 1
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 3 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(code), salt, 3, 64*1024, 4, uint32(len(want)))
	return subtle.ConstantTimeCompare(want, got) == 1
}

// mfaChallengeTokenExpiry is how long the MFA challenge token remains valid after
// the user supplies correct credentials. This gives them time to enter the TOTP code.
const mfaChallengeTokenExpiry = 5 * time.Minute

// GenerateMFASetup creates a new TOTP secret and backup codes for a user.
// MFA is NOT enabled at this point; the caller must verify with VerifyAndEnableMFA first.
func (a *Auth) GenerateMFASetup(ctx context.Context, userID string) (secret string, qrURL string, backupCodes []string, err error) {
	// Check if MFA is already enabled.
	enabled, err := a.repo.IsMFAEnabled(ctx, userID)
	if err != nil {
		return "", "", nil, fmt.Errorf("generate mfa setup: %w", err)
	}
	if enabled {
		return "", "", nil, fmt.Errorf("generate mfa setup: %w", domain.ErrMFAAlreadyEnabled)
	}

	// Fetch user email for the TOTP account name.
	user, err := a.repo.GetUserByID(ctx, userID)
	if err != nil {
		return "", "", nil, fmt.Errorf("generate mfa setup: %w", err)
	}

	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "NoMarkup",
		AccountName: user.Email,
		Period:      30,
		Digits:      6,
	})
	if err != nil {
		return "", "", nil, fmt.Errorf("generate totp key: %w", err)
	}

	// Generate 10 backup codes (8 hex chars each).
	backupCodes = make([]string, 10)
	for i := range backupCodes {
		code := make([]byte, 4)
		if _, err := rand.Read(code); err != nil {
			return "", "", nil, fmt.Errorf("generate backup code: %w", err)
		}
		backupCodes[i] = fmt.Sprintf("%08x", code)
	}

	// Store the TOTP secret (not yet enabled).
	if err := a.repo.StoreMFASecret(ctx, userID, key.Secret()); err != nil {
		return "", "", nil, fmt.Errorf("generate mfa setup: %w", err)
	}

	slog.Info("mfa setup initiated", "user_id", userID)
	return key.Secret(), key.URL(), backupCodes, nil
}

// VerifyAndEnableMFA validates the TOTP code and enables MFA for the user.
// The backup codes must be provided (the same ones returned from GenerateMFASetup)
// so they can be hashed and stored. Hashes use argon2id (one-way) rather than
// encrypted, per CLAUDE.md §6 — backup codes are user secrets, not data we
// ever need to recover.
func (a *Auth) VerifyAndEnableMFA(ctx context.Context, userID, code string, backupCodes []string) error {
	secret, err := a.repo.GetMFASecret(ctx, userID)
	if err != nil {
		return fmt.Errorf("verify and enable mfa: %w", err)
	}

	if !totp.Validate(code, secret) {
		return fmt.Errorf("verify and enable mfa: %w", domain.ErrInvalidMFACode)
	}

	hashedCodes := make([]string, len(backupCodes))
	for i, bc := range backupCodes {
		hashed, err := argon2idHashBackupCode(bc)
		if err != nil {
			return fmt.Errorf("verify and enable mfa: hash backup code: %w", err)
		}
		hashedCodes[i] = hashed
	}

	if err := a.repo.EnableMFA(ctx, userID, hashedCodes); err != nil {
		return fmt.Errorf("verify and enable mfa: %w", err)
	}

	slog.Info("mfa enabled", "user_id", userID)
	return nil
}

// DisableMFA validates the current TOTP code and disables MFA for the user.
func (a *Auth) DisableMFA(ctx context.Context, userID, code string) error {
	secret, err := a.repo.GetMFASecret(ctx, userID)
	if err != nil {
		return fmt.Errorf("disable mfa: %w", err)
	}

	if !totp.Validate(code, secret) {
		return fmt.Errorf("disable mfa: %w", domain.ErrInvalidMFACode)
	}

	if err := a.repo.DisableMFA(ctx, userID); err != nil {
		return fmt.Errorf("disable mfa: %w", err)
	}

	slog.Info("mfa disabled", "user_id", userID)
	return nil
}

// ValidateMFACode checks whether the provided TOTP code (or backup code) is valid
// for the given user. When a backup code matches it is consumed (one-time use)
// by re-saving the user's backup-code list with the matched hash removed.
func (a *Auth) ValidateMFACode(ctx context.Context, userID, code string) (bool, error) {
	secret, err := a.repo.GetMFASecret(ctx, userID)
	if err != nil {
		return false, fmt.Errorf("validate mfa code: %w", err)
	}

	if totp.Validate(code, secret) {
		return true, nil
	}

	user, err := a.repo.GetUserByID(ctx, userID)
	if err != nil {
		return false, fmt.Errorf("validate mfa code: %w", err)
	}

	matchIdx := -1
	for i, stored := range user.MFABackupCodes {
		if verifyArgon2idBackupCode(code, stored) {
			matchIdx = i
			break
		}
	}
	if matchIdx == -1 {
		return false, nil
	}

	// Consume the matched code so it can't be reused.
	remaining := make([]string, 0, len(user.MFABackupCodes)-1)
	remaining = append(remaining, user.MFABackupCodes[:matchIdx]...)
	remaining = append(remaining, user.MFABackupCodes[matchIdx+1:]...)
	if err := a.repo.EnableMFA(ctx, userID, remaining); err != nil {
		// Log but still allow login — the security cost of allowing a
		// reused backup code is bounded (admin-revocable, requires
		// possession of the code), and the alternative would be to
		// reject a valid login on a transient DB blip.
		slog.Error("failed to consume backup code", "user_id", userID, "error", err)
	}
	return true, nil
}

// GenerateMFAChallengeToken creates an HMAC-signed token that encodes the user ID
// and an expiration. This token is returned during login when MFA is required,
// allowing the user to complete MFA verification without re-authenticating.
func (a *Auth) GenerateMFAChallengeToken(userID string) string {
	expiry := time.Now().Add(mfaChallengeTokenExpiry).Unix()
	payload := "mfa:" + userID + "." + strconv.FormatInt(expiry, 10)

	mac := hmac.New(sha256.New, a.verificationSecret)
	mac.Write([]byte(payload))
	sig := hex.EncodeToString(mac.Sum(nil))

	raw := payload + "." + sig
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// ValidateMFAChallengeToken validates the HMAC signature and expiration of an MFA
// challenge token. Returns the embedded user ID if valid.
func (a *Auth) ValidateMFAChallengeToken(token string) (string, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return "", fmt.Errorf("validate mfa challenge token: %w", domain.ErrInvalidMFAChallengeToken)
	}

	parts := strings.SplitN(string(decoded), ".", 3)
	if len(parts) != 3 {
		return "", fmt.Errorf("validate mfa challenge token: %w", domain.ErrInvalidMFAChallengeToken)
	}

	payloadPart := parts[0] // "mfa:<userID>"
	expiryStr := parts[1]
	providedSig := parts[2]

	if !strings.HasPrefix(payloadPart, "mfa:") {
		return "", fmt.Errorf("validate mfa challenge token: %w", domain.ErrInvalidMFAChallengeToken)
	}
	userID := strings.TrimPrefix(payloadPart, "mfa:")

	// Verify HMAC signature.
	fullPayload := payloadPart + "." + expiryStr
	mac := hmac.New(sha256.New, a.verificationSecret)
	mac.Write([]byte(fullPayload))
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(providedSig), []byte(expectedSig)) {
		return "", fmt.Errorf("validate mfa challenge token: %w", domain.ErrInvalidMFAChallengeToken)
	}

	expiry, err := strconv.ParseInt(expiryStr, 10, 64)
	if err != nil {
		return "", fmt.Errorf("validate mfa challenge token: %w", domain.ErrInvalidMFAChallengeToken)
	}
	if time.Now().Unix() > expiry {
		return "", fmt.Errorf("validate mfa challenge token: %w", domain.ErrTokenExpired)
	}

	return userID, nil
}

// CompleteMFALogin validates the MFA code via the challenge token and issues tokens.
func (a *Auth) CompleteMFALogin(ctx context.Context, challengeToken, totpCode, deviceInfo, ipAddress string) (string, *domain.TokenPair, error) {
	userID, err := a.ValidateMFAChallengeToken(challengeToken)
	if err != nil {
		return "", nil, fmt.Errorf("complete mfa login: %w", err)
	}

	valid, err := a.ValidateMFACode(ctx, userID, totpCode)
	if err != nil {
		return "", nil, fmt.Errorf("complete mfa login: %w", err)
	}
	if !valid {
		return "", nil, fmt.Errorf("complete mfa login: %w", domain.ErrInvalidMFACode)
	}

	user, err := a.repo.GetUserByID(ctx, userID)
	if err != nil {
		return "", nil, fmt.Errorf("complete mfa login: %w", err)
	}

	now := time.Now()
	if err := a.repo.UpdateLastLogin(ctx, userID, now); err != nil {
		slog.Warn("failed to update last login after mfa", "user_id", userID, "error", err)
	}

	pair, err := a.generateTokenPair(ctx, user, deviceInfo, ipAddress)
	if err != nil {
		return "", nil, fmt.Errorf("complete mfa login: %w", err)
	}

	slog.Info("user logged in via mfa", "user_id", userID, "email", user.Email)
	return userID, pair, nil
}
