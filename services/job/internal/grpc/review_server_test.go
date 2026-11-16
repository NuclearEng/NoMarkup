package grpc

import (
	"fmt"
	"testing"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestDomainReviewToProto_PhotoURLs(t *testing.T) {
	t.Parallel()
	urls := []string{"https://cdn.example.com/reviews/a.jpg", "https://cdn.example.com/reviews/b.jpg"}
	pb := domainReviewToProto(&domain.Review{
		ID:            "r-1",
		ContractID:    "c-1",
		ReviewerID:    "u-1",
		RevieweeID:    "u-2",
		ReviewerRole:  "customer",
		OverallRating: 5,
		ReviewText:    "great work from start to finish, really happy",
		PhotoURLs:     urls,
	})
	if pb == nil {
		t.Fatal("expected proto review")
	}
	if len(pb.GetPhotoUrls()) != 2 {
		t.Fatalf("photo_urls len = %d, want 2", len(pb.GetPhotoUrls()))
	}
	if pb.GetPhotoUrls()[0] != urls[0] || pb.GetPhotoUrls()[1] != urls[1] {
		t.Fatalf("photo_urls = %v, want %v", pb.GetPhotoUrls(), urls)
	}
}

func TestMapReviewDomainError_InvalidReviewPhotos(t *testing.T) {
	t.Parallel()
	wrapped := fmt.Errorf("create review: %w: photo_urls must be http(s) CDN URLs", domain.ErrInvalidReviewPhotos)
	got := status.Code(mapReviewDomainError(wrapped))
	if got != codes.InvalidArgument {
		t.Fatalf("mapReviewDomainError(invalid photos) = %v, want InvalidArgument", got)
	}
}
