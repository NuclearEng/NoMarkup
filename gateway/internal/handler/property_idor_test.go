package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"google.golang.org/grpc"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockPropertyUserClient implements the subset of userv1.UserServiceClient
// the PropertyHandler exercises. ListProperties is scoped to the requested
// user_id (mirroring the real service), so the handler's ownership gate can
// be tested in isolation.
type mockPropertyUserClient struct {
	userv1.UserServiceClient
	// propsByUser maps user_id -> property ids that user owns.
	propsByUser map[string][]string
	// updateCalled / deleteCalled record whether the mutation reached the
	// downstream service — they MUST stay false on a cross-user attempt.
	updateCalled bool
	deleteCalled bool
}

func (m *mockPropertyUserClient) ListProperties(_ context.Context, req *userv1.ListPropertiesRequest, _ ...grpc.CallOption) (*userv1.ListPropertiesResponse, error) {
	out := make([]*userv1.Property, 0)
	for _, id := range m.propsByUser[req.GetUserId()] {
		out = append(out, &userv1.Property{Id: id, UserId: req.GetUserId()})
	}
	return &userv1.ListPropertiesResponse{Properties: out}, nil
}

func (m *mockPropertyUserClient) UpdateProperty(_ context.Context, req *userv1.UpdatePropertyRequest, _ ...grpc.CallOption) (*userv1.UpdatePropertyResponse, error) {
	m.updateCalled = true
	return &userv1.UpdatePropertyResponse{Property: &userv1.Property{Id: req.GetPropertyId()}}, nil
}

func (m *mockPropertyUserClient) DeleteProperty(_ context.Context, _ *userv1.DeletePropertyRequest, _ ...grpc.CallOption) (*userv1.DeletePropertyResponse, error) {
	m.deleteCalled = true
	return &userv1.DeletePropertyResponse{}, nil
}

const (
	propOwnerID    = "00000000-0000-0000-0000-000000000002"
	propAttackerID = "11111111-1111-1111-1111-111111111111"
	ownedPropID    = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
)

func newPropTestHandler() *mockPropertyUserClient {
	return &mockPropertyUserClient{
		propsByUser: map[string][]string{
			propOwnerID: {ownedPropID},
		},
	}
}

func TestPropertyUpdate_CrossUser_IsBlocked(t *testing.T) {
	mock := newPropTestHandler()
	h := NewPropertyHandler(mock)

	r := httptest.NewRequest(http.MethodPut, "/api/v1/properties/"+ownedPropID,
		strings.NewReader(`{"nickname":"HACKED"}`))
	r = addClaimsToRequest(r, propAttackerID, "eve@example.com", []string{"customer"})
	r = withChiURLParam(r, "id", ownedPropID)
	rec := httptest.NewRecorder()

	h.Update(rec, r)

	assert.Equal(t, http.StatusNotFound, rec.Code, "cross-user update must 404")
	assert.False(t, mock.updateCalled, "downstream UpdateProperty must NOT be called for a non-owner (IDOR)")
}

func TestPropertyDelete_CrossUser_IsBlocked(t *testing.T) {
	mock := newPropTestHandler()
	h := NewPropertyHandler(mock)

	r := httptest.NewRequest(http.MethodDelete, "/api/v1/properties/"+ownedPropID, nil)
	r = addClaimsToRequest(r, propAttackerID, "eve@example.com", []string{"customer"})
	r = withChiURLParam(r, "id", ownedPropID)
	rec := httptest.NewRecorder()

	h.Delete(rec, r)

	assert.Equal(t, http.StatusNotFound, rec.Code, "cross-user delete must 404")
	assert.False(t, mock.deleteCalled, "downstream DeleteProperty must NOT be called for a non-owner (IDOR)")
}

func TestPropertyUpdate_Owner_Succeeds(t *testing.T) {
	mock := newPropTestHandler()
	h := NewPropertyHandler(mock)

	r := httptest.NewRequest(http.MethodPut, "/api/v1/properties/"+ownedPropID,
		strings.NewReader(`{"nickname":"My Cabin"}`))
	r = addClaimsToRequest(r, propOwnerID, "owner@example.com", []string{"customer"})
	r = withChiURLParam(r, "id", ownedPropID)
	rec := httptest.NewRecorder()

	h.Update(rec, r)

	require.Equal(t, http.StatusOK, rec.Code, "owner update must succeed")
	assert.True(t, mock.updateCalled, "downstream UpdateProperty must be called for the owner")
}

func TestPropertyDelete_Owner_Succeeds(t *testing.T) {
	mock := newPropTestHandler()
	h := NewPropertyHandler(mock)

	r := httptest.NewRequest(http.MethodDelete, "/api/v1/properties/"+ownedPropID, nil)
	r = addClaimsToRequest(r, propOwnerID, "owner@example.com", []string{"customer"})
	r = withChiURLParam(r, "id", ownedPropID)
	rec := httptest.NewRecorder()

	h.Delete(rec, r)

	require.Equal(t, http.StatusNoContent, rec.Code, "owner delete must succeed")
	assert.True(t, mock.deleteCalled, "downstream DeleteProperty must be called for the owner")
}
