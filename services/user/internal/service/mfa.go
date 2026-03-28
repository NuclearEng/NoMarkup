package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/pquerna/otp/totp"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

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
// so they can be hashed and stored.
func (a *Auth) VerifyAndEnableMFA(ctx context.Context, userID, code string, backupCodes []string) error {
	secret, err := a.repo.GetMFASecret(ctx, userID)
	if err != nil {
		return fmt.Errorf("verify and enable mfa: %w", err)
	}

	if !totp.Validate(code, secret) {
		return fmt.Errorf("verify and enable mfa: %w", domain.ErrInvalidMFACode)
	}

	// Hash backup codes before storing.
	hashedCodes := make([]string, len(backupCodes))
	for i, bc := range backupCodes {
		h := sha256.Sum256([]byte(bc))
		hashedCodes[i] = hex.EncodeToString(h[:])
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
// for the given user.
func (a *Auth) ValidateMFACode(ctx context.Context, userID, code string) (bool, error) {
	secret, err := a.repo.GetMFASecret(ctx, userID)
	if err != nil {
		return false, fmt.Errorf("validate mfa code: %w", err)
	}

	if totp.Validate(code, secret) {
		return true, nil
	}

	// Check backup codes — a backup code is a hex string (8 chars).
	// We match against hashed backup codes stored in the DB.
	user, err := a.repo.GetUserByID(ctx, userID)
	if err != nil {
		return false, fmt.Errorf("validate mfa code: %w", err)
	}

	codeHash := sha256.Sum256([]byte(code))
	codeHashHex := hex.EncodeToString(codeHash[:])
	for _, stored := range user.MFABackupCodes {
		if stored == codeHashHex {
			return true, nil
		}
	}

	return false, nil
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
