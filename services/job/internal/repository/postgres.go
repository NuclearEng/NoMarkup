package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// PostgresRepository implements domain.JobRepository using pgx.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresRepository creates a new PostgreSQL-backed job repository.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) CreateJob(ctx context.Context, input domain.CreateJobInput) (*domain.Job, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("create job begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Look up the property to get location data.
	var serviceAddress, serviceCity, serviceState, serviceZip *string
	var propLng, propLat *float64
	if input.PropertyID != "" {
		err := tx.QueryRow(ctx, `
			SELECT address, city, state, zip_code,
			       ST_X(location) AS lng, ST_Y(location) AS lat
			FROM properties
			WHERE id = $1 AND deleted_at IS NULL`, input.PropertyID).
			Scan(&serviceAddress, &serviceCity, &serviceState, &serviceZip, &propLng, &propLat)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("create job: %w", domain.ErrPropertyNotFound)
			}
			return nil, fmt.Errorf("create job lookup property: %w", err)
		}
	}

	// Compute approximate location from zip centroid (use property location as fallback).
	status := "draft"
	if input.Publish {
		status = "active"
	}

	durationHours := input.AuctionDurationHours
	if durationHours <= 0 {
		durationHours = 72
	}

	city := ""
	state := ""
	zip := ""
	addr := ""
	if serviceCity != nil {
		city = *serviceCity
	}
	if serviceState != nil {
		state = *serviceState
	}
	if serviceZip != nil {
		zip = *serviceZip
	}
	if serviceAddress != nil {
		addr = *serviceAddress
	}

	// Use property location for both exact and approximate.
	lng := 0.0
	lat := 0.0
	if propLng != nil {
		lng = *propLng
	}
	if propLat != nil {
		lat = *propLat
	}

	var auctionEndsAt *time.Time
	if status == "active" {
		t := time.Now().Add(time.Duration(durationHours) * time.Hour)
		auctionEndsAt = &t
	}

	var recurrenceFreq *string
	if input.IsRecurring && input.RecurrenceFrequency != nil {
		recurrenceFreq = input.RecurrenceFrequency
	}

	var jobID string
	var createdAt, updatedAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO jobs (
			customer_id, property_id, title, description,
			category_id, subcategory_id, service_type_id,
			service_address, service_city, service_state, service_zip,
			service_location, approximate_location,
			schedule_type, scheduled_date, schedule_range_start, schedule_range_end,
			is_recurring, recurrence_frequency,
			starting_bid_cents, offer_accepted_cents,
			auction_duration_hours, auction_ends_at, min_provider_rating,
			status
		) VALUES (
			$1, NULLIF($2, '')::uuid, $3, $4,
			$5, NULLIF($6, '')::uuid, NULLIF($7, '')::uuid,
			$8, $9, $10, $11,
			ST_SetSRID(ST_MakePoint($12, $13), 4326),
			ST_SetSRID(ST_MakePoint($12, $13), 4326),
			$14, $15, $16, $17,
			$18, $19,
			$20, $21,
			$22, $23, $24,
			$25
		)
		RETURNING id, created_at, updated_at`,
		input.CustomerID, input.PropertyID, input.Title, input.Description,
		input.CategoryID, input.SubcategoryID, input.ServiceTypeID,
		addr, city, state, zip,
		lng, lat,
		input.ScheduleType, input.ScheduledDate, input.ScheduleRangeStart, input.ScheduleRangeEnd,
		input.IsRecurring, recurrenceFreq,
		input.StartingBidCents, input.OfferAcceptedCents,
		durationHours, auctionEndsAt, input.MinProviderRating,
		status,
	).Scan(&jobID, &createdAt, &updatedAt)
	if err != nil {
		return nil, fmt.Errorf("create job insert: %w", err)
	}

	// Insert photos.
	for i, url := range input.PhotoURLs {
		_, err = tx.Exec(ctx,
			`INSERT INTO job_photos (job_id, image_url, sort_order) VALUES ($1, $2, $3)`,
			jobID, url, i)
		if err != nil {
			return nil, fmt.Errorf("create job insert photo: %w", err)
		}
	}

	// Insert tags.
	for _, catID := range input.TagCategoryIDs {
		_, err = tx.Exec(ctx,
			`INSERT INTO job_tags (job_id, category_id) VALUES ($1, $2)`,
			jobID, catID)
		if err != nil {
			return nil, fmt.Errorf("create job insert tag: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("create job commit: %w", err)
	}

	return r.GetJob(ctx, jobID)
}

func (r *PostgresRepository) UpdateJob(ctx context.Context, jobID string, input domain.UpdateJobInput) (*domain.Job, error) {
	// Verify job exists and is draft.
	var currentStatus string
	err := r.pool.QueryRow(ctx, `SELECT status FROM jobs WHERE id = $1 AND deleted_at IS NULL`, jobID).Scan(&currentStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("update job: %w", domain.ErrJobNotFound)
		}
		return nil, fmt.Errorf("update job get status: %w", err)
	}
	if currentStatus != "draft" {
		return nil, fmt.Errorf("update job: %w", domain.ErrNotDraft)
	}

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if input.Title != nil {
		setClauses = append(setClauses, fmt.Sprintf("title = $%d", argIdx))
		args = append(args, *input.Title)
		argIdx++
	}
	if input.Description != nil {
		setClauses = append(setClauses, fmt.Sprintf("description = $%d", argIdx))
		args = append(args, *input.Description)
		argIdx++
	}
	if input.CategoryID != nil {
		setClauses = append(setClauses, fmt.Sprintf("category_id = $%d", argIdx))
		args = append(args, *input.CategoryID)
		argIdx++
	}
	if input.SubcategoryID != nil {
		setClauses = append(setClauses, fmt.Sprintf("subcategory_id = NULLIF($%d, '')::uuid", argIdx))
		args = append(args, *input.SubcategoryID)
		argIdx++
	}
	if input.ServiceTypeID != nil {
		setClauses = append(setClauses, fmt.Sprintf("service_type_id = NULLIF($%d, '')::uuid", argIdx))
		args = append(args, *input.ServiceTypeID)
		argIdx++
	}
	if input.ScheduleType != nil {
		setClauses = append(setClauses, fmt.Sprintf("schedule_type = $%d", argIdx))
		args = append(args, *input.ScheduleType)
		argIdx++
	}
	if input.StartingBidCents != nil {
		setClauses = append(setClauses, fmt.Sprintf("starting_bid_cents = $%d", argIdx))
		args = append(args, *input.StartingBidCents)
		argIdx++
	}
	if input.OfferAcceptedCents != nil {
		setClauses = append(setClauses, fmt.Sprintf("offer_accepted_cents = $%d", argIdx))
		args = append(args, *input.OfferAcceptedCents)
		argIdx++
	}
	if input.AuctionDurationHours != nil {
		setClauses = append(setClauses, fmt.Sprintf("auction_duration_hours = $%d", argIdx))
		args = append(args, *input.AuctionDurationHours)
		argIdx++
	}

	if len(setClauses) > 0 {
		setClauses = append(setClauses, "updated_at = now()")
		args = append(args, jobID)

		query := fmt.Sprintf(`UPDATE jobs SET %s WHERE id = $%d AND deleted_at IS NULL`,
			strings.Join(setClauses, ", "), argIdx)

		tag, err := r.pool.Exec(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("update job: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil, fmt.Errorf("update job: %w", domain.ErrJobNotFound)
		}
	}

	// Update photos if provided (non-nil).
	if input.PhotoURLs != nil {
		tx, err := r.pool.Begin(ctx)
		if err != nil {
			return nil, fmt.Errorf("update job photos begin tx: %w", err)
		}
		defer tx.Rollback(ctx)

		_, err = tx.Exec(ctx, `DELETE FROM job_photos WHERE job_id = $1`, jobID)
		if err != nil {
			return nil, fmt.Errorf("update job delete photos: %w", err)
		}

		for i, url := range input.PhotoURLs {
			_, err = tx.Exec(ctx,
				`INSERT INTO job_photos (job_id, image_url, sort_order) VALUES ($1, $2, $3)`,
				jobID, url, i)
			if err != nil {
				return nil, fmt.Errorf("update job insert photo: %w", err)
			}
		}

		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("update job photos commit: %w", err)
		}
	}

	return r.GetJob(ctx, jobID)
}

func (r *PostgresRepository) GetJob(ctx context.Context, jobID string) (*domain.Job, error) {
	job, err := r.scanJobWithCategories(ctx, jobID)
	if err != nil {
		return nil, err
	}

	// Load photos.
	photos, err := r.getJobPhotos(ctx, jobID)
	if err != nil {
		return nil, fmt.Errorf("get job photos: %w", err)
	}
	job.Photos = photos

	// Load market range if service type and zip available.
	if job.ServiceTypeID != "" && job.ServiceZip != "" {
		mr, err := r.LookupMarketRange(ctx, job.ServiceTypeID, job.ServiceZip)
		if err == nil {
			job.MarketRange = mr
		}
	}

	return job, nil
}

func (r *PostgresRepository) GetJobDetail(ctx context.Context, jobID string, requestingUserID string) (*domain.Job, error) {
	return r.GetJob(ctx, jobID)
}

func (r *PostgresRepository) DeleteDraft(ctx context.Context, jobID string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE jobs SET deleted_at = now() WHERE id = $1 AND status = 'draft' AND deleted_at IS NULL`,
		jobID)
	if err != nil {
		return fmt.Errorf("delete draft: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Check if exists.
		var exists bool
		_ = r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM jobs WHERE id = $1 AND deleted_at IS NULL)`, jobID).Scan(&exists)
		if !exists {
			return fmt.Errorf("delete draft: %w", domain.ErrJobNotFound)
		}
		return fmt.Errorf("delete draft: %w", domain.ErrNotDraft)
	}
	return nil
}

func (r *PostgresRepository) PublishJob(ctx context.Context, jobID string) (*domain.Job, error) {
	auctionEndsAt := time.Now()
	var durationHours int
	err := r.pool.QueryRow(ctx,
		`SELECT auction_duration_hours FROM jobs WHERE id = $1 AND deleted_at IS NULL`, jobID).Scan(&durationHours)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("publish job: %w", domain.ErrJobNotFound)
		}
		return nil, fmt.Errorf("publish job get duration: %w", err)
	}
	if durationHours <= 0 {
		durationHours = 72
	}
	auctionEndsAt = auctionEndsAt.Add(time.Duration(durationHours) * time.Hour)

	tag, err := r.pool.Exec(ctx,
		`UPDATE jobs SET status = 'active', auction_ends_at = $1, updated_at = now()
		 WHERE id = $2 AND status = 'draft' AND deleted_at IS NULL`,
		auctionEndsAt, jobID)
	if err != nil {
		return nil, fmt.Errorf("publish job: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("publish job: %w", domain.ErrNotDraft)
	}
	return r.GetJob(ctx, jobID)
}

func (r *PostgresRepository) CloseAuction(ctx context.Context, jobID string, customerID string) (*domain.Job, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE jobs SET status = CASE WHEN bid_count > 0 THEN 'closed' ELSE 'closed_zero_bids' END,
		        closed_at = now(), updated_at = now()
		 WHERE id = $1 AND customer_id = $2 AND status = 'active' AND deleted_at IS NULL`,
		jobID, customerID)
	if err != nil {
		return nil, fmt.Errorf("close auction: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Distinguish between not found, not owner, not active.
		var job domain.Job
		err := r.pool.QueryRow(ctx,
			`SELECT customer_id, status FROM jobs WHERE id = $1 AND deleted_at IS NULL`, jobID).
			Scan(&job.CustomerID, &job.Status)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("close auction: %w", domain.ErrJobNotFound)
			}
			return nil, fmt.Errorf("close auction check: %w", err)
		}
		if job.CustomerID != customerID {
			return nil, fmt.Errorf("close auction: %w", domain.ErrNotOwner)
		}
		return nil, fmt.Errorf("close auction: %w", domain.ErrNotActive)
	}
	return r.GetJob(ctx, jobID)
}

