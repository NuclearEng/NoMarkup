package main

import (
	"context"
	"fmt"

	imagingv1 "github.com/nomarkup/nomarkup/proto/imaging/v1"
)

// objectStoreDeleterClient satisfies service.ObjectStoreDeleter by delegating
// to ImagingService/DeleteUserObjects. Imaging owns S3 and the real key
// layout ({context}/{user_id}/… plus {user_id}/{variant}/…). The user
// service must not grow an AWS SDK dependency (CLAUDE.md §11: no S3 in Go).
type objectStoreDeleterClient struct {
	cli imagingv1.ImagingServiceClient
}

func newObjectStoreDeleterClient(cli imagingv1.ImagingServiceClient) *objectStoreDeleterClient {
	return &objectStoreDeleterClient{cli: cli}
}

func (c *objectStoreDeleterClient) DeleteUserObjects(ctx context.Context, userID string) (int, error) {
	if c == nil || c.cli == nil {
		return 0, nil
	}
	resp, err := c.cli.DeleteUserObjects(ctx, &imagingv1.DeleteUserObjectsRequest{
		UserId: userID,
	})
	if err != nil {
		return 0, fmt.Errorf("imaging DeleteUserObjects: %w", err)
	}
	return int(resp.GetObjectsDeleted()), nil
}
