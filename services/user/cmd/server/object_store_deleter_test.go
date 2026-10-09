package main

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"

	imagingv1 "github.com/nomarkup/nomarkup/proto/imaging/v1"
)

type fakeImagingClient struct {
	imagingv1.ImagingServiceClient

	lastUserID   string
	objects      int32
	err          error
	deleteCalled int
}

func (f *fakeImagingClient) DeleteUserObjects(_ context.Context, req *imagingv1.DeleteUserObjectsRequest, _ ...grpc.CallOption) (*imagingv1.DeleteUserObjectsResponse, error) {
	f.lastUserID = req.GetUserId()
	f.deleteCalled++
	if f.err != nil {
		return nil, f.err
	}
	return &imagingv1.DeleteUserObjectsResponse{ObjectsDeleted: f.objects}, nil
}

func TestObjectStoreDeleterClient_NilClient_Zero(t *testing.T) {
	t.Parallel()
	var c *objectStoreDeleterClient
	n, err := c.DeleteUserObjects(context.Background(), "550e8400-e29b-41d4-a716-446655440000")
	require.NoError(t, err)
	assert.Equal(t, 0, n)
}

func TestObjectStoreDeleterClient_PassThrough(t *testing.T) {
	t.Parallel()
	fake := &fakeImagingClient{objects: 12}
	c := newObjectStoreDeleterClient(fake)
	uid := "550e8400-e29b-41d4-a716-446655440000"
	n, err := c.DeleteUserObjects(context.Background(), uid)
	require.NoError(t, err)
	assert.Equal(t, 12, n)
	assert.Equal(t, uid, fake.lastUserID)
	assert.Equal(t, 1, fake.deleteCalled)
}

func TestObjectStoreDeleterClient_RPCError(t *testing.T) {
	t.Parallel()
	fake := &fakeImagingClient{err: errors.New("s3 down")}
	c := newObjectStoreDeleterClient(fake)
	_, err := c.DeleteUserObjects(context.Background(), "550e8400-e29b-41d4-a716-446655440000")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "imaging DeleteUserObjects")
}