func (r *PostgresRepository) CancelJob(ctx context.Context, jobID string, customerID string) (*domain.Job, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE jobs SET status = 'cancelled', cancelled_at = now(), updated_at = now()
		 WHERE id = $1 AND customer_id = $2 AND status IN ('draft', 'active', 'closed', 'closed_zero_bids') AND deleted_at IS NULL`,
		jobID, customerID)
	if err != nil {
		return nil, fmt.Errorf("cancel job: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var job domain.Job
		err := r.pool.QueryRow(ctx,
			`SELECT customer_id, status FROM jobs WHERE id = $1 AND deleted_at IS NULL`, jobID).
			Scan(&job.CustomerID, &job.Status)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("cancel job: %w", domain.ErrJobNotFound)
			}
			return nil, fmt.Errorf("cancel job check: %w", err)
		}
		if job.CustomerID != customerID {
			return nil, fmt.Errorf("cancel job: %w", domain.ErrNotOwner)
		}
		return nil, fmt.Errorf("cancel job: %w", domain.ErrInvalidStatus)
	}
	return r.GetJob(ctx, jobID)
}

func (r *PostgresRepository) SearchJobs(ctx context.Context, input domain.SearchJobsInput) ([]*domain.Job, *domain.Pagination, error) {
	// Build the query dynamically.
	where := []string{"j.status = 'active'", "j.deleted_at IS NULL"}
	args := []interface{}{}
	argIdx := 1

	if len(input.CategoryIDs) > 0 {
		placeholders := make([]string, len(input.CategoryIDs))
		for i, catID := range input.CategoryIDs {
			placeholders[i] = fmt.Sprintf("$%d", argIdx)
			args = append(args, catID)
			argIdx++
		}
		where = append(where, fmt.Sprintf("(j.category_id IN (%s) OR j.subcategory_id IN (%s) OR j.service_type_id IN (%s))",
			strings.Join(placeholders, ","), strings.Join(placeholders, ","), strings.Join(placeholders, ",")))
	}

	if input.Latitude != 0 && input.Longitude != 0 && input.RadiusKm > 0 {
		radiusMeters := input.RadiusKm * 1000
		where = append(where, fmt.Sprintf(
			"ST_DWithin(j.approximate_location::geography, ST_SetSRID(ST_MakePoint($%d, $%d), 4326)::geography, $%d)",
			argIdx, argIdx+1, argIdx+2))
		args = append(args, input.Longitude, input.Latitude, radiusMeters)
		argIdx += 3
	}

	if input.MinPriceCents != nil {
		where = append(where, fmt.Sprintf("j.starting_bid_cents >= $%d", argIdx))
		args = append(args, *input.MinPriceCents)
		argIdx++
	}

	if input.MaxPriceCents != nil {
		where = append(where, fmt.Sprintf("j.starting_bid_cents <= $%d", argIdx))
		args = append(args, *input.MaxPriceCents)
		argIdx++
	}

	if input.ScheduleType != nil && *input.ScheduleType != "" {
		where = append(where, fmt.Sprintf("j.schedule_type = $%d", argIdx))
		args = append(args, *input.ScheduleType)
		argIdx++
	}

	if input.RecurringOnly != nil && *input.RecurringOnly {
		where = append(where, "j.is_recurring = true")
	}

	if input.TextQuery != "" {
		where = append(where, fmt.Sprintf(
			"(j.title ILIKE '%%' || $%d || '%%' OR j.description ILIKE '%%' || $%d || '%%')",
			argIdx, argIdx))
		args = append(args, input.TextQuery)
		argIdx++
	}

	whereClause := strings.Join(where, " AND ")

	// Count query.
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM jobs j WHERE %s`, whereClause)
	var totalCount int
	err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&totalCount)
	if err != nil {
		return nil, nil, fmt.Errorf("search jobs count: %w", err)
	}

	// Pagination defaults.
	page := input.Page
	if page < 1 {
		page = 1
	}
	pageSize := input.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	totalPages := 0
	if totalCount > 0 {
		totalPages = (totalCount + pageSize - 1) / pageSize
	}

	offset := (page - 1) * pageSize

	// Sort.
	orderBy := "j.created_at DESC"
	if input.SortField != "" {
		allowedSorts := map[string]string{
			"created_at":         "j.created_at",
			"auction_ends_at":    "j.auction_ends_at",
			"starting_bid_cents": "j.starting_bid_cents",
			"bid_count":          "j.bid_count",
		}
		if col, ok := allowedSorts[input.SortField]; ok {
			dir := "ASC"
			if input.SortDesc {
				dir = "DESC"
			}
			orderBy = fmt.Sprintf("%s %s", col, dir)
		}
	}

	selectQuery := fmt.Sprintf(`
		SELECT j.id, j.customer_id, COALESCE(j.property_id::text, ''), j.title, j.description,
		       j.category_id, COALESCE(j.subcategory_id::text, ''), COALESCE(j.service_type_id::text, ''),
		       COALESCE(j.service_address, ''), j.service_city, j.service_state, j.service_zip,
		       j.schedule_type, j.scheduled_date, j.schedule_range_start, j.schedule_range_end,
		       j.is_recurring, j.recurrence_frequency,
		       j.starting_bid_cents, j.offer_accepted_cents,
		       j.auction_duration_hours, j.auction_ends_at, j.min_provider_rating,
		       j.status, j.bid_count,
		       COALESCE(j.awarded_provider_id::text, ''), COALESCE(j.awarded_bid_id::text, ''),
		       COALESCE(j.reposted_from_id::text, ''), j.repost_count,
		       j.awarded_at, j.closed_at, j.completed_at, j.cancelled_at,
		       j.created_at, j.updated_at, j.deleted_at,
		       COALESCE(c.name, ''), COALESCE(c.slug, ''), COALESCE(c.icon, '')
		FROM jobs j
		LEFT JOIN service_categories c ON c.id = j.category_id
		WHERE %s
		ORDER BY %s
		LIMIT $%d OFFSET $%d`,
		whereClause, orderBy, argIdx, argIdx+1)

	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("search jobs query: %w", err)
	}
	defer rows.Close()

	var jobs []*domain.Job
	for rows.Next() {
		job, err := scanJobRow(rows)
		if err != nil {
			return nil, nil, fmt.Errorf("search jobs scan: %w", err)
		}
		jobs = append(jobs, job)
	}

	pagination := &domain.Pagination{
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
		HasNext:    page < totalPages,
	}

	return jobs, pagination, nil
}

