package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOTPIdentity(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		userID string
		phone  string
		want   string
	}{
		{name: "authenticated uuid", userID: "user-uuid", phone: "+15551234567", want: "user-uuid"},
		{name: "empty user uses phone key", userID: "", phone: "+15551234567", want: "phone:+15551234567"},
		{name: "legacy signup prefix", userID: "signup:+15551234567", phone: "", want: "phone:+15551234567"},
		{name: "phone prefix", userID: "phone:+15551234567", phone: "", want: "phone:+15551234567"},
		{name: "signup prefix wins over phone arg", userID: "signup:+15550001111", phone: "+15551234567", want: "phone:+15550001111"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, otpIdentity(tt.userID, tt.phone))
		})
	}
}

func TestAnonymousOTPPhone(t *testing.T) {
	t.Parallel()
	assert.Equal(t, "+15551234567", anonymousOTPPhone("phone:+15551234567"))
	assert.Equal(t, "+15551234567", anonymousOTPPhone("signup:+15551234567"))
	assert.Equal(t, "", anonymousOTPPhone("user-uuid"))
	assert.True(t, isAnonymousOTPUser("phone:+15551234567"))
	assert.True(t, isAnonymousOTPUser("signup:+15551234567"))
	assert.True(t, isAnonymousOTPUser(""))
	assert.False(t, isAnonymousOTPUser("user-uuid"))
}

func TestVerifiedClaimKey(t *testing.T) {
	t.Parallel()
	assert.Equal(t, "nomarkup:otp:verified:+15551234567", verifiedClaimKey("+15551234567"))
}
