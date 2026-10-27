package handler

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nomarkup/nomarkup/pkg/appleauth"
)

// Sign in with Apple refresh-token capture (App Store Guideline 5.1.1(v)).
//
// At sign-in the gateway trades Apple's single-use authorization code for a
// refresh token and stores it ENCRYPTED on the user's oauth_accounts row
// (migration 136). The user service revokes it at
// https://appleid.apple.com/auth/revoke when the account is deleted.
// Capture is best-effort: a failure is logged and never blocks sign-in.

// appleCodeExchanger is the subset of *appleauth.Client used here.
type appleCodeExchanger interface {
	ExchangeCode(ctx context.Context, clientID, code, redirectURI string) (*appleauth.TokenResponse, error)
}

// AppleRefreshTokenSaver persists an Apple refresh token for (user, apple sub).
type AppleRefreshTokenSaver interface {
	SaveAppleRefreshToken(ctx context.Context, userID, appleSubject, clientID, refreshToken string) error
}

// stringEncrypter is satisfied by *gatewaycrypto.Cipher.
type stringEncrypter interface {
	EncryptString(plaintext string) (string, error)
}

// pgExecer is satisfied by *pgxpool.Pool.
type pgExecer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// PGAppleTokenStore writes the encrypted token to oauth_accounts.
type PGAppleTokenStore struct {
	DB     pgExecer
	Cipher stringEncrypter
}

// ErrAppleAccountNotLinked means no oauth_accounts row matched.
var ErrAppleAccountNotLinked = errors.New("apple oauth account row not found")

// SaveAppleRefreshToken encrypts and stores the token. Plaintext never hits SQL.
func (s *PGAppleTokenStore) SaveAppleRefreshToken(ctx context.Context, userID, appleSubject, clientID, refreshToken string) error {
	if s == nil || s.DB == nil || s.Cipher == nil {
		return errors.New("apple token store not configured")
	}
	enc, err := s.Cipher.EncryptString(refreshToken)
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(ctx, `
		UPDATE oauth_accounts
		   SET apple_refresh_token_enc = $1,
		       apple_token_client_id   = $2,
		       apple_token_updated_at  = now()
		 WHERE user_id = $3 AND provider = 'apple' AND provider_id = $4`,
		enc, clientID, userID, appleSubject)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrAppleAccountNotLinked
	}
	return nil
}

// WithAppleTokenCapture enables refresh-token capture. Either argument nil
// leaves capture disabled (sign-in still works).
func (h *OAuthHandler) WithAppleTokenCapture(exchanger appleCodeExchanger, saver AppleRefreshTokenSaver) *OAuthHandler {
	h.appleExchanger = exchanger
	h.appleTokenSaver = saver
	return h
}

// nativeAppleClientID is the client_id Apple issues native codes to: the app
// bundle ID (APPLE_NATIVE_CLIENT_ID), falling back to APPLE_CLIENT_ID.
func nativeAppleClientID() string {
	if v := strings.TrimSpace(os.Getenv("APPLE_NATIVE_CLIENT_ID")); v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv("APPLE_CLIENT_ID"))
}

// captureAppleRefreshToken exchanges code (if any) and stores the refresh
// token. Best-effort and bounded to 5s; errors are logged, never returned.
func (h *OAuthHandler) captureAppleRefreshToken(ctx context.Context, userID, appleSubject, clientID, code string) {
	code = strings.TrimSpace(code)
	if code == "" || userID == "" || appleSubject == "" {
		return
	}
	if h.appleExchanger == nil || h.appleTokenSaver == nil {
		slog.Warn("apple sign-in: refresh-token capture disabled; account deletion cannot revoke this Apple grant",
			"user_id", userID)
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	tr, err := h.appleExchanger.ExchangeCode(ctx, clientID, code, "")
	if err != nil {
		slog.Error("apple sign-in: authorization code exchange failed", "user_id", userID, "error", err)
		return
	}
	if err := h.appleTokenSaver.SaveAppleRefreshToken(ctx, userID, appleSubject, clientID, tr.RefreshToken); err != nil {
		slog.Error("apple sign-in: store refresh token failed", "user_id", userID, "error", err)
	}
}

// storeAppleWebRefreshToken stores the refresh token the web redirect flow
// already received from its own code exchange (client_id = APPLE_CLIENT_ID).
func (h *OAuthHandler) storeAppleWebRefreshToken(ctx context.Context, userID, appleSubject, refreshToken string) {
	if refreshToken == "" || userID == "" || appleSubject == "" || h.appleTokenSaver == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	clientID := strings.TrimSpace(os.Getenv("APPLE_CLIENT_ID"))
	if err := h.appleTokenSaver.SaveAppleRefreshToken(ctx, userID, appleSubject, clientID, refreshToken); err != nil {
		slog.Error("apple web sign-in: store refresh token failed", "user_id", userID, "error", err)
	}
}
