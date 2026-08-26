package grpc

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPhoneFromSyntheticEmail(t *testing.T) {
	t.Parallel()

	phone, ok := phoneFromSyntheticEmail("+15551234567@phone.nomarkup")
	assert.True(t, ok)
	assert.Equal(t, "+15551234567", phone)

	_, ok = phoneFromSyntheticEmail("user@example.com")
	assert.False(t, ok)

	_, ok = phoneFromSyntheticEmail("not-a-phone@phone.nomarkup")
	assert.False(t, ok)

	_, ok = phoneFromSyntheticEmail("")
	assert.False(t, ok)
}
