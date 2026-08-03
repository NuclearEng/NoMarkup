package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/job/internal/crypto"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// PostgresRepository implements domain.JobRepository using pgx.
type PostgresRepository struct {
	pool   *pgxpool.Pool
	cipher *crypto.Cipher
}

// NewPostgresRepository creates a new PostgreSQL-backed job repository with the
// given PII cipher. Pass a cipher built from crypto.FromEnv() — the at-rest PII
// columns this service owns (jobs.service_address, a CUSTOMER HOME address, and
// jobs.service_location_encrypted, the exact service point; migration 104) are
// encrypted and decrypted through it, as is the linked property's address and
// exact point (migrations 033 and 105).
func NewPostgresRepository(pool *pgxpool.Pool, cipher *crypto.Cipher) *PostgresRepository {
	return &PostgresRepository{pool: pool, cipher: cipher}
}

func (r *PostgresRepository) CreateJob(ctx context.Context, input domain.CreateJobInput) (*domain.Job, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("create job begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Look up the property to get location data.
	//
	// properties.address has been secretbox-encrypted since migration 033 and
	// properties.location is COARSENED at rest since migration 105, with the
	// exact point preserved in properties.location_encrypted. Both therefore
	// have to come back through the cipher before they can seed the job:
	// copying the column verbatim would write ciphertext into
	// jobs.service_address (which is what this code did before 104) and would
	// silently downgrade the job's service point to the property's privacy
	// grid.
	var serviceAddress, serviceCity, serviceState, serviceZip *string
	var propLng, propLat *float64
	var propLocationEncrypted *string
	if input.PropertyID != "" {
		err := tx.QueryRow(ctx, `
			SELECT address, city, state, zip_code,
			       ST_X(location) AS lng, ST_Y(location) AS lat,
			       location_encrypted
			FROM properties
			WHERE id = $1 AND deleted_at IS NULL`, input.PropertyID).
			Scan(&serviceAddress, &serviceCity, &serviceState, &serviceZip, &propLng, &propLat, &propLocationEncrypted)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("create job: %w", domain.ErrPropertyNotFound)
			}
			return nil, fmt.Errorf("create job lookup property: %w", err)
		}
		if serviceAddress != nil {
			plain, derr := r.cipher.DecryptStringOrPassthrough(*serviceAddress)
			if derr != nil {
				return nil, fmt.Errorf("create job decrypt property address: %w", derr)
			}
			serviceAddress = &plain
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

	// Use property location, falling back to direct location input.
	//
	// The encrypted copy is preferred because the geometry is coarsened at rest
	// (migration 105). Legacy rows written before 105 have a NULL
	// location_encrypted and still hold an exact point in the geometry, so the
	// fallback is not a degradation for them.
	lng := 0.0
	lat := 0.0
	if propLng != nil {
		lng = *propLng
	}
	if propLat != nil {
		lat = *propLat
	}
	if propLocationEncrypted != nil && *propLocationEncrypted != "" {
		plain, derr := r.cipher.DecryptStringOrPassthrough(*propLocationEncrypted)
		if derr != nil {
			// A key problem must be loud: silently falling back here would
			// mask a mis-configured ENCRYPTION_KEY behind a slightly-off job
			// location that nobody would ever notice.
			return nil, fmt.Errorf("create job decrypt property location: %w", derr)
		}
		exactLat, exactLng, perr := domain.ParseExactPoint(plain)
		if perr != nil {
			// Corruption, not a key failure. The coarse geometry is still a
			// usable point, so degrade rather than fail the job creation.
			slog.Warn("create job: property location_encrypted is malformed; falling back to coarse geometry",
				"property_id", input.PropertyID,
				"error", perr,
			)
		} else {
			lat, lng = exactLat, exactLng
		}
	}

	// Override with direct location fields if provided (no property linked).
	if input.LocationAddress != "" && addr == "" {
		addr = input.LocationAddress
	}
	if input.LocationLat != nil && lat == 0.0 {
		lat = *input.LocationLat
	}
	if input.LocationLng != nil && lng == 0.0 {
		lng = *input.LocationLng
	}

	auctionType := input.AuctionType
	if auctionType == "" {
		auctionType = "sealed"
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

	// ── At-rest PII for the two customer-home columns (migration 104) ────
	//
	// service_address is the street address of the place the customer LIVES.
	// No index, constraint or predicate references it, so encryption costs no
	// query. EncryptString maps "" to "", which keeps the COALESCE(...,'')
	// reads behaving exactly as before for jobs with no address.
	encAddr, err := r.cipher.EncryptString(addr)
	if err != nil {
		return nil, fmt.Errorf("create job encrypt service_address: %w", err)
	}

	// BOTH geometry columns get the COARSE point. approximate_location is the
	// one projected to GET /api/v1/jobs/map, which is unauthenticated and
	// edge-cached; before 104 this INSERT wrote the exact customer coordinate
	// into it verbatim, publishing home locations to anonymous callers. It
	// must never again be written from an un-coarsened point.
	coarseLat, coarseLng := domain.CoarsenPoint(lat, lng)

	// The exact point survives, encrypted, so the change stays reversible and
	// GetJobLocation keeps its exact match centre. A job with no known
	// location stores NULL rather than the ciphertext of "0,0" — 0,0 is a real
	// place in the Gulf of Guinea and must not be mistaken for one.
	var encLocation *string
	if lat != 0 || lng != 0 {
		sealed, eerr := r.cipher.EncryptString(domain.FormatExactPoint(lat, lng))
		if eerr != nil {
			return nil, fmt.Errorf("create job encrypt service_location: %w", eerr)
		}
		encLocation = &sealed
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
			status, auction_type,
			is_hourly, hourly_rate_cents, same_day_requested,
			service_location_encrypted
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
			$25, $26,
			$27, $28, $29,
			$30
		)
		RETURNING id, created_at, updated_at`,
		input.CustomerID, input.PropertyID, input.Title, input.Description,
		input.CategoryID, input.SubcategoryID, input.ServiceTypeID,
		encAddr, city, state, zip,
		coarseLng, coarseLat,
		input.ScheduleType, input.ScheduledDate, input.ScheduleRangeStart, input.ScheduleRangeEnd,
		input.IsRecurring, recurrenceFreq,
		input.StartingBidCents, input.OfferAcceptedCents,
		durationHours, auctionEndsAt, input.MinProviderRating,
		status, auctionType,
		input.IsHourly, input.HourlyRateCents, input.SameDayRequested,
		encLocation,
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

func (r *PostgresRepository) UpdateJob(ctx context.Context, jobID string, customerID string, input domain.UpdateJobInput) (*domain.Job, error) {
	// Verify job exists, is draft, and is owned by the authenticated caller.
	var currentStatus, ownerID string
	err := r.pool.QueryRow(ctx,
		`SELECT status, customer_id FROM jobs WHERE id = $1 AND deleted_at IS NULL`, jobID).
		Scan(&currentStatus, &ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("update job: %w", domain.ErrJobNotFound)
		}
		return nil, fmt.Errorf("update job get status: %w", err)
	}
	if ownerID != customerID {
		// Return NotFound rather than NotOwner to avoid confirming existence.
		return nil, fmt.Errorf("update job: %w", domain.ErrJobNotFound)
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
	if input.IsHourly != nil {
		setClauses = append(setClauses, fmt.Sprintf("is_hourly = $%d", argIdx))
		args = append(args, *input.IsHourly)
		argIdx++
	}
	if input.HourlyRateCents != nil {
		setClauses = append(setClauses, fmt.Sprintf("hourly_rate_cents = $%d", argIdx))
		args = append(args, *input.HourlyRateCents)
		argIdx++
	}
	if input.SameDayRequested != nil {
		setClauses = append(setClauses, fmt.Sprintf("same_day_requested = $%d", argIdx))
		args = append(args, *input.SameDayRequested)
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

func (r *PostgresRepository) DeleteDraft(ctx context.Context, jobID string, customerID string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE jobs SET deleted_at = now()
		 WHERE id = $1 AND customer_id = $2 AND status = 'draft' AND deleted_at IS NULL`,
		jobID, customerID)
	if err != nil {
		return fmt.Errorf("delete draft: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Distinguish not-found / not-owner / not-draft. We return NotFound when the
		// authenticated caller is not the owner to avoid confirming the job's existence.
		var ownerID, status string
		err := r.pool.QueryRow(ctx,
			`SELECT customer_id, status FROM jobs WHERE id = $1 AND deleted_at IS NULL`, jobID).
			Scan(&ownerID, &status)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("delete draft: %w", domain.ErrJobNotFound)
			}
			return fmt.Errorf("delete draft check: %w", err)
		}
		if ownerID != customerID {
			return fmt.Errorf("delete draft: %w", domain.ErrJobNotFound)
		}
		return fmt.Errorf("delete draft: %w", domain.ErrNotDraft)
	}
	return nil
}