func (r *PostgresRepository) ListCustomerJobs(ctx context.Context, customerID string, statusFilter *string, propertyID *string, page, pageSize int) ([]*domain.Job, *domain.Pagination, error) {
	where := []string{"j.customer_id = $1", "j.deleted_at IS NULL"}
	args := []interface{}{customerID}
	argIdx := 2

	if statusFilter != nil && *statusFilter != "" {
		where = append(where, fmt.Sprintf("j.status = $%d", argIdx))
		args = append(args, *statusFilter)
		argIdx++
	}
	if propertyID != nil && *propertyID != "" {
		where = append(where, fmt.Sprintf("j.property_id = $%d", argIdx))
		args = append(args, *propertyID)
		argIdx++
	}

	whereClause := strings.Join(where, " AND ")

	var totalCount int
	err := r.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM jobs j WHERE %s`, whereClause), args...).Scan(&totalCount)
	if err != nil {
		return nil, nil, fmt.Errorf("list customer jobs count: %w", err)
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	totalPages := 0
	if totalCount > 0 {
		totalPages = (totalCount + pageSize - 1) / pageSize
	}
	offset := (page - 1) * pageSize

	selectQuery := fmt.Sprintf(`
		SELECT j.id, j.customer_id, COALESCE(j.property_id::text, ''), j.title, j.description,
		       j.category_id, COALESCE(j.subcategory_id::text, ''), COALESCE(j.service_type_id::text, ''),
		       COALESCE(j.service_address, ''), j.service_city, j.service_state, j.service_zip,
		       j.schedule_type, j.scheduled_date, j.schedule_range_start, j.schedule_range_end,
		       j.is_recurring, j.recurrence_frequency,
		       j.starting_bid_cents, j.offer_accepted_cents,
		       j.auction_duration_hours, j.auction_ends_at, j.min_provider_rating,
		       j.status, j.bid_count,
		       COALESCE(j.awarded_provider_id::text, ''), COALESCE(j.awarded_bid_id::text, ''),
		       COALESCE(j.reposted_from_id::text, ''), j.repost_count,
		       j.awarded_at, j.closed_at, j.completed_at, j.cancelled_at,
		       j.created_at, j.updated_at, j.deleted_at,
		       COALESCE(c.name, ''), COALESCE(c.slug, ''), COALESCE(c.icon, '')
		FROM jobs j
		LEFT JOIN service_categories c ON c.id = j.category_id
		WHERE %s
		ORDER BY j.created_at DESC
		LIMIT $%d OFFSET $%d`,
		whereClause, argIdx, argIdx+1)
	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("list customer jobs query: %w", err)
	}
	defer rows.Close()

	var jobs []*domain.Job
	for rows.Next() {
		job, err := scanJobRow(rows)
		if err != nil {
			return nil, nil, fmt.Errorf("list customer jobs scan: %w", err)
		}
		jobs = append(jobs, job)
	}

	return jobs, &domain.Pagination{
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
		HasNext:    page < totalPages,
	}, nil
}

func (r *PostgresRepository) ListDrafts(ctx context.Context, customerID string) ([]*domain.Job, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT j.id, j.customer_id, COALESCE(j.property_id::text, ''), j.title, j.description,
		       j.category_id, COALESCE(j.subcategory_id::text, ''), COALESCE(j.service_type_id::text, ''),
		       COALESCE(j.service_address, ''), j.service_city, j.service_state, j.service_zip,
		       j.schedule_type, j.scheduled_date, j.schedule_range_start, j.schedule_range_end,
		       j.is_recurring, j.recurrence_frequency,
		       j.starting_bid_cents, j.offer_accepted_cents,
		       j.auction_duration_hours, j.auction_ends_at, j.min_provider_rating,
		       j.status, j.bid_count,
		       COALESCE(j.awarded_provider_id::text, ''), COALESCE(j.awarded_bid_id::text, ''),
		       COALESCE(j.reposted_from_id::text, ''), j.repost_count,
		       j.awarded_at, j.closed_at, j.completed_at, j.cancelled_at,
		       j.created_at, j.updated_at, j.deleted_at,
		       COALESCE(c.name, ''), COALESCE(c.slug, ''), COALESCE(c.icon, '')
		FROM jobs j
		LEFT JOIN service_categories c ON c.id = j.category_id
		WHERE j.customer_id = $1 AND j.status = 'draft' AND j.deleted_at IS NULL
		ORDER BY j.updated_at DESC`, customerID)
	if err != nil {
		return nil, fmt.Errorf("list drafts: %w", err)
	}
	defer rows.Close()

	var jobs []*domain.Job
	for rows.Next() {
		job, err := scanJobRow(rows)
		if err != nil {
			return nil, fmt.Errorf("list drafts scan: %w", err)
		}
		jobs = append(jobs, job)
	}
	return jobs, nil
}

