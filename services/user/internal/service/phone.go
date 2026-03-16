package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"regexp"
	"time"

	"github.com/redis/go-redis/v9"
	grpclib "google.golang.org/grpc"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

const (
	otpLength      = 6
	otpExpiry      = 5 * time.Minute
	maxOTPAttempts = 5                // max failed verifications before lockout
	otpCooldown    = 60 * time.Second // min interval between OTP sends per user
	maxDailySends  = 10               // max OTPs a user can request per 24h

	redisKeyPrefix      = "nomarkup:otp:"
	redisRateLimitPrefix = "nomarkup:otp_rate:"
)

// e164Regex validates E.164 phone numbers: + followed by 1-15 digits.
var e164Regex = regexp.MustCompile(`^\+[1-9]\d{1,14}$`)

// otpRecord is the JSON structure stored in Redis for each pending OTP.
type otpRecord struct {
	CodeHash string `json:"code_hash"` // SHA-256 hex of the OTP code
	Attempts int    `json:"attempts"`  // failed verification count
	SentAt   int64  `json:"sent_at"`   // unix timestamp of when OTP was sent
}

// SMSDelivery defines the interface for sending SMS messages.
// Satisfied by the notification service gRPC client.
type SMSDelivery interface {
	SendNotification(ctx context.Context, req *notificationv1.SendNotificationRequest, opts ...grpclib.CallOption) (*notificationv1.SendNotificationResponse, error)
}

// PhoneVerification implements phone number verification via OTP.
// Uses Redis for storage (survives restarts, works across instances)
// and the notification service for SMS delivery.
type PhoneVerification struct {
	repo  domain.UserRepository
	rdb   *redis.Client
	sms   SMSDelivery // nil = SMS delivery disabled (logs only)
}

// NewPhoneVerification creates a new PhoneVerification service.
// rdb must not be nil — Redis is required for production OTP storage.
// sms may be nil during development (OTP is logged but not delivered).
func NewPhoneVerification(repo domain.UserRepository, rdb *redis.Client, sms SMSDelivery) *PhoneVerification {
	return &PhoneVerification{
		repo: repo,
		rdb:  rdb,
		sms:  sms,
	}
}

// SendPhoneOTP generates a 6-digit OTP, stores its hash in Redis with TTL,
// and delivers it via SMS through the notification service.
func (pv *PhoneVerification) SendPhoneOTP(ctx context.Context, userID, phoneNumber string) error {
	if userID == "" {
		return fmt.Errorf("send phone otp: user_id is required")
	}
	if phoneNumber == "" {
		return fmt.Errorf("send phone otp: phone number is required")
	}

	// Validate E.164 format.
	if !e164Regex.MatchString(phoneNumber) {
		return fmt.Errorf("send phone otp: phone number must be in E.164 format (e.g. +12065551234)")
	}

	now := time.Now()

	// Per-user send rate limiting.
	if err := pv.checkSendRateLimit(ctx, userID, now); err != nil {
		return err
	}

	// Generate cryptographically random OTP.
	code, err := generateOTP(otpLength)
	if err != nil {
		return fmt.Errorf("send phone otp: %w", err)
	}

	// Store hashed OTP in Redis with auto-expiry.
	record := otpRecord{
		CodeHash: hashOTP(code),
		Attempts: 0,
		SentAt:   now.Unix(),
	}
	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("send phone otp: marshal record: %w", err)
	}

	otpKey := redisKeyPrefix + userID
	if err := pv.rdb.Set(ctx, otpKey, data, otpExpiry).Err(); err != nil {
		return fmt.Errorf("send phone otp: store otp: %w", err)
	}

	// Increment daily send counter (expires at midnight UTC).
	pv.incrementDailySendCount(ctx, userID, now)

	// Deliver via SMS.
	if pv.sms != nil {
		_, smsErr := pv.sms.SendNotification(ctx, &notificationv1.SendNotificationRequest{
			UserId:           userID,
			NotificationType: notificationv1.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED,
			Title:            "NoMarkup Verification Code",
			Body:             fmt.Sprintf("Your NoMarkup verification code is: %s. It expires in 5 minutes.", code),
			Channels:         []notificationv1.NotificationChannel{notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_SMS},
			Data: map[string]string{
				"phone": phoneNumber,
				"type":  "phone_verification",
			},
		})
		if smsErr != nil {
			// Log but don't fail — the OTP is stored, user can retry delivery.
			slog.Error("send phone otp: SMS delivery failed",
				"user_id", userID,
				"error", smsErr,
			)
		}
	} else {
		slog.Warn("send phone otp: SMS delivery not configured, OTP generated but not sent",
			"user_id", userID,
			"phone", phoneNumber,
		)
	}

	slog.Info("phone OTP generated",
		"user_id", userID,
	)

	return nil
}

