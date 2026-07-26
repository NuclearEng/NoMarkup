//go:build dbtest

// DB-backed round-trip tests for the jobs PII-at-rest columns added by
// migration 104: jobs.service_address (a CUSTOMER HOME address), the coarsened
// service_location / approximate_location geometries, and the encrypted exact
// point in service_location_encrypted.
//
// These tests seed their own rows, so they need only a migrated database — no
// `make seed`, no `make encrypt-pii`. Point them at a SCRATCH database:
//
//	createdb nm_scratch_job
//	migrate -path database/migrations -database "postgres://.../nm_scratch_job?sslmode=disable" up
//	cd services/job && DATABASE_URL="postgres://.../nm_scratch_job?sslmode=disable" \
//	  ENCRYPTION_KEY=$(openssl rand -base64 32) go test -tags=dbtest ./internal/repository/...
package repository

import (
	"context"
	"encoding/base64"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/job/internal/crypto"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

const (
	// A real Austin address/coordinate pair: the point is deliberately NOT on
	// the 0.01-degree grid, so coarsening it is observable.
	piiTestAddress = "1100 Congress Ave, Austin, TX 78701"
	piiTestLat     = 30.2747
	piiTestLng     = -97.7404
)

// newPIITestRepo builds a repository against $DATABASE_URL with the cipher the
// runtime uses. The test name is prefixed to keep it distinct from the
// integration-tagged helpers in this package, which are compiled under a
// different build tag but would otherwise collide if both tags were set.
func newPIITestRepo(t *testing.T) *PostgresRepository {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set; skipping db-backed test")
	}
	cipher, err := crypto.FromEnv()
	if err != nil {
		t.Fatalf("crypto.FromEnv: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	return NewPostgresRepository(pool, cipher)
}

// seedCustomer inserts a throwaway customer and returns its id.
func seedCustomer(t *testing.T, repo *PostgresRepository, email string) string {
	t.Helper()
	ctx := context.Background()
	var userID string
	if err := repo.pool.QueryRow(ctx,
		`INSERT INTO users (email, display_name, roles)
		 VALUES ($1, 'Jobs PII Test Customer', ARRAY['customer']) RETURNING id::text`,
		email,
	).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = repo.pool.Exec(context.Background(), `DELETE FROM jobs WHERE customer_id::text = $1`, userID)
		_, _ = repo.pool.Exec(context.Background(), `DELETE FROM users WHERE id::text = $1`, userID)
	})
	return userID
}

// anyCategoryID returns a taxonomy id (seeded by migration 002) to satisfy the
// NOT NULL FK on jobs.category_id.
func anyCategoryID(t *testing.T, repo *PostgresRepository) string {
	t.Helper()
	var id string
	if err := repo.pool.QueryRow(context.Background(),
		`SELECT id::text FROM service_categories LIMIT 1`).Scan(&id); err != nil {
		t.Fatalf("need service_categories taxonomy (run migrations): %v", err)
	}
	return id
}

// rawJobPII reads the four at-rest columns straight off disk, bypassing every
// decryption and coarsening path.
func rawJobPII(t *testing.T, repo *PostgresRepository, jobID string) (addr string, encLocation *string, svcLat, svcLng, apxLat, apxLng float64) {
	t.Helper()
	if err := repo.pool.QueryRow(context.Background(), `
		SELECT COALESCE(service_address, ''), service_location_encrypted,
		       ST_Y(service_location), ST_X(service_location),
		       ST_Y(approximate_location), ST_X(approximate_location)
		  FROM jobs WHERE id::text = $1`, jobID,
	).Scan(&addr, &encLocation, &svcLat, &svcLng, &apxLat, &apxLng); err != nil {
		t.Fatalf("raw select: %v", err)
	}
	return
}

// seedLegacyJob inserts a job the way the pre-104 write path did: literal
// plaintext address, EXACT point in both geometry columns, NULL
// service_location_encrypted.
func seedLegacyJob(t *testing.T, repo *PostgresRepository, customerID, categoryID, addr string, lat, lng float64) string {
	t.Helper()
	var jobID string
	if err := repo.pool.QueryRow(context.Background(), `
		INSERT INTO jobs (customer_id, title, description, category_id,
			service_address, service_city, service_state, service_zip,
			service_location, approximate_location, status)
		VALUES ($1, 'Legacy pre-104 job', 'Seeded by jobs_pii_db_test.', $2,
			NULLIF($3, ''), 'Austin', 'TX', '78701',
			ST_SetSRID(ST_MakePoint($4, $5), 4326),
			ST_SetSRID(ST_MakePoint($4, $5), 4326),
			'active')
		RETURNING id::text`,
		customerID, categoryID, addr, lng, lat,
	).Scan(&jobID); err != nil {
		t.Fatalf("seed legacy job: %v", err)
	}
	return jobID
}