func (r *PostgresRepository) ListServiceCategories(ctx context.Context, level *int, parentID *string) ([]domain.ServiceCategory, error) {
	query := `
		SELECT sc.id, sc.parent_id, sc.name, sc.slug, sc.level, sc.description, sc.icon,
		       sc.sort_order, sc.active,
		       COALESCE(p.name, '') AS parent_name,
		       sc.created_at, sc.updated_at
		FROM service_categories sc
		LEFT JOIN service_categories p ON p.id = sc.parent_id
		WHERE sc.active = true`
	args := []interface{}{}
	argIdx := 1

	if level != nil {
		query += fmt.Sprintf(" AND sc.level = $%d", argIdx)
		args = append(args, *level)
		argIdx++
	}
	if parentID != nil {
		query += fmt.Sprintf(" AND sc.parent_id = $%d", argIdx)
		args = append(args, *parentID)
		argIdx++
	}
	_ = argIdx

	query += " ORDER BY sc.level, sc.sort_order"

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list service categories: %w", err)
	}
	defer rows.Close()

	var cats []domain.ServiceCategory
	for rows.Next() {
		var c domain.ServiceCategory
		var description, icon *string
		err := rows.Scan(
			&c.ID, &c.ParentID, &c.Name, &c.Slug, &c.Level,
			&description, &icon, &c.SortOrder, &c.Active,
			&c.ParentName, &c.CreatedAt, &c.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("list service categories scan: %w", err)
		}
		if description != nil {
			c.Description = *description
		}
		if icon != nil {
			c.Icon = *icon
		}
		cats = append(cats, c)
	}
	return cats, nil
}