func (r *PostgresRepository) PublishJob(ctx context.Context, jobID string, customerID string) (*domain.Job, error) {
	// Load current duration and verify ownership + existence in one query.
	var durationHours int
	var ownerID string
	err := r.pool.QueryRow(ctx,
		`SELECT auction_duration_hours, customer_id FROM jobs WHERE id = $1 AND deleted_at IS NULL`, jobID).
		Scan(&durationHours, &ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("publish job: %w", domain.ErrJobNotFound)
		}
		return nil, fmt.Errorf("publish job get duration: %w", err)
	}
	if ownerID != customerID {
		return nil, fmt.Errorf("publish job: %w", domain.ErrJobNotFound)
	}
	if durationHours <= 0 {
		durationHours = 72
	}
	auctionEndsAt := time.Now().Add(time.Duration(durationHours) * time.Hour)

	tag, err := r.pool.Exec(ctx,
		`UPDATE jobs SET status = 'active', auction_ends_at = $1, updated_at = now()
		 WHERE id = $2 AND customer_id = $3 AND status = 'draft' AND deleted_at IS NULL`,
		auctionEndsAt, jobID, customerID)
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

// categorySubtreeFilter builds a WHERE fragment that matches any job whose
// category, subcategory, or service-type column falls anywhere within the
// subtree(s) rooted at the supplied category ids. A recursive CTE expands each
// id to itself plus all descendants, so filtering by a top-level category (e.g.
// the `legal` root) correctly includes jobs filed under its children (matter
// types like Consultation / Contract Review). Without this expansion an exact
// `IN` match silently drops child-categorized jobs — see the legal landing's
// "Open legal cases" query, which filters by the legal subtree root.
//
// It returns the SQL clause, the positional args to append, and the next free
// placeholder index. startIdx is the first placeholder number to use.
func categorySubtreeFilter(categoryIDs []string, startIdx int) (string, []interface{}, int) {
	placeholders := make([]string, len(categoryIDs))
	args := make([]interface{}, len(categoryIDs))
	argIdx := startIdx
	for i, catID := range categoryIDs {
		placeholders[i] = fmt.Sprintf("$%d", argIdx)
		args[i] = catID
		argIdx++
	}
	ph := strings.Join(placeholders, ",")
	// A correlated EXISTS over a recursive expansion of the requested category
	// ids. The recursive CTE yields each requested id plus all descendants, and
	// the row matches if any of the job's three category columns is in that set.
	// This makes a top-level filter (e.g. the legal root) include child-filed
	// jobs, which an exact IN match would drop.
	clause := fmt.Sprintf(
		`EXISTS (
			WITH RECURSIVE cat_subtree AS (
				SELECT id FROM service_categories WHERE id IN (%s)
				UNION ALL
				SELECT sc.id FROM service_categories sc
				JOIN cat_subtree cs ON sc.parent_id = cs.id
			)
			SELECT 1 FROM cat_subtree
			WHERE cat_subtree.id IN (j.category_id, j.subcategory_id, j.service_type_id)
		)`, ph)
	return clause, args, argIdx
}