func createTestJob(t *testing.T, repo *PostgresRepository, customerID, categoryID string) *domain.Job {
	t.Helper()
	return createTestJobAt(t, repo, customerID, categoryID, piiTestLat, piiTestLng)
}

func createTestJobAt(t *testing.T, repo *PostgresRepository, customerID, categoryID string, lat, lng float64) *domain.Job {
	t.Helper()
	job, err := repo.CreateJob(context.Background(), domain.CreateJobInput{
		CustomerID:      customerID,
		Title:           "Jobs PII round trip",
		Description:     "Created by jobs_pii_db_test.",
		CategoryID:      categoryID,
		ScheduleType:    "flexible",
		LocationAddress: piiTestAddress,
		LocationLat:     &lat,
		LocationLng:     &lng,
		Publish:         true,
	})
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	return job
}

// TestJobServiceAddressWriteEncryptsReadDecrypts is the core round trip: write
// plaintext through the repository, prove the COLUMN holds ciphertext, prove
// BOTH scanners hand plaintext back.
func TestJobServiceAddressWriteEncryptsReadDecrypts(t *testing.T) {
	t.Parallel()
	repo := newPIITestRepo(t)
	ctx := context.Background()
	customerID := seedCustomer(t, repo, "jobs-pii-write@example.com")
	categoryID := anyCategoryID(t, repo)

	job := createTestJob(t, repo, customerID, categoryID)

	// 1. The write path returns plaintext to the caller.
	if job.ServiceAddress != piiTestAddress {
		t.Errorf("CreateJob returned service_address = %q, want %q", job.ServiceAddress, piiTestAddress)
	}

	// 2. The COLUMN holds ciphertext. This is the assertion that fails if the
	//    runtime encryption path regresses: an operator with raw DB access must
	//    never see where the customer lives.
	rawAddr, _, _, _, _, _ := rawJobPII(t, repo, job.ID)
	if rawAddr == piiTestAddress {
		t.Fatalf("service_address: PLAINTEXT on disk (%q)", rawAddr)
	}
	if !crypto.LooksLikeCiphertext(rawAddr) {
		t.Errorf("service_address: on-disk value %q is not secretbox-shaped", rawAddr)
	}
	if _, err := base64.StdEncoding.DecodeString(rawAddr); err != nil {
		t.Errorf("service_address: on-disk value is not base64: %v", err)
	}

	// 3a. scanJobWithCategories (GetJob / GetJobDetail / PublishJob / ...).
	got, err := repo.GetJob(ctx, job.ID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if got.ServiceAddress != piiTestAddress {
		t.Errorf("GetJob service_address = %q, want %q", got.ServiceAddress, piiTestAddress)
	}

	// 3b. scanJobRow (SearchJobs / ListCustomerJobs / ListDrafts / AdminListJobs).
	//     The two scanners are separate code paths over the same column, and a
	//     fix applied to only one of them is the exact regression this covers.
	listed, _, err := repo.ListCustomerJobs(ctx, customerID, nil, nil, 1, 20)
	if err != nil {
		t.Fatalf("ListCustomerJobs: %v", err)
	}
	found := false
	for _, j := range listed {
		if j.ID == job.ID {
			found = true
			if j.ServiceAddress != piiTestAddress {
				t.Errorf("ListCustomerJobs service_address = %q, want %q", j.ServiceAddress, piiTestAddress)
			}
		}
	}
	if !found {
		t.Errorf("ListCustomerJobs did not return job %s", job.ID)
	}
}

// TestJobServiceAddressLegacyPlaintextPassesThrough covers the mixed state: a
// row written before 104 must still read back as its plaintext rather than
// erroring or returning garbage. Detection is per VALUE — there is no
// pii_encrypted_v1 flag on this table to consult.
func TestJobServiceAddressLegacyPlaintextPassesThrough(t *testing.T) {
	t.Parallel()
	repo := newPIITestRepo(t)
	ctx := context.Background()
	customerID := seedCustomer(t, repo, "jobs-pii-legacy@example.com")
	categoryID := anyCategoryID(t, repo)

	jobID := seedLegacyJob(t, repo, customerID, categoryID, piiTestAddress, piiTestLat, piiTestLng)

	// Precondition: the column really is literal plaintext on disk.
	rawAddr, encLocation, _, _, _, _ := rawJobPII(t, repo, jobID)
	if rawAddr != piiTestAddress {
		t.Fatalf("precondition: seeded address should be plaintext, got %q", rawAddr)
	}
	if encLocation != nil {
		t.Fatalf("precondition: legacy row should have NULL service_location_encrypted, got %q", *encLocation)
	}

	got, err := repo.GetJob(ctx, jobID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if got.ServiceAddress != piiTestAddress {
		t.Errorf("legacy service_address = %q, want passthrough %q", got.ServiceAddress, piiTestAddress)
	}

	listed, _, err := repo.ListCustomerJobs(ctx, customerID, nil, nil, 1, 20)
	if err != nil {
		t.Fatalf("ListCustomerJobs: %v", err)
	}
	for _, j := range listed {
		if j.ID == jobID && j.ServiceAddress != piiTestAddress {
			t.Errorf("legacy service_address via scanJobRow = %q, want passthrough %q", j.ServiceAddress, piiTestAddress)
		}
	}
}

// TestJobGeometryIsCoarseButMatchingIsExact is the privacy assertion that
// matters most, because approximate_location is projected to
// GET /api/v1/jobs/map — unauthenticated and edge-cached. Both geometry
// columns must be on the grid; the exact point must survive only in the
// encrypted column, where GetJobLocation finds it.
//
// It is also the parity gate between domain.CoarsenPoint and
// pii_coarsen_point(): every assertion against the grid asks POSTGRESQL for the
// expected value rather than recomputing it in Go, and the comparison is exact
// equality, not a tolerance. pii_exact_geometry_audit (migration 107) decides
// "has this row been coarsened" via ST_Equals(g, pii_coarsen_point(g)), so a
// single ULP of disagreement would make every row this service writes report as
// still-exact forever. The .005 fixture below is the case that disagreed when
// the two sides used different arithmetic (exact decimal vs binary float64).
func TestJobGeometryIsCoarseButMatchingIsExact(t *testing.T) {
	t.Parallel()

	fixtures := []struct {
		name     string
		email    string
		lat, lng float64
	}{
		{
			name:  "ordinary point",
			email: "jobs-pii-geo@example.com",
			lat:   piiTestLat, lng: piiTestLng,
		},
		{
			// Exactly on the .005 half-grid boundary on BOTH axes, at
			// realistic service-address magnitudes. 30.265/0.01 is 3026.5 in
			// float64 and rounds up; -97.745/0.01 is -9774.5 and rounds away
			// from zero. An implementation that rounded in exact decimal, or
			// that normalised the multiply residue afterwards, breaks here and
			// nowhere else in this file.
			name:  "half-grid boundary on both axes",
			email: "jobs-pii-geo-boundary@example.com",
			lat:   30.265, lng: -97.745,
		},
	}

	for _, f := range fixtures {
		t.Run(f.name, func(t *testing.T) {
			t.Parallel()
			repo := newPIITestRepo(t)
			ctx := context.Background()
			customerID := seedCustomer(t, repo, f.email)
			categoryID := anyCategoryID(t, repo)

			job := createTestJobAt(t, repo, customerID, categoryID, f.lat, f.lng)

			_, encLocation, svcLat, svcLng, apxLat, apxLng := rawJobPII(t, repo, job.ID)

			// 1. Neither geometry column may still hold the exact point.
			for _, c := range []struct {
				name     string
				lat, lng float64
			}{
				{"service_location", svcLat, svcLng},
				{"approximate_location", apxLat, apxLng},
			} {
				if c.lat == f.lat && c.lng == f.lng {
					t.Errorf("%s: EXACT customer point on disk (%v,%v)", c.name, c.lat, c.lng)
				}
			}

			// 2. Both are the SQL function's own image of themselves — i.e.
			//    coarsened, by the exact definition the audit view uses.
			var svcCoarse, apxCoarse bool
			if err := repo.pool.QueryRow(ctx, `
				SELECT ST_Equals(service_location, pii_coarsen_point(service_location)),
				       ST_Equals(approximate_location, pii_coarsen_point(approximate_location))
				  FROM jobs WHERE id::text = $1`, job.ID,
			).Scan(&svcCoarse, &apxCoarse); err != nil {
				t.Fatalf("pii_coarsen_point check: %v", err)
			}
			if !svcCoarse {
				t.Errorf("service_location (%v,%v) is not its own pii_coarsen_point image", svcLat, svcLng)
			}
			if !apxCoarse {
				t.Errorf("approximate_location (%v,%v) is not its own pii_coarsen_point image", apxLat, apxLng)
			}

			// 3. Go and SQL produce the BIT-IDENTICAL coarse point from the
			//    same exact input.
			wantLat, wantLng := domain.CoarsenPoint(f.lat, f.lng)
			var sqlLat, sqlLng float64
			if err := repo.pool.QueryRow(ctx, `
				SELECT ST_Y(pii_coarsen_point(ST_SetSRID(ST_MakePoint($1, $2), 4326))),
				       ST_X(pii_coarsen_point(ST_SetSRID(ST_MakePoint($1, $2), 4326)))`,
				f.lng, f.lat,
			).Scan(&sqlLat, &sqlLng); err != nil {
				t.Fatalf("pii_coarsen_point(exact): %v", err)
			}
			if sqlLat != wantLat {
				t.Errorf("lat: SQL pii_coarsen_ordinate(%v) = %v, Go domain.CoarsenPoint = %v", f.lat, sqlLat, wantLat)
			}
			if sqlLng != wantLng {
				t.Errorf("lng: SQL pii_coarsen_ordinate(%v) = %v, Go domain.CoarsenPoint = %v", f.lng, sqlLng, wantLng)
			}
			if svcLat != wantLat || svcLng != wantLng {
				t.Errorf("stored service_location = (%v,%v), want the coarse point (%v,%v)", svcLat, svcLng, wantLat, wantLng)
			}
			if apxLat != wantLat || apxLng != wantLng {
				t.Errorf("stored approximate_location = (%v,%v), want the coarse point (%v,%v)", apxLat, apxLng, wantLat, wantLng)
			}

			// 4. The exact point survives encrypted, and nothing about it is
			//    readable off disk.
			if encLocation == nil || *encLocation == "" {
				t.Fatal("service_location_encrypted is NULL; the exact point was destroyed")
			}
			if !crypto.LooksLikeCiphertext(*encLocation) {
				t.Errorf("service_location_encrypted %q is not secretbox-shaped", *encLocation)
			}
			if *encLocation == domain.FormatExactPoint(f.lat, f.lng) {
				t.Error("service_location_encrypted holds the point in CLEAR")
			}

			// 5. Provider matching still gets the exact centre — bit-identical
			//    to the pre-104 behaviour.
			gotLat, gotLng, err := repo.GetJobLocation(ctx, job.ID)
			if err != nil {
				t.Fatalf("GetJobLocation: %v", err)
			}
			if gotLat != f.lat || gotLng != f.lng {
				t.Errorf("GetJobLocation = (%v,%v), want the EXACT (%v,%v)", gotLat, gotLng, f.lat, f.lng)
			}
		})
	}
}

// TestCoarsenParityGoVsSQL sweeps the grid arithmetic across both
// implementations directly, without a jobs row in the way. Exact equality on
// every vector, including the .005 boundaries and the "looks like a midpoint
// but binary division says otherwise" cases that a decimal implementation gets
// wrong in the opposite direction.
func TestCoarsenParityGoVsSQL(t *testing.T) {
	t.Parallel()
	repo := newPIITestRepo(t)
	ctx := context.Background()

	vectors := []struct {
		name string
		v    float64
	}{
		{"zero", 0},
		{"austin latitude", 30.2672},
		{"austin longitude", -97.7431},
		{"already on grid", 30.27},
		{"already on grid negative", -97.74},
		{"positive half grid", 0.005},
		{"negative half grid", -0.005},
		{"half grid at latitude magnitude", 30.265},
		{"half grid at longitude magnitude", -97.745},
		{"apparent midpoint", 0.145},
		{"apparent midpoint negative", -0.145},
		{"residue producer", 0.35},
		{"southern hemisphere", -33.8688},
		{"eastern hemisphere", 151.2093},
		{"north pole", 90},
		{"antimeridian", -180},
		{"long tail precision", 41.87811234567},
	}

	for _, vec := range vectors {
		t.Run(vec.name, func(t *testing.T) {
			t.Parallel()
			var sqlOut float64
			if err := repo.pool.QueryRow(ctx, `SELECT pii_coarsen_ordinate($1::double precision)`, vec.v).Scan(&sqlOut); err != nil {
				t.Fatalf("pii_coarsen_ordinate(%v): %v", vec.v, err)
			}
			goOut, _ := domain.CoarsenPoint(vec.v, 0)
			if sqlOut != goOut {
				t.Errorf("pii_coarsen_ordinate(%v) = %v, domain.CoarsenPoint = %v (delta %g)",
					vec.v, sqlOut, goOut, sqlOut-goOut)
			}
		})
	}
}

// TestGetJobLocationFallsBackToGeometryForLegacyRows: rows written before 104
// have a NULL service_location_encrypted and still carry an exact point in the
// geometry. Matching must read it rather than returning zero.
func TestGetJobLocationFallsBackToGeometryForLegacyRows(t *testing.T) {
	t.Parallel()
	repo := newPIITestRepo(t)
	ctx := context.Background()
	customerID := seedCustomer(t, repo, "jobs-pii-geo-legacy@example.com")
	categoryID := anyCategoryID(t, repo)

	jobID := seedLegacyJob(t, repo, customerID, categoryID, piiTestAddress, piiTestLat, piiTestLng)

	_, encLocation, svcLat, svcLng, _, _ := rawJobPII(t, repo, jobID)
	if encLocation != nil {
		t.Fatalf("precondition: legacy row must have NULL service_location_encrypted")
	}
	if svcLat != piiTestLat || svcLng != piiTestLng {
		t.Fatalf("precondition: legacy geometry should be exact, got (%v,%v)", svcLat, svcLng)
	}

	gotLat, gotLng, err := repo.GetJobLocation(ctx, jobID)
	if err != nil {
		t.Fatalf("GetJobLocation: %v", err)
	}
	if gotLat != piiTestLat || gotLng != piiTestLng {
		t.Errorf("GetJobLocation = (%v,%v), want the legacy geometry (%v,%v)", gotLat, gotLng, piiTestLat, piiTestLng)
	}
}

// TestJobWithNoLocationStoresNullNotCiphertextOfZero: a job with no known
// coordinate must leave service_location_encrypted NULL. Sealing "0,0" would
// make GetJobLocation confidently return a point in the Gulf of Guinea, which
// matches nothing and looks like data rather than like an absence.
func TestJobWithNoLocationStoresNullNotCiphertextOfZero(t *testing.T) {
	t.Parallel()
	repo := newPIITestRepo(t)
	ctx := context.Background()
	customerID := seedCustomer(t, repo, "jobs-pii-noloc@example.com")
	categoryID := anyCategoryID(t, repo)

	job, err := repo.CreateJob(ctx, domain.CreateJobInput{
		CustomerID:   customerID,
		Title:        "No location",
		Description:  "Created by jobs_pii_db_test.",
		CategoryID:   categoryID,
		ScheduleType: "flexible",
	})
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}

	rawAddr, encLocation, _, _, _, _ := rawJobPII(t, repo, job.ID)
	if encLocation != nil {
		t.Errorf("service_location_encrypted = %q, want NULL for a job with no coordinate", *encLocation)
	}
	// An empty address must stay empty rather than becoming the ciphertext of
	// "", so the COALESCE(service_address,'') reads keep behaving.
	if rawAddr != "" {
		t.Errorf("service_address = %q, want empty for a job with no address", rawAddr)
	}
	if job.ServiceAddress != "" {
		t.Errorf("CreateJob returned service_address = %q, want empty", job.ServiceAddress)
	}
}

// TestJobServiceAddressWrongKeyFailsLoud: a value that IS our wire format but
// opens under no configured key must surface an error, never be handed back as
// base64. Returning the ciphertext is the GDPR-export bug
// DecryptStringOrPassthrough exists to prevent.
func TestJobServiceAddressWrongKeyFailsLoud(t *testing.T) {
	t.Parallel()
	repo := newPIITestRepo(t)
	ctx := context.Background()
	customerID := seedCustomer(t, repo, "jobs-pii-orphan@example.com")
	categoryID := anyCategoryID(t, repo)

	var foreign [crypto.KeySize]byte
	for i := range foreign {
		foreign[i] = byte(i + 1)
	}
	orphan, err := crypto.New(&foreign, nil).EncryptString(piiTestAddress)
	if err != nil {
		t.Fatalf("seal with a foreign key: %v", err)
	}

	jobID := seedLegacyJob(t, repo, customerID, categoryID, orphan, piiTestLat, piiTestLng)

	if got, err := repo.GetJob(ctx, jobID); err == nil {
		t.Fatalf("expected an error for ciphertext no configured key can open; got address %q", got.ServiceAddress)
	} else {
		t.Logf("failed loud as expected: %v", err)
	}

	if _, _, err := repo.ListCustomerJobs(ctx, customerID, nil, nil, 1, 20); err == nil {
		t.Error("expected scanJobRow to fail loud on unopenable ciphertext too")
	}
}

// TestCreateJobFromPropertyDecryptsAddressAndUsesExactPoint covers the
// pre-existing defect this change also fixes: properties.address has been
// secretbox-encrypted since migration 033, so the pre-104 CreateJob copied
// CIPHERTEXT into jobs.service_address, and properties.location is coarsened by
// 105, so the geometry alone would silently downgrade the job's point.
func TestCreateJobFromPropertyDecryptsAddressAndUsesExactPoint(t *testing.T) {
	t.Parallel()
	repo := newPIITestRepo(t)
	ctx := context.Background()
	customerID := seedCustomer(t, repo, "jobs-pii-property@example.com")
	categoryID := anyCategoryID(t, repo)

	cipher, err := crypto.FromEnv()
	if err != nil {
		t.Fatalf("crypto.FromEnv: %v", err)
	}
	const propAddress = "2200 Guadalupe St, Austin, TX 78705"
	encAddr, err := cipher.EncryptString(propAddress)
	if err != nil {
		t.Fatalf("encrypt property address: %v", err)
	}
	encPoint, err := cipher.EncryptString(domain.FormatExactPoint(piiTestLat, piiTestLng))
	if err != nil {
		t.Fatalf("encrypt property point: %v", err)
	}
	// The property is stored the way migrations 033 + 105 leave it: encrypted
	// address, encrypted exact point, COARSE geometry.
	coarseLat, coarseLng := domain.CoarsenPoint(piiTestLat, piiTestLng)

	var propertyID string
	if err := repo.pool.QueryRow(ctx, `
		INSERT INTO properties (user_id, nickname, address, city, state, zip_code, location, location_encrypted)
		VALUES ($1, 'Home', $2, 'Austin', 'TX', '78705',
			ST_SetSRID(ST_MakePoint($3, $4), 4326), $5)
		RETURNING id::text`,
		customerID, encAddr, coarseLng, coarseLat, encPoint,
	).Scan(&propertyID); err != nil {
		t.Fatalf("insert property: %v", err)
	}
	t.Cleanup(func() {
		_, _ = repo.pool.Exec(context.Background(), `DELETE FROM jobs WHERE property_id::text = $1`, propertyID)
		_, _ = repo.pool.Exec(context.Background(), `DELETE FROM properties WHERE id::text = $1`, propertyID)
	})

	job, err := repo.CreateJob(ctx, domain.CreateJobInput{
		CustomerID:   customerID,
		PropertyID:   propertyID,
		Title:        "From property",
		Description:  "Created by jobs_pii_db_test.",
		CategoryID:   categoryID,
		ScheduleType: "flexible",
	})
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}

	// The job's address is the property's PLAINTEXT, re-encrypted under this
	// service's own key — not a double-encrypted copy of the property's
	// ciphertext.
	if job.ServiceAddress != propAddress {
		t.Errorf("job service_address = %q, want the property's plaintext %q", job.ServiceAddress, propAddress)
	}
	rawAddr, encLocation, _, _, _, _ := rawJobPII(t, repo, job.ID)
	if rawAddr == propAddress {
		t.Error("job service_address: PLAINTEXT on disk")
	}
	if rawAddr == encAddr {
		t.Error("job service_address: verbatim copy of the property's ciphertext")
	}
	plain, err := cipher.DecryptString(rawAddr)
	if err != nil {
		t.Fatalf("stored address does not decrypt in one step: %v", err)
	}
	if plain != propAddress {
		t.Errorf("one unseal gives %q, want %q (double encryption?)", plain, propAddress)
	}

	// And the job's exact point came from the property's ENCRYPTED copy, not
	// from its coarsened geometry.
	if encLocation == nil {
		t.Fatal("job service_location_encrypted is NULL")
	}
	gotLat, gotLng, err := repo.GetJobLocation(ctx, job.ID)
	if err != nil {
		t.Fatalf("GetJobLocation: %v", err)
	}
	if gotLat != piiTestLat || gotLng != piiTestLng {
		t.Errorf("GetJobLocation = (%v,%v), want the property's EXACT point (%v,%v); "+
			"got the coarse geometry (%v,%v)?", gotLat, gotLng, piiTestLat, piiTestLng, coarseLat, coarseLng)
	}
}