func (r *PostgresRepository) GetCategoryTree(ctx context.Context) ([]domain.ServiceCategory, error) {
	return r.ListServiceCategories(ctx, nil, nil)
}

func (r *PostgresRepository) LookupMarketRange(ctx context.Context, serviceTypeID string, zipCode string) (*domain.MarketRange, error) {
	var mr domain.MarketRange
	var city, state *string
	err := r.pool.QueryRow(ctx, `
		SELECT id, service_type_id, zip_code, city, state,
		       low_cents, median_cents, high_cents, data_points,
		       source, confidence, season, computed_at, valid_until
		FROM market_ranges
		WHERE service_type_id = $1 AND zip_code = $2
		ORDER BY computed_at DESC
		LIMIT 1`,
		serviceTypeID, zipCode).
		Scan(&mr.ID, &mr.ServiceTypeID, &mr.ZipCode, &city, &state,
			&mr.LowCents, &mr.MedianCents, &mr.HighCents, &mr.DataPoints,
			&mr.Source, &mr.Confidence, &mr.Season, &mr.ComputedAt, &mr.ValidUntil)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("lookup market range: %w", domain.ErrMarketRangeNotFound)
		}
		return nil, fmt.Errorf("lookup market range: %w", err)
	}
	if city != nil {
		mr.City = *city
	}
	if state != nil {
		mr.State = *state
	}
	return &mr, nil
}