func (r *PostgresRepository) SearchJobs(ctx context.Context, input domain.SearchJobsInput) ([]*domain.Job, *domain.Pagination, error) {
	// Build the query dynamically.
	where := []string{"j.status = 'active'", "j.deleted_at IS NULL"}
	args := []interface{}{}
	argIdx := 1

	if len(input.CategoryIDs) > 0 {
		clause, clauseArgs, next := categorySubtreeFilter(input.CategoryIDs, argIdx)
		where = append(where, clause)
		args = append(args, clauseArgs...)
		argIdx = next
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

	// FR-10.7: when geo-scoped, project distance_km from coarse approximate_location.
	distanceSelect := "NULL::float8 AS distance_km"
	if input.Latitude != 0 && input.Longitude != 0 {
		distanceSelect = fmt.Sprintf(
			"ST_Distance(j.approximate_location::geography, ST_SetSRID(ST_MakePoint($%d, $%d), 4326)::geography) / 1000.0 AS distance_km",
			argIdx, argIdx+1,
		)
		args = append(args, input.Longitude, input.Latitude)
		argIdx += 2
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
		       COALESCE(j.auction_type, ''), j.snipe_extension_count, j.original_auction_ends_at,
		       j.awarded_at, j.closed_at, j.completed_at, j.cancelled_at,
		       j.created_at, j.updated_at, j.deleted_at,
		       j.is_hourly, j.hourly_rate_cents, j.same_day_requested,
		       COALESCE(c.name, ''), COALESCE(c.slug, ''), COALESCE(c.icon, ''),
		       %s
		FROM jobs j
		LEFT JOIN service_categories c ON c.id = j.category_id
		WHERE %s
		ORDER BY %s
		LIMIT $%d OFFSET $%d`,
		distanceSelect, whereClause, orderBy, argIdx, argIdx+1)

	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("search jobs query: %w", err)
	}
	defer rows.Close()

	var jobs []*domain.Job
	for rows.Next() {
		job, err := scanJobRow(rows, r.cipher)
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

func (r *PostgresRepository) GetJobsOnMap(ctx context.Context, input domain.GetJobsOnMapInput) ([]domain.JobMapPin, error) {
	where := []string{"j.status = 'active'", "j.deleted_at IS NULL", "j.approximate_location IS NOT NULL"}
	args := []interface{}{}
	argIdx := 1

	if input.Latitude != 0 && input.Longitude != 0 && input.RadiusKm > 0 {
		radiusMeters := input.RadiusKm * 1000
		where = append(where, fmt.Sprintf(
			"ST_DWithin(j.approximate_location::geography, ST_SetSRID(ST_MakePoint($%d, $%d), 4326)::geography, $%d)",
			argIdx, argIdx+1, argIdx+2))
		args = append(args, input.Longitude, input.Latitude, radiusMeters)
		argIdx += 3
	}

	if len(input.CategoryIDs) > 0 {
		clause, clauseArgs, next := categorySubtreeFilter(input.CategoryIDs, argIdx)
		where = append(where, clause)
		args = append(args, clauseArgs...)
		argIdx = next
	}

	if input.MaxPriceCents != nil {
		where = append(where, fmt.Sprintf("j.starting_bid_cents <= $%d", argIdx))
		args = append(args, *input.MaxPriceCents)
		argIdx++
	}

	whereClause := strings.Join(where, " AND ")

	query := fmt.Sprintf(`
		SELECT j.id, ST_Y(j.approximate_location::geometry) AS lat, ST_X(j.approximate_location::geometry) AS lng,
		       j.title, COALESCE(c.name, ''), j.starting_bid_cents, j.bid_count, j.auction_ends_at
		FROM jobs j
		LEFT JOIN service_categories c ON c.id = j.category_id
		WHERE %s
		ORDER BY j.created_at DESC
		LIMIT 500`, whereClause)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("get jobs on map query: %w", err)
	}
	defer rows.Close()

	var pins []domain.JobMapPin
	for rows.Next() {
		var pin domain.JobMapPin
		if err := rows.Scan(
			&pin.JobID, &pin.Latitude, &pin.Longitude,
			&pin.Title, &pin.CategoryName, &pin.StartingBidCents,
			&pin.BidCount, &pin.AuctionEndsAt,
		); err != nil {
			return nil, fmt.Errorf("get jobs on map scan: %w", err)
		}
		pins = append(pins, pin)
	}

	return pins, nil
}

func (r *PostgresRepository) ListCustomerJobs(ctx context.Context, customerID string, filter domain.ListCustomerJobsFilter, page, pageSize int) ([]*domain.Job, *domain.Pagination, error) {
	where := []string{"j.customer_id = $1", "j.deleted_at IS NULL"}
	args := []interface{}{customerID}
	argIdx := 2

	if filter.StatusFilter != nil && *filter.StatusFilter != "" {
		where = append(where, fmt.Sprintf("j.status = $%d", argIdx))
		args = append(args, *filter.StatusFilter)
		argIdx++
	}
	if filter.PropertyID != nil && *filter.PropertyID != "" {
		where = append(where, fmt.Sprintf("j.property_id = $%d", argIdx))
		args = append(args, *filter.PropertyID)
		argIdx++
	}
	if filter.CategoryID != nil && *filter.CategoryID != "" {
		where = append(where, fmt.Sprintf("j.category_id = $%d", argIdx))
		args = append(args, *filter.CategoryID)
		argIdx++
	}
	if filter.DateFrom != nil {
		where = append(where, fmt.Sprintf("j.created_at >= $%d", argIdx))
		args = append(args, *filter.DateFrom)
		argIdx++
	}
	if filter.DateTo != nil {
		where = append(where, fmt.Sprintf("j.created_at <= $%d", argIdx))
		args = append(args, *filter.DateTo)
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
		       COALESCE(j.auction_type, ''), j.snipe_extension_count, j.original_auction_ends_at,
		       j.awarded_at, j.closed_at, j.completed_at, j.cancelled_at,
		       j.created_at, j.updated_at, j.deleted_at,
		       j.is_hourly, j.hourly_rate_cents, j.same_day_requested,
		       COALESCE(c.name, ''), COALESCE(c.slug, ''), COALESCE(c.icon, ''),
		       NULL::float8 AS distance_km
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
		job, err := scanJobRow(rows, r.cipher)
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
		       COALESCE(j.auction_type, ''), j.snipe_extension_count, j.original_auction_ends_at,
		       j.awarded_at, j.closed_at, j.completed_at, j.cancelled_at,
		       j.created_at, j.updated_at, j.deleted_at,
		       j.is_hourly, j.hourly_rate_cents, j.same_day_requested,
		       COALESCE(c.name, ''), COALESCE(c.slug, ''), COALESCE(c.icon, ''),
		       NULL::float8 AS distance_km
		FROM jobs j
		LEFT JOIN service_categories c ON c.id = j.category_id
		WHERE j.customer_id = $1 AND j.status = 'draft' AND j.deleted_at IS NULL
		ORDER BY j.updated_at DESC
		LIMIT 50`, customerID)
	if err != nil {
		return nil, fmt.Errorf("list drafts: %w", err)
	}
	defer rows.Close()

	var jobs []*domain.Job
	for rows.Next() {
		job, err := scanJobRow(rows, r.cipher)
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

// AdminListJobs lists jobs for admin with optional filters.
func (r *PostgresRepository) AdminListJobs(ctx context.Context, statusFilter *string, categoryID *string, customerID *string, page, pageSize int) ([]*domain.Job, *domain.Pagination, error) {
	where := []string{"j.deleted_at IS NULL"}
	args := []interface{}{}
	argIdx := 1

	if statusFilter != nil && *statusFilter != "" {
		where = append(where, fmt.Sprintf("j.status = $%d", argIdx))
		args = append(args, *statusFilter)
		argIdx++
	}
	if categoryID != nil && *categoryID != "" {
		where = append(where, fmt.Sprintf("(j.category_id = $%d OR j.subcategory_id = $%d OR j.service_type_id = $%d)", argIdx, argIdx, argIdx))
		args = append(args, *categoryID)
		argIdx++
	}
	if customerID != nil && *customerID != "" {
		where = append(where, fmt.Sprintf("j.customer_id = $%d", argIdx))
		args = append(args, *customerID)
		argIdx++
	}

	whereClause := strings.Join(where, " AND ")

	var totalCount int
	err := r.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM jobs j WHERE %s`, whereClause), args...).Scan(&totalCount)
	if err != nil {
		return nil, nil, fmt.Errorf("admin list jobs count: %w", err)
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
		       COALESCE(j.auction_type, ''), j.snipe_extension_count, j.original_auction_ends_at,
		       j.awarded_at, j.closed_at, j.completed_at, j.cancelled_at,
		       j.created_at, j.updated_at, j.deleted_at,
		       j.is_hourly, j.hourly_rate_cents, j.same_day_requested,
		       COALESCE(c.name, ''), COALESCE(c.slug, ''), COALESCE(c.icon, ''),
		       NULL::float8 AS distance_km
		FROM jobs j
		LEFT JOIN service_categories c ON c.id = j.category_id
		WHERE %s
		ORDER BY j.created_at DESC
		LIMIT $%d OFFSET $%d`,
		whereClause, argIdx, argIdx+1)
	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("admin list jobs query: %w", err)
	}
	defer rows.Close()

	var jobs []*domain.Job
	for rows.Next() {
		job, err := scanJobRow(rows, r.cipher)
		if err != nil {
			return nil, nil, fmt.Errorf("admin list jobs scan: %w", err)
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

// AdminSuspendJob sets a job's status to 'suspended'.
func (r *PostgresRepository) AdminSuspendJob(ctx context.Context, jobID, reason string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE jobs SET status = 'suspended', updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL AND status NOT IN ('suspended', 'cancelled')`,
		jobID)
	if err != nil {
		return fmt.Errorf("admin suspend job: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		_ = r.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM jobs WHERE id = $1 AND deleted_at IS NULL)`, jobID).Scan(&exists)
		if !exists {
			return fmt.Errorf("admin suspend job: %w", domain.ErrJobNotFound)
		}
		return fmt.Errorf("admin suspend job: %w", domain.ErrInvalidStatus)
	}
	return nil
}

// AdminRemoveJob sets a job's status to 'cancelled' (soft removal by admin).
func (r *PostgresRepository) AdminRemoveJob(ctx context.Context, jobID, reason string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE jobs SET status = 'cancelled', cancelled_at = now(), updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL AND status != 'cancelled'`,
		jobID)
	if err != nil {
		return fmt.Errorf("admin remove job: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		_ = r.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM jobs WHERE id = $1 AND deleted_at IS NULL)`, jobID).Scan(&exists)
		if !exists {
			return fmt.Errorf("admin remove job: %w", domain.ErrJobNotFound)
		}
		return fmt.Errorf("admin remove job: %w", domain.ErrInvalidStatus)
	}
	return nil
}

