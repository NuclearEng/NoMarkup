package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
)

func TestParseInstantScheduleJSON(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		raw  string
		want []map[string]interface{}
	}{
		{
			name: "empty raw",
			raw:  "",
			want: []map[string]interface{}{},
		},
		{
			name: "json null",
			raw:  "null",
			want: []map[string]interface{}{},
		},
		{
			name: "empty array",
			raw:  "[]",
			want: []map[string]interface{}{},
		},
		{
			name: "valid windows from SetInstantAvailability marshal",
			raw:  `[{"day":"mon","start_time":"09:00","end_time":"17:00"},{"day":"fri","start_time":"08:30","end_time":"12:00"}]`,
			want: []map[string]interface{}{
				{"day": "mon", "start_time": "09:00", "end_time": "17:00"},
				{"day": "fri", "start_time": "08:30", "end_time": "12:00"},
			},
		},
		{
			name: "normalizes day casing and trims",
			raw:  `[{"day":" Mon ","start_time":" 09:00 ","end_time":"17:00"}]`,
			want: []map[string]interface{}{
				{"day": "mon", "start_time": "09:00", "end_time": "17:00"},
			},
		},
		{
			name: "drops incomplete rows",
			raw:  `[{"day":"mon","start_time":"09:00","end_time":""},{"day":"","start_time":"09:00","end_time":"17:00"},{"day":"tue","start_time":"10:00","end_time":"18:00"}]`,
			want: []map[string]interface{}{
				{"day": "tue", "start_time": "10:00", "end_time": "18:00"},
			},
		},
		{
			name: "corrupt json fails soft",
			raw:  `{not-json`,
			want: []map[string]interface{}{},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := parseInstantScheduleJSON([]byte(tc.raw))
			require.NotNil(t, got)
			assert.Equal(t, tc.want, got)
		})
	}
}

// mockProviderProfileClient stubs GetProviderProfile for GetMe schedule tests.
type mockProviderProfileClient struct {
	userv1.UserServiceClient
	profile *userv1.ProviderProfile
	err     error
}

func (m *mockProviderProfileClient) GetProviderProfile(
	_ context.Context,
	_ *userv1.GetProviderProfileRequest,
	_ ...grpc.CallOption,
) (*userv1.GetProviderProfileResponse, error) {
	if m.err != nil {
		return nil, m.err
	}
	return &userv1.GetProviderProfileResponse{Profile: m.profile}, nil
}

func TestGetMe_includesEmptyScheduleWhenDBNil(t *testing.T) {
	t.Parallel()

	userID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	client := &mockProviderProfileClient{
		profile: &userv1.ProviderProfile{
			Id:             "profile-1",
			UserId:         userID,
			BusinessName:   "Acme Plumbing",
			InstantEnabled: true,
			InstantAvailable: true,
			MemberSince:    timestamppb.Now(),
		},
	}
	h := NewProviderHandler(client, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/providers/me", nil)
	req = addClaimsToRequest(req, userID, "provider@example.com", []string{"provider"})
	rec := httptest.NewRecorder()

	h.GetMe(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())

	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))

	// schedule must always be present on owner GET (empty when DB unavailable).
	rawSchedule, ok := body["schedule"]
	require.True(t, ok, "schedule key missing from GET /providers/me")
	schedule, ok := rawSchedule.([]interface{})
	require.True(t, ok, "schedule should be a JSON array, got %T", rawSchedule)
	assert.Empty(t, schedule)

	assert.Equal(t, "Acme Plumbing", body["business_name"])
	assert.Equal(t, true, body["instant_enabled"])
	assert.Equal(t, true, body["instant_available"])
}

func TestGetInstantSchedule_nilDBReturnsEmpty(t *testing.T) {
	t.Parallel()
	h := NewProviderHandler(nil, nil, nil)
	got := h.getInstantSchedule(context.Background(), "user-1")
	require.NotNil(t, got)
	assert.Empty(t, got)
}