// scanJobWithCategories loads a job with its category info.
func (r *PostgresRepository) scanJobWithCategories(ctx context.Context, jobID string) (*domain.Job, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT j.id, j.customer_id, COALESCE(j.property_id::text, ''), j.title, j.description,
		       j.category_id, COALESCE(j.subcategory_id::text, ''), COALESCE(j.service_type_id::text, ''),
		       COALESCE(j.service_address, ''), j.service_city, j.service_state, j.service_zip,
		       j.schedule_type, j.scheduled_date, j.schedule_range_start, j.schedule_range_end,
		       j.is_recurring, j.recurrence_frequency,
		       j.starting_bid_cents, j.offer_accepted_cents,
		       j.auction_duration_hours, j.auction_ends_at, j.min_provider_rating,
		       j.status, j.bid_count,
		       COALESCE(j.awarded_provider_id::text, ''), COALESCE(j.awarded_bid_id::text, ''),
		       COALESCE(j.reposted_from_id::text, ''), j.repost_count,
		       j.awarded_at, j.closed_at, j.completed_at, j.cancelled_at,
		       j.created_at, j.updated_at, j.deleted_at,
		       COALESCE(c.name, ''), COALESCE(c.slug, ''), COALESCE(c.icon, ''),
		       COALESCE(sc.id, ''), COALESCE(sc.name, ''), COALESCE(sc.slug, ''), COALESCE(sc.icon, ''),
		       COALESCE(st.id, ''), COALESCE(st.name, ''), COALESCE(st.slug, ''), COALESCE(st.icon, '')
		FROM jobs j
		LEFT JOIN service_categories c ON c.id = j.category_id
		LEFT JOIN service_categories sc ON sc.id = j.subcategory_id
		LEFT JOIN service_categories st ON st.id = j.service_type_id
		WHERE j.id = $1 AND j.deleted_at IS NULL`, jobID)

	var j domain.Job
	var propertyID, subcategoryID, serviceTypeID, serviceAddress string
	var awardedProviderID, awardedBidID, repostedFromID string
	var recurrenceFrequency *string
	var catName, catSlug, catIcon string
	var subID, subName, subSlug, subIcon string
	var stID, stName, stSlug, stIcon string

	err := row.Scan(
		&j.ID, &j.CustomerID, &propertyID, &j.Title, &j.Description,
		&j.CategoryID, &subcategoryID, &serviceTypeID,
		&serviceAddress, &j.ServiceCity, &j.ServiceState, &j.ServiceZip,
		&j.ScheduleType, &j.ScheduledDate, &j.ScheduleRangeStart, &j.ScheduleRangeEnd,
		&j.IsRecurring, &recurrenceFrequency,
		&j.StartingBidCents, &j.OfferAcceptedCents,
		&j.AuctionDurationHours, &j.AuctionEndsAt, &j.MinProviderRating,
		&j.Status, &j.BidCount,
		&awardedProviderID, &awardedBidID,
		&repostedFromID, &j.RepostCount,
		&j.AwardedAt, &j.ClosedAt, &j.CompletedAt, &j.CancelledAt,
		&j.CreatedAt, &j.UpdatedAt, &j.DeletedAt,
		&catName, &catSlug, &catIcon,
		&subID, &subName, &subSlug, &subIcon,
		&stID, &stName, &stSlug, &stIcon,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get job: %w", domain.ErrJobNotFound)
		}
		return nil, fmt.Errorf("get job: %w", err)
	}

	if propertyID != "" {
		j.PropertyID = propertyID
	}
	if subcategoryID != "" {
		j.SubcategoryID = subcategoryID
	}
	if serviceTypeID != "" {
		j.ServiceTypeID = serviceTypeID
	}
	if serviceAddress != "" {
		j.ServiceAddress = serviceAddress
	}
	j.RecurrenceFrequency = recurrenceFrequency
	if awardedProviderID != "" {
		j.AwardedProviderID = &awardedProviderID
	}
	if awardedBidID != "" {
		j.AwardedBidID = &awardedBidID
	}
	if repostedFromID != "" {
		j.RepostedFromID = &repostedFromID
	}

	if catName != "" {
		j.Category = &domain.ServiceCategory{
			ID:   j.CategoryID,
			Name: catName,
			Slug: catSlug,
			Icon: catIcon,
		}
	}
	if subID != "" {
		j.Subcategory = &domain.ServiceCategory{
			ID:   subID,
			Name: subName,
			Slug: subSlug,
			Icon: subIcon,
		}
	}
	if stID != "" {
		j.ServiceType = &domain.ServiceCategory{
			ID:   stID,
			Name: stName,
			Slug: stSlug,
			Icon: stIcon,
		}
	}

	return &j, nil
}

func (r *PostgresRepository) getJobPhotos(ctx context.Context, jobID string) ([]domain.JobPhoto, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, job_id, image_url, sort_order, created_at
		 FROM job_photos WHERE job_id = $1 ORDER BY sort_order`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var photos []domain.JobPhoto
	for rows.Next() {
		var p domain.JobPhoto
		if err := rows.Scan(&p.ID, &p.JobID, &p.ImageURL, &p.SortOrder, &p.CreatedAt); err != nil {
			return nil, err
		}
		photos = append(photos, p)
	}
	return photos, nil
}