// InsertAuditLog records an admin action in the admin_audit_log table.
func (r *PostgresRepository) InsertAuditLog(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any) error {
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("insert audit log marshal details: %w", err)
	}

	_, err = r.pool.Exec(ctx,
		`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
		 VALUES ($1, $2, $3, $4, $5)`,
		adminID, action, targetType, targetID, detailsJSON)
	if err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func (r *PostgresRepository) CountDrafts(ctx context.Context, customerID string) (int, error) {
	var count int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM jobs WHERE customer_id = $1 AND status = 'draft' AND deleted_at IS NULL`,
		customerID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count drafts: %w", err)
	}
	return count, nil
}

func (r *PostgresRepository) RepostJob(ctx context.Context, originalJobID string, input domain.CreateJobInput) (*domain.Job, error) {
	// Set the reposted_from_id in the input before creating.
	// We use CreateJob and then update the reposted_from_id because CreateJob
	// doesn't directly accept that field.
	job, err := r.CreateJob(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("repost job create: %w", err)
	}

	// Set reposted_from_id on the new job.
	_, err = r.pool.Exec(ctx,
		`UPDATE jobs SET reposted_from_id = $1, updated_at = now() WHERE id = $2`,
		originalJobID, job.ID)
	if err != nil {
		return nil, fmt.Errorf("repost job set parent: %w", err)
	}

	return r.GetJob(ctx, job.ID)
}

func (r *PostgresRepository) IncrementRepostCount(ctx context.Context, jobID string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE jobs SET repost_count = repost_count + 1, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
		jobID)
	if err != nil {
		return fmt.Errorf("increment repost count: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("increment repost count: %w", domain.ErrJobNotFound)
	}
	return nil
}

func (r *PostgresRepository) AwardJob(ctx context.Context, jobID, customerID, providerID, bidID string) (*domain.Job, error) {
	now := time.Now()
	tag, err := r.pool.Exec(ctx,
		`UPDATE jobs SET status = 'awarded',
		        awarded_provider_id = $1, awarded_bid_id = $2, awarded_at = $3,
		        updated_at = now()
		 WHERE id = $4 AND customer_id = $5
		   AND status IN ('active', 'closed') AND deleted_at IS NULL`,
		providerID, bidID, now, jobID, customerID)
	if err != nil {
		return nil, fmt.Errorf("award job: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var job domain.Job
		err := r.pool.QueryRow(ctx,
			`SELECT customer_id, status FROM jobs WHERE id = $1 AND deleted_at IS NULL`, jobID).
			Scan(&job.CustomerID, &job.Status)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("award job: %w", domain.ErrJobNotFound)
			}
			return nil, fmt.Errorf("award job check: %w", err)
		}
		if job.CustomerID != customerID {
			return nil, fmt.Errorf("award job: %w", domain.ErrNotOwner)
		}
		return nil, fmt.Errorf("award job: %w", domain.ErrInvalidStatus)
	}
	return r.GetJob(ctx, jobID)
}

func (r *PostgresRepository) MarkReviewed(ctx context.Context, jobID string) (*domain.Job, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE jobs SET status = 'reviewed', updated_at = now()
		 WHERE id = $1 AND status = 'completed' AND deleted_at IS NULL`,
		jobID)
	if err != nil {
		return nil, fmt.Errorf("mark reviewed: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		_ = r.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM jobs WHERE id = $1 AND deleted_at IS NULL)`, jobID).Scan(&exists)
		if !exists {
			return nil, fmt.Errorf("mark reviewed: %w", domain.ErrJobNotFound)
		}
		return nil, fmt.Errorf("mark reviewed: %w", domain.ErrNotCompleted)
	}
	return r.GetJob(ctx, jobID)
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
		       COALESCE(j.auction_type, ''), j.snipe_extension_count, j.original_auction_ends_at,
		       j.awarded_at, j.closed_at, j.completed_at, j.cancelled_at,
		       j.created_at, j.updated_at, j.deleted_at,
		       j.is_hourly, j.hourly_rate_cents, j.same_day_requested,
		       COALESCE(c.name, ''), COALESCE(c.slug, ''), COALESCE(c.icon, ''),
		       COALESCE(sc.id::text, ''), COALESCE(sc.name, ''), COALESCE(sc.slug, ''), COALESCE(sc.icon, ''),
		       COALESCE(st.id::text, ''), COALESCE(st.name, ''), COALESCE(st.slug, ''), COALESCE(st.icon, '')
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
		&j.AuctionType, &j.SnipeExtensionCount, &j.OriginalAuctionEndsAt,
		&j.AwardedAt, &j.ClosedAt, &j.CompletedAt, &j.CancelledAt,
		&j.CreatedAt, &j.UpdatedAt, &j.DeletedAt,
		&j.IsHourly, &j.HourlyRateCents, &j.SameDayRequested,
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
		plain, derr := r.cipher.DecryptStringOrPassthrough(serviceAddress)
		if derr != nil {
			return nil, fmt.Errorf("get job decrypt service_address: %w", derr)
		}
		j.ServiceAddress = plain
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

// scanJobRow scans a job from a row that includes category name, slug, icon,
// and optional distance_km at the end. Every caller SELECT must end with
// `NULL::float8 AS distance_km` or a real ST_Distance expression (SearchJobs
// when geo-scoped). FR-10.7.
//
// cipher decrypts jobs.service_address (migration 104). Detection is per VALUE,
// not per row: `jobs` deliberately carries no pii_encrypted_v1 flag, because a
// row flag over per-column encryption is exactly the drift bug migration 098
// exists to document. DecryptStringOrPassthrough gives the three outcomes —
// opens, legacy plaintext passes through, and secretbox-shaped-but-unopenable
// escalates rather than leaking raw base64 to a caller.
func scanJobRow(rows pgx.Rows, cipher *crypto.Cipher) (*domain.Job, error) {
	var j domain.Job
	var propertyID, subcategoryID, serviceTypeID, serviceAddress string
	var awardedProviderID, awardedBidID, repostedFromID string
	var recurrenceFrequency *string
	var catName, catSlug, catIcon string
	var distanceKm *float64

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
		&j.AuctionType, &j.SnipeExtensionCount, &j.OriginalAuctionEndsAt,
		&j.AwardedAt, &j.ClosedAt, &j.CompletedAt, &j.CancelledAt,
		&j.CreatedAt, &j.UpdatedAt, &j.DeletedAt,
		&j.IsHourly, &j.HourlyRateCents, &j.SameDayRequested,
		&catName, &catSlug, &catIcon,
		&distanceKm,
	)
	if err != nil {
		return nil, err
	}
	j.DistanceKm = distanceKm

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
		plain, derr := cipher.DecryptStringOrPassthrough(serviceAddress)
		if derr != nil {
			return nil, fmt.Errorf("decrypt service_address: %w", derr)
		}
		j.ServiceAddress = plain
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
