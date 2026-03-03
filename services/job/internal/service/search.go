package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/meilisearch/meilisearch-go"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

const jobsIndexUID = "jobs"

// SearchEngine wraps Meilisearch for job search indexing.
type SearchEngine struct {
	client meilisearch.ServiceManager
}

// NewSearchEngine creates a new Meilisearch search engine.
func NewSearchEngine(host, apiKey string) (*SearchEngine, error) {
	client := meilisearch.New(host, meilisearch.WithAPIKey(apiKey))

	se := &SearchEngine{client: client}
	if err := se.ConfigureIndex(); err != nil {
		return nil, fmt.Errorf("configure search index: %w", err)
	}
	return se, nil
}

// ConfigureIndex sets up the Meilisearch index with searchable and filterable attributes.
func (se *SearchEngine) ConfigureIndex() error {
	_, err := se.client.CreateIndex(&meilisearch.IndexConfig{
		Uid:        jobsIndexUID,
		PrimaryKey: "id",
	})
	if err != nil {
		slog.Warn("search index may already exist", "error", err)
	}

	index := se.client.Index(jobsIndexUID)

	_, err = index.UpdateSearchableAttributes(&[]string{
		"title", "description", "category_name", "service_city", "service_state",
	})
	if err != nil {
		return fmt.Errorf("update searchable attributes: %w", err)
	}

	filterableAttrs := []interface{}{
		"category_id", "subcategory_id", "service_type_id",
		"status", "schedule_type", "is_recurring",
		"starting_bid_cents", "service_zip", "service_state",
	}
	_, err = index.UpdateFilterableAttributes(&filterableAttrs)
	if err != nil {
		return fmt.Errorf("update filterable attributes: %w", err)
	}

	_, err = index.UpdateSortableAttributes(&[]string{
		"created_at", "auction_ends_at", "starting_bid_cents", "bid_count",
	})
	if err != nil {
		return fmt.Errorf("update sortable attributes: %w", err)
	}

	return nil
}

// IndexJob adds or updates a job in the search index.
func (se *SearchEngine) IndexJob(ctx context.Context, job *domain.Job) error {
	doc := map[string]interface{}{
		"id":                 job.ID,
		"title":              job.Title,
		"description":        job.Description,
		"category_id":        job.CategoryID,
		"subcategory_id":     job.SubcategoryID,
		"service_type_id":    job.ServiceTypeID,
		"status":             job.Status,
		"schedule_type":      job.ScheduleType,
		"is_recurring":       job.IsRecurring,
		"starting_bid_cents": job.StartingBidCents,
		"bid_count":          job.BidCount,
		"service_city":       job.ServiceCity,
		"service_state":      job.ServiceState,
		"service_zip":        job.ServiceZip,
		"created_at":         job.CreatedAt.Unix(),
	}

	if job.Category != nil {
		doc["category_name"] = job.Category.Name
	}

	if job.AuctionEndsAt != nil {
		doc["auction_ends_at"] = job.AuctionEndsAt.Unix()
	}

	_, err := se.client.Index(jobsIndexUID).AddDocuments([]map[string]interface{}{doc}, nil)
	if err != nil {
		return fmt.Errorf("index job: %w", err)
	}
	return nil
}

// RemoveJob removes a job from the search index.
func (se *SearchEngine) RemoveJob(ctx context.Context, jobID string) error {
	_, err := se.client.Index(jobsIndexUID).DeleteDocument(jobID, nil)
	if err != nil {
		return fmt.Errorf("remove job from index: %w", err)
	}
	return nil
}

// SearchJobs performs a text search via Meilisearch (returns job IDs).
func (se *SearchEngine) SearchJobs(ctx context.Context, query string, limit, offset int64) ([]string, int64, error) {
	resp, err := se.client.Index(jobsIndexUID).Search(query, &meilisearch.SearchRequest{
		Limit:  limit,
		Offset: offset,
		Filter: "status = active",
	})
	if err != nil {
		return nil, 0, fmt.Errorf("meilisearch search: %w", err)
	}

	ids := make([]string, 0, len(resp.Hits))
	for _, hit := range resp.Hits {
		if raw, ok := hit["id"]; ok {
			var id string
			if err := json.Unmarshal(raw, &id); err == nil {
				ids = append(ids, id)
			}
		}
	}
	return ids, resp.EstimatedTotalHits, nil
}