// VerifyPhone validates the OTP code and marks the phone as verified.
func (pv *PhoneVerification) VerifyPhone(ctx context.Context, userID, otp string) error {
	if userID == "" {
		return fmt.Errorf("verify phone: user_id is required")
	}
	if otp == "" {
		return fmt.Errorf("verify phone: %w", domain.ErrInvalidOTP)
	}
	// Reject obviously invalid input (must be exactly 6 digits).
	if len(otp) != otpLength {
		return fmt.Errorf("verify phone: %w", domain.ErrInvalidOTP)
	}

	otpKey := redisKeyPrefix + userID

	// Fetch the stored record from Redis.
	data, err := pv.rdb.Get(ctx, otpKey).Bytes()
	if err == redis.Nil {
		return fmt.Errorf("verify phone: %w", domain.ErrInvalidOTP)
	}
	if err != nil {
		return fmt.Errorf("verify phone: read otp: %w", err)
	}

	var record otpRecord
	if err := json.Unmarshal(data, &record); err != nil {
		// Corrupted record — delete and fail.
		pv.rdb.Del(ctx, otpKey)
		return fmt.Errorf("verify phone: %w", domain.ErrInvalidOTP)
	}

	// Check brute-force lockout.
	if record.Attempts >= maxOTPAttempts {
		pv.rdb.Del(ctx, otpKey)
		slog.Warn("OTP max attempts exceeded, code invalidated", "user_id", userID)
		return fmt.Errorf("verify phone: too many failed attempts, request a new code")
	}

	// Constant-time comparison of hashed OTP.
	inputHash := hashOTP(otp)
	if subtle.ConstantTimeCompare([]byte(record.CodeHash), []byte(inputHash)) != 1 {
		// Wrong code — increment attempt counter.
		record.Attempts++
		if updated, err := json.Marshal(record); err == nil {
			// Preserve the remaining TTL.
			ttl, _ := pv.rdb.TTL(ctx, otpKey).Result()
			if ttl > 0 {
				pv.rdb.Set(ctx, otpKey, updated, ttl)
			}
		}
		slog.Info("OTP verification failed",
			"user_id", userID,
			"attempt", record.Attempts,
		)
		return fmt.Errorf("verify phone: %w", domain.ErrInvalidOTP)
	}

	// Success — delete the OTP record.
	pv.rdb.Del(ctx, otpKey)

	if err := pv.repo.UpdatePhoneVerified(ctx, userID, true); err != nil {
		return fmt.Errorf("verify phone: %w", err)
	}

	slog.Info("phone verified", "user_id", userID)
	return nil
}

// checkSendRateLimit enforces per-user cooldown and daily send limits.
func (pv *PhoneVerification) checkSendRateLimit(ctx context.Context, userID string, now time.Time) error {
	// Check per-send cooldown: is there a recent OTP that hasn't cooled down?
	otpKey := redisKeyPrefix + userID
	data, err := pv.rdb.Get(ctx, otpKey).Bytes()
	if err == nil {
		var record otpRecord
		if json.Unmarshal(data, &record) == nil {
			sentAt := time.Unix(record.SentAt, 0)
			if now.Before(sentAt.Add(otpCooldown)) {
				retryAfter := sentAt.Add(otpCooldown).Sub(now).Seconds()
				return fmt.Errorf("send phone otp: please wait %d seconds before requesting another code", int(retryAfter)+1)
			}
		}
	}

	// Check daily send limit.
	dailyKey := redisRateLimitPrefix + userID + ":" + now.UTC().Format("2006-01-02")
	count, err := pv.rdb.Get(ctx, dailyKey).Int()
	if err != nil && err != redis.Nil {
		// Redis error — fail open with a warning.
		slog.Warn("send phone otp: failed to check daily rate limit", "error", err)
		return nil
	}
	if count >= maxDailySends {
		return fmt.Errorf("send phone otp: daily OTP limit reached, try again tomorrow")
	}

	return nil
}

// incrementDailySendCount tracks how many OTPs a user has requested today.
func (pv *PhoneVerification) incrementDailySendCount(ctx context.Context, userID string, now time.Time) {
	dailyKey := redisRateLimitPrefix + userID + ":" + now.UTC().Format("2006-01-02")
	pipe := pv.rdb.Pipeline()
	pipe.Incr(ctx, dailyKey)
	// Expire at end of UTC day + 1 hour buffer.
	endOfDay := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day()+1, 1, 0, 0, 0, time.UTC)
	pipe.ExpireAt(ctx, dailyKey, endOfDay)
	if _, err := pipe.Exec(ctx); err != nil {
		slog.Warn("send phone otp: failed to increment daily counter", "error", err)
	}
}

// hashOTP returns the hex-encoded SHA-256 hash of an OTP code.
// We store hashes rather than plaintext so that a Redis compromise
// doesn't directly expose valid OTP codes.
func hashOTP(code string) string {
	h := sha256.Sum256([]byte(code))
	return hex.EncodeToString(h[:])
}

// generateOTP creates a cryptographically random numeric OTP of the given length.
func generateOTP(length int) (string, error) {
	digits := make([]byte, length)
	for i := range digits {
		n, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", fmt.Errorf("generate otp: %w", err)
		}
		digits[i] = byte('0') + byte(n.Int64())
	}
	return string(digits), nil
}
