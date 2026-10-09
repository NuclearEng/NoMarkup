package handler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProjectLocalTermsJSON(t *testing.T) {
	t.Parallel()

	t.Run("extracts scalar local_terms", func(t *testing.T) {
		t.Parallel()
		raw := []byte(`{
			"local_terms": {
				"payment_timing": "milestone",
				"amount": "50000",
				"description": "half / half",
				"source": "chat_proposed_terms",
				"bound_at": "award",
				"accepted_by": "cust-1"
			},
			"other": "ignored"
		}`)
		got := projectLocalTermsJSON(raw)
		require.NotNil(t, got)
		assert.Equal(t, "milestone", got["payment_timing"])
		assert.Equal(t, "50000", got["amount"])
		assert.Equal(t, "half / half", got["description"])
		assert.Equal(t, "award", got["bound_at"])
		assert.NotContains(t, got, "other")
	})

	t.Run("drops nested objects and arrays", func(t *testing.T) {
		t.Parallel()
		raw := []byte(`{
			"local_terms": {
				"payment_timing": "upfront",
				"nested": {"x": 1},
				"list": [1, 2]
			}
		}`)
		got := projectLocalTermsJSON(raw)
		require.NotNil(t, got)
		assert.Equal(t, "upfront", got["payment_timing"])
		assert.NotContains(t, got, "nested")
		assert.NotContains(t, got, "list")
	})

	t.Run("nil when missing local_terms", func(t *testing.T) {
		t.Parallel()
		assert.Nil(t, projectLocalTermsJSON([]byte(`{}`)))
		assert.Nil(t, projectLocalTermsJSON([]byte(`{"local_terms":{}}`)))
		assert.Nil(t, projectLocalTermsJSON(nil))
		assert.Nil(t, projectLocalTermsJSON([]byte(`not-json`)))
	})

	t.Run("keeps bool and number scalars", func(t *testing.T) {
		t.Parallel()
		raw := []byte(`{"local_terms":{"explicit_consent":true,"amount_cents":100}}`)
		got := projectLocalTermsJSON(raw)
		require.NotNil(t, got)
		assert.Equal(t, true, got["explicit_consent"])
		assert.Equal(t, float64(100), got["amount_cents"])
	})
}

func TestLocalTermsByContract_NilDB(t *testing.T) {
	t.Parallel()
	h := &ContractHandler{}
	assert.Nil(t, h.localTermsByContract(context.Background(), "any-id"))
	assert.Nil(t, h.localTermsByContract(context.Background(), ""))
}
