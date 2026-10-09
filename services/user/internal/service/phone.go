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
	"strings"
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

	redisKeyPrefix       = "nomarkup:otp:"
	redisRateLimitPrefix = "nomarkup:otp_rate:"
	signupOTPUserPrefix  = "signup:"
	phoneOTPKeyPrefix    = "phone:"
	verifiedClaimTTL     = 10 * time.Minute
)

// e164Regex validates E.164 phone numbers: + followed by 1-15 digits.
var e164Regex = regexp.MustCompile(`^\+[1-9]\d{1,14}$`)

// otpRecord is the JSON structure stored in Redis for each pending OTP.
type otpRecord struct {
	CodeHash string `json:"code_hash"` // SHA-256 hex of the OTP code
	Attempts int    `json:"attempts"`  // failed verification count
	SentAt   int64  `json:"sent_at"`   // unix timestamp of when OTP was sent
	Phone    string `json:"phone,omitempty"`
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
	repo domain.UserRepository
	rdb  *redis.Client
	sms  SMSDelivery // nil = SMS delivery disabled (logs only)
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
//
// userID may be empty for anonymous signup: the OTP is then stored under
// nomarkup:otp:phone:{e164} so RegisterPhoneOnly can verify before CreateUser.
func (pv *PhoneVerification) SendPhoneOTP(ctx context.Context, userID, phoneNumber string) error {
	if phoneNumber == "" {
		return fmt.Errorf("send phone otp: %w", domain.ErrInvalidPhone)
	}

	// Validate E.164 format.
	if !e164Regex.MatchString(phoneNumber) {
		return fmt.Errorf("send phone otp: %w", domain.ErrInvalidPhone)
	}

	identity := otpIdentity(userID, phoneNumber)
	if identity == "" {
		return fmt.Errorf("send phone otp: user_id or phone is required")
	}

	now := time.Now()

	// Per-identity send rate limiting (phone-keyed for anonymous signup).
	if err := pv.checkSendRateLimit(ctx, identity, now); err != nil {
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
		Phone:    phoneNumber,
	}
	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("send phone otp: marshal record: %w", err)
	}

	otpKey := redisKeyPrefix + identity
	if err := pv.rdb.Set(ctx, otpKey, data, otpExpiry).Err(); err != nil {
		return fmt.Errorf("send phone otp: store otp: %w", err)
	}

	// Increment daily send counter (expires at midnight UTC).
	pv.incrementDailySendCount(ctx, identity, now)

	smsUserID := userID
	if smsUserID == "" {
		smsUserID = identity
	}

	// Deliver via SMS. dispatchSMS reads data["user_phone"], not "phone".
	if pv.sms != nil {
		_, smsErr := pv.sms.SendNotification(ctx, &notificationv1.SendNotificationRequest{
			UserId:           smsUserID,
			NotificationType: notificationv1.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED,
			Title:            "NoMarkup Verification Code",
			Body:             fmt.Sprintf("Your NoMarkup verification code is: %s. It expires in 5 minutes.", code),
			Channels:         []notificationv1.NotificationChannel{notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_SMS},
			Data: map[string]string{
				"user_phone": phoneNumber,
				"type":       "phone_verification",
			},
		})
		if smsErr != nil {
			// OTP stays in Redis so a retry after cooldown can resend it.
			slog.Error("send phone otp: SMS delivery failed",
				"user_id", smsUserID,
				"error", smsErr,
			)
			return fmt.Errorf("send phone otp: sms delivery failed: %w: %w", smsErr, domain.ErrServiceUnavailable)
		}
	} else {
		slog.Warn("send phone otp: SMS delivery not configured, OTP generated but not sent",
			"user_id", smsUserID,
			"phone", phoneNumber,
		)
	}

	slog.Info("phone OTP generated",
		"user_id", smsUserID,
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

	identity := otpIdentity(userID, "")
	otpKey := redisKeyPrefix + identity

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

	// Anonymous signup keys are not real user IDs. Leave a short-lived claim
	// so Register can persist users.phone + phone_verified after CreateUser.
	if isAnonymousOTPUser(userID) {
		phone := record.Phone
		if phone == "" {
			phone = anonymousOTPPhone(userID)
		}
		if phone != "" {
			if err := pv.rdb.Set(ctx, verifiedClaimKey(phone), "1", verifiedClaimTTL).Err(); err != nil {
				return fmt.Errorf("verify phone: store claim: %w", err)
			}
		}
		slog.Info("signup phone OTP consumed", "phone_key", identity)
		return nil
	}

	if record.Phone == "" {
		return fmt.Errorf("verify phone: %w", domain.ErrInvalidOTP)
	}
	if _, err := pv.repo.UpdateUser(ctx, userID, domain.UpdateUserInput{Phone: &record.Phone}); err != nil {
		return fmt.Errorf("verify phone: persist phone: %w", err)
	}

	if err := pv.repo.UpdatePhoneVerified(ctx, userID, true); err != nil {
		return fmt.Errorf("verify phone: %w", err)
	}

	slog.Info("phone verified", "user_id", userID)
	return nil
}

// ConsumeVerifiedPhoneClaim deletes a one-time signup claim written by
// VerifyPhone for an anonymous (phone-keyed) OTP. True means the phone was
// proven and the caller may persist users.phone + phone_verified.
func (pv *PhoneVerification) ConsumeVerifiedPhoneClaim(ctx context.Context, phone string) bool {
	if pv == nil || pv.rdb == nil || phone == "" {
		return false
	}
	n, err := pv.rdb.Del(ctx, verifiedClaimKey(phone)).Result()
	return err == nil && n > 0
}

// MarkPhoneVerified sets users.phone_verified after a consumed signup claim
// has been attached to a real user row.
func (pv *PhoneVerification) MarkPhoneVerified(ctx context.Context, userID string) error {
	if pv == nil || pv.repo == nil {
		return fmt.Errorf("mark phone verified: phone service not configured")
	}
	if err := pv.repo.UpdatePhoneVerified(ctx, userID, true); err != nil {
		return fmt.Errorf("mark phone verified: %w", err)
	}
	return nil
}

// otpIdentity is the Redis suffix for OTP + rate-limit keys.
// Authenticated callers use the user UUID. Anonymous signup uses phone:{e164}
// so send (empty user_id) and verify (user_id "phone:+E.164" or legacy
// "signup:+E.164") share one record.
func otpIdentity(userID, phone string) string {
	if p := anonymousOTPPhone(userID); p != "" {
		return phoneOTPKeyPrefix + p
	}
	if userID == "" && phone != "" {
		return phoneOTPKeyPrefix + phone
	}
	return userID
}

func isAnonymousOTPUser(userID string) bool {
	return userID == "" || strings.HasPrefix(userID, signupOTPUserPrefix) || strings.HasPrefix(userID, phoneOTPKeyPrefix)
}

func anonymousOTPPhone(userID string) string {
	switch {
	case strings.HasPrefix(userID, signupOTPUserPrefix):
		return strings.TrimPrefix(userID, signupOTPUserPrefix)
	case strings.HasPrefix(userID, phoneOTPKeyPrefix):
		return strings.TrimPrefix(userID, phoneOTPKeyPrefix)
	default:
		return ""
	}
}

func verifiedClaimKey(phone string) string {
	return redisKeyPrefix + "verified:" + phone
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
				return fmt.Errorf("send phone otp: please wait %d seconds before requesting another code: %w", int(retryAfter)+1, domain.ErrOTPRateLimited)
			}
		}
	}

	// Check daily send limit.
	dailyKey := redisRateLimitPrefix + userID + ":" + now.UTC().Format("2006-01-02")
	count, err := pv.rdb.Get(ctx, dailyKey).Int()
	if err != nil && err != redis.Nil {
		return fmt.Errorf("send phone otp: %w", domain.ErrServiceUnavailable)
	}
	if count >= maxDailySends {
		return fmt.Errorf("send phone otp: daily OTP limit reached: %w", domain.ErrOTPRateLimited)
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
