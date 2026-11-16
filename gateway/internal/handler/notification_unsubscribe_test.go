package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReadUnsubscribeToken(t *testing.T) {
	t.Parallel()

	t.Run("json body without query", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/notifications/unsubscribe", strings.NewReader(`{"token":"abc"}`))
		req.Header.Set("Content-Type", "application/json")
		got, err := readUnsubscribeToken(req)
		require.NoError(t, err)
		assert.Equal(t, "abc", got)
	})

	// Query wins: a JSON body is not read when ?token= is set.
	t.Run("query wins over json body", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/notifications/unsubscribe?token=q", strings.NewReader(`{"token":"abc"}`))
		req.Header.Set("Content-Type", "application/json")
		got, err := readUnsubscribeToken(req)
		require.NoError(t, err)
		assert.Equal(t, "q", got)
	})

	// RFC 8058 one-click POST: token stays on the query string.
	t.Run("one click form body uses query token", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(
			http.MethodPost,
			"/api/v1/notifications/unsubscribe?token=q",
			strings.NewReader("List-Unsubscribe=One-Click"),
		)
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		got, err := readUnsubscribeToken(req)
		require.NoError(t, err)
		assert.Equal(t, "q", got)
	})

	t.Run("form field token", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/notifications/unsubscribe", strings.NewReader("token=tok-test"))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		got, err := readUnsubscribeToken(req)
		require.NoError(t, err)
		assert.Equal(t, "tok-test", got)
	})

	t.Run("empty", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/notifications/unsubscribe", nil)
		_, err := readUnsubscribeToken(req)
		require.Error(t, err)
	})
}