// scanJobRow scans a job from a row that includes category name, slug, icon at the end.
func scanJobRow(rows pgx.Rows) (*domain.Job, error) {
	var j domain.Job
	var propertyID, subcategoryID, serviceTypeID, serviceAddress string
	var awardedProviderID, awardedBidID, repostedFromID string
	var recurrenceFrequency *string
	var catName, catSlug, catIcon string

	err := rows.Scan(
		&j.ID, &j.CustomerID, &propertyID, &j.Title, &j.Description,
		&j.CategoryID, &subcategoryID, &serviceTypeID,
		&serviceAddress, &j.ServiceCity, &j.ServiceState, &j.ServiceZip,
		&j.ScheduleType, &j.ScheduledDate, &j.ScheduleRangeStart, &j.ScheduleRangeEnd,
		&j.IsRecurring, &recurrenceFrequency,
		&j.StartingBidCents, &j.OfferAcceptedCents,
		&j.AuctionDurationHours, &j.AuctionEndsAt, &j.MinProviderRating,
		&j.Status, &j.BidCount,
		&awardedProviderID, &awardedBidID,
		&repostedFromID, &j.RepostCount,
		&j.AwardedAt, &j.ClosedAt, &j.CompletedAt, &j.CancelledAt,
		&j.CreatedAt, &j.UpdatedAt, &j.DeletedAt,
		&catName, &catSlug, &catIcon,
	)
	if err != nil {
		return nil, err
	}

	if propertyID != "" {
		j.PropertyID = propertyID
	}
	if subcategoryID != "" {
		j.SubcategoryID = subcategoryID
	}
	if serviceTypeID != "" {
		j.ServiceTypeID = serviceTypeID
	}
	if serviceAddress != "" {
		j.ServiceAddress = serviceAddress
	}
	j.RecurrenceFrequency = recurrenceFrequency
	if awardedProviderID != "" {
		j.AwardedProviderID = &awardedProviderID
	}
	if awardedBidID != "" {
		j.AwardedBidID = &awardedBidID
	}
	if repostedFromID != "" {
		j.RepostedFromID = &repostedFromID
	}

	if catName != "" {
		j.Category = &domain.ServiceCategory{
			ID:   j.CategoryID,
			Name: catName,
			Slug: catSlug,
			Icon: catIcon,
		}
	}

	return &j, nil
}
