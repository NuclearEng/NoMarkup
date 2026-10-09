//go:build dbtest

// DB-backed tests for the migration 104-107 half of the reconciler: the
// customer home address on `jobs`, the DATE columns drained into sibling
// ciphertext columns, the licence number encrypted in place, and — the part
// that cannot be undone if it goes wrong — the exact point geometry.
//
// These drive the REAL SQL in specs and geoSpecs, including the SQL coarsening
// function itself, so they catch the things no pure unit test can: column-list
// drift, a Go/SQL rounding disagreement, and a write ordering that coarsens
// before the ciphertext lands.
//
// They mutate every row in jobs / properties / users / provider_* , so point
// them at a SCRATCH database, never a shared one:
//
//	createdb nm_scratch_enc && migrate -path database/migrations -database ... up
//	ENCRYPT_PII_TEST_DATABASE_URL=postgres://.../nm_scratch_enc \
//	  go test -tags=dbtest ./cmd/encrypt-pii/...
package main

import (
	"context"
	"math"
	"math/rand"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── fixtures ─────────────────────────────────────────────────────────────

const (
	// Deliberately off-grid in both ordinates, so the seeded geometry is
	// "exact" by pii_exact_geometry_audit's definition and the coarsening has
	// somewhere to move it to.
	fixtureLat = 30.2672123
	fixtureLng = -97.7431456

	fixtureJobAddress = "1600 Barton Springs Rd, Austin, TX 78704"
	fixturePropAddr   = "2200 Guadalupe St, Austin, TX 78705"
	fixturePropNotes  = "Gate code 4417, dog in the yard"
	fixtureLicense    = "TX-BAR-1029384"
	fixtureUserDOB    = "1985-03-14"
	fixtureEmpDOB     = "1991-07-22"
)

// countingDB wraps a querier and counts the write statements issued, so a test
// can assert that a repeat run writes NOTHING rather than merely writing the
// same bytes back.
type countingDB struct {
	inner   querier
	execs   int
	stmts   []string
	queries int
}

func (c *countingDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	c.queries++
	return c.inner.Query(ctx, sql, args...)
}

func (c *countingDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	c.execs++
	c.stmts = append(c.stmts, sql)
	return c.inner.Exec(ctx, sql, args...)
}

// anyCategoryID returns a service_categories id; the migrations seed the tree,
// so jobs.category_id has something valid to reference.
func anyCategoryID(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`SELECT id::text FROM service_categories ORDER BY id LIMIT 1`).Scan(&id); err != nil {
		t.Fatalf("service_categories lookup: %v", err)
	}
	return id
}

func seedUser(t *testing.T, pool *pgxpool.Pool, email, phone string, dob *string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, display_name, roles, phone, dob)
		 VALUES ($1, 'Test Customer', ARRAY['customer'], $2, $3::date)
		 RETURNING id::text`,
		email, phone, dob,
	).Scan(&id); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return id
}

// seedJob writes the exact point into BOTH geometry columns, reproducing the
// production write path this work exists to correct.
func seedJob(t *testing.T, pool *pgxpool.Pool, customerID, categoryID, address string, lat, lng float64, enc *string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO jobs (customer_id, title, description, category_id,
		                   service_address, service_city, service_state, service_zip,
		                   service_location, approximate_location,
		                   service_location_encrypted, status)
		 VALUES ($1, 'Fix the sink', 'It leaks.', $2,
		         $3, 'Austin', 'TX', '78704',
		         ST_SetSRID(ST_MakePoint($5, $4), 4326),
		         ST_SetSRID(ST_MakePoint($5, $4), 4326),
		         $6, 'active')
		 RETURNING id::text`,
		customerID, categoryID, address, lat, lng, enc,
	).Scan(&id); err != nil {
		t.Fatalf("insert job: %v", err)
	}
	return id
}

func seedProperty(t *testing.T, pool *pgxpool.Pool, userID, address, notes string, lat, lng float64, enc *string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO properties (user_id, address, city, state, zip_code, location, notes, location_encrypted)
		 VALUES ($1, $2, 'Austin', 'TX', '78705',
		         ST_SetSRID(ST_MakePoint($4, $3), 4326), $5, $6)
		 RETURNING id::text`,
		userID, address, lat, lng, notes, enc,
	).Scan(&id); err != nil {
		t.Fatalf("insert property: %v", err)
	}
	return id
}

func seedLicense(t *testing.T, pool *pgxpool.Pool, providerID, number string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO provider_licenses (provider_id, license_type, license_number, jurisdiction)
		 VALUES ($1, 'bar', $2, 'TX') RETURNING id::text`,
		providerID, number,
	).Scan(&id); err != nil {
		t.Fatalf("insert provider_license: %v", err)
	}
	return id
}

func seedEmployee(t *testing.T, pool *pgxpool.Pool, providerID, email string, dob *string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO provider_employees (provider_id, first_name, last_name, email, role, date_of_birth)
		 VALUES ($1, 'Dana', 'Rivera', $2, 'technician', $3::date) RETURNING id::text`,
		providerID, email, dob,
	).Scan(&id); err != nil {
		t.Fatalf("insert provider_employee: %v", err)
	}
	return id
}

// ── readers ──────────────────────────────────────────────────────────────

type geoState struct {
	enc string
	// lats/lngs are the ordinates of each geometry column, in the order the
	// query lists them.
	lats []float64
	lngs []float64
}

func readJobGeo(t *testing.T, pool *pgxpool.Pool, id string) geoState {
	t.Helper()
	var s geoState
	s.lats = make([]float64, 2)
	s.lngs = make([]float64, 2)
	if err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(service_location_encrypted, ''),
		        ST_Y(service_location), ST_X(service_location),
		        ST_Y(approximate_location), ST_X(approximate_location)
		   FROM jobs WHERE id::text = $1`, id,
	).Scan(&s.enc, &s.lats[0], &s.lngs[0], &s.lats[1], &s.lngs[1]); err != nil {
		t.Fatalf("read job geo: %v", err)
	}
	return s
}

func readPropertyGeo(t *testing.T, pool *pgxpool.Pool, id string) geoState {
	t.Helper()
	var s geoState
	s.lats = make([]float64, 1)
	s.lngs = make([]float64, 1)
	if err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(location_encrypted, ''), ST_Y(location), ST_X(location)
		   FROM properties WHERE id::text = $1`, id,
	).Scan(&s.enc, &s.lats[0], &s.lngs[0]); err != nil {
		t.Fatalf("read property geo: %v", err)
	}
	return s
}

// auditRows returns every outstanding finding from BOTH migration-107 views. A
// finished database yields none.
func auditRows(t *testing.T, pool *pgxpool.Pool) []string {
	t.Helper()
	ctx := context.Background()
	var out []string
	for _, q := range []string{
		`SELECT 'pii_plaintext_audit ' || table_name || '.' || column_name || ' ' || id::text FROM pii_plaintext_audit`,
		`SELECT 'pii_exact_geometry_audit ' || table_name || '.' || column_name || ' ' || id::text FROM pii_exact_geometry_audit`,
	} {
		rows, err := pool.Query(ctx, q)
		if err != nil {
			t.Fatalf("audit query: %v", err)
		}
		for rows.Next() {
			var s string
			if err := rows.Scan(&s); err != nil {
				rows.Close()
				t.Fatalf("audit scan: %v", err)
			}
			out = append(out, s)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			t.Fatalf("audit iter: %v", err)
		}
	}
	return out
}

// seedEverythingPlaintext lays down one row in every table the tool touches,
// each in the state a pre-migration database would be in.
type fullFixture struct {
	userID, jobID, propertyID, licenseID, employeeID string
}

func seedEverythingPlaintext(t *testing.T, pool *pgxpool.Pool) fullFixture {
	t.Helper()
	dobUser, dobEmp := fixtureUserDOB, fixtureEmpDOB
	userID := seedUser(t, pool, "geo-customer@example.com", "512-555-0001", &dobUser)
	return fullFixture{
		userID:     userID,
		jobID:      seedJob(t, pool, userID, anyCategoryID(t, pool), fixtureJobAddress, fixtureLat, fixtureLng, nil),
		propertyID: seedProperty(t, pool, userID, fixturePropAddr, fixturePropNotes, fixtureLat, fixtureLng, nil),
		licenseID:  seedLicense(t, pool, userID, fixtureLicense),
		employeeID: seedEmployee(t, pool, userID, "employee@example.com", &dobEmp),
	}
}

// ── 1. a full run drains both audit views ────────────────────────────────

// TestRunDrainsBothAuditViews is the acceptance test for migrations 104-107:
// one run over a database in the pre-migration state must leave
// pii_plaintext_audit AND pii_exact_geometry_audit empty, with every value
// readable in exactly ONE unseal.
func TestRunDrainsBothAuditViews(t *testing.T) {
	pool := testPool(t)
	reset(t, pool)
	ctx := context.Background()

	key := mustKey(t)
	kr := keyring{primary: key}
	fx := seedEverythingPlaintext(t, pool)

	// Sanity: the fixture must actually be dirty, or a no-op tool would pass.
	if before := auditRows(t, pool); len(before) == 0 {
		t.Fatal("fixture is already clean; the test would prove nothing")
	}

	if err := run(ctx, pool, kr, false); err != nil {
		t.Fatalf("run: %v", err)
	}

	if after := auditRows(t, pool); len(after) != 0 {
		t.Fatalf("audit views are not empty after a full run: %v", after)
	}

	// ── the encrypted-in-place TEXT columns ─────────────────────────────
	var jobAddr, licenseNum string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(j.service_address, ''), l.license_number
		   FROM jobs j, provider_licenses l
		  WHERE j.id::text = $1 AND l.id::text = $2`, fx.jobID, fx.licenseID,
	).Scan(&jobAddr, &licenseNum); err != nil {
		t.Fatalf("read text columns: %v", err)
	}
	for _, c := range []struct{ name, stored, want string }{
		{"jobs.service_address", jobAddr, fixtureJobAddress},
		{"provider_licenses.license_number", licenseNum, fixtureLicense},
	} {
		if c.stored == c.want {
			t.Errorf("%s: still PLAINTEXT on disk", c.name)
			continue
		}
		if got, ok := open(key, c.stored); !ok || got != c.want {
			t.Errorf("%s: one unseal gives (%q, %v), want %q", c.name, got, ok, c.want)
		}
	}

	// ── the DATE columns ────────────────────────────────────────────────
	var userDOB, empDOB *string
	var userDOBEnc, empDOBEnc string
	if err := pool.QueryRow(ctx,
		`SELECT to_char(u.dob, 'YYYY-MM-DD'), COALESCE(u.dob_encrypted, ''),
		        to_char(e.date_of_birth, 'YYYY-MM-DD'), COALESCE(e.date_of_birth_encrypted, '')
		   FROM users u, provider_employees e
		  WHERE u.id::text = $1 AND e.id::text = $2`, fx.userID, fx.employeeID,
	).Scan(&userDOB, &userDOBEnc, &empDOB, &empDOBEnc); err != nil {
		t.Fatalf("read date columns: %v", err)
	}
	if userDOB != nil {
		t.Errorf("users.dob was not cleared: %q", *userDOB)
	}
	if empDOB != nil {
		t.Errorf("provider_employees.date_of_birth was not cleared: %q", *empDOB)
	}
	if got, ok := open(key, userDOBEnc); !ok || got != fixtureUserDOB {
		t.Errorf("users.dob_encrypted unseals to (%q, %v), want %q", got, ok, fixtureUserDOB)
	}
	if got, ok := open(key, empDOBEnc); !ok || got != fixtureEmpDOB {
		t.Errorf("provider_employees.date_of_birth_encrypted unseals to (%q, %v), want %q", got, ok, fixtureEmpDOB)
	}

	// ── the geometry ────────────────────────────────────────────────────
	wantLat, wantLng := coarsenPoint(fixtureLat, fixtureLng)
	wantPoint := formatExactPoint(fixtureLat, fixtureLng)

	for _, c := range []struct {
		name  string
		state geoState
	}{
		{"jobs", readJobGeo(t, pool, fx.jobID)},
		{"properties", readPropertyGeo(t, pool, fx.propertyID)},
	} {
		got, ok := open(key, c.state.enc)
		if !ok {
			t.Errorf("%s: encrypted point does not open under the primary key", c.name)
			continue
		}
		if got != wantPoint {
			t.Errorf("%s: encrypted point is %q, want the EXACT %q", c.name, got, wantPoint)
		}
		for i := range c.state.lats {
			if c.state.lats[i] != wantLat || c.state.lngs[i] != wantLng {
				t.Errorf("%s geometry[%d] = (%.17g,%.17g), want the coarse (%.17g,%.17g)",
					c.name, i, c.state.lats[i], c.state.lngs[i], wantLat, wantLng)
			}
		}
	}
}

// ── 2. a second run is a strict no-op, and the point survives ────────────

// TestRunTwicePreservesTheExactPoint is the load-bearing idempotency test.
//
// The failure it exists to catch is silent and unrecoverable: after run 1 the
// geometry holds the COARSE point and the encrypted column holds the EXACT one.
// A second run that re-derived the ciphertext from the geometry would overwrite
// the exact coordinate with the grid intersection — the value would still
// decrypt, still look like a plausible Austin address, and be wrong by up to
// 790 m with no way to notice.
//
// So this asserts two things: the second run issues ZERO write statements, and
// the decrypted point is still the ORIGINAL seeded coordinate to 7 decimals.
func TestRunTwicePreservesTheExactPoint(t *testing.T) {
	pool := testPool(t)
	reset(t, pool)
	ctx := context.Background()

	key := mustKey(t)
	kr := keyring{primary: key}
	fx := seedEverythingPlaintext(t, pool)

	if err := run(ctx, pool, kr, false); err != nil {
		t.Fatalf("run 1: %v", err)
	}
	job1 := readJobGeo(t, pool, fx.jobID)
	prop1 := readPropertyGeo(t, pool, fx.propertyID)

	counting := &countingDB{inner: pool}
	if err := run(ctx, counting, kr, false); err != nil {
		t.Fatalf("run 2: %v", err)
	}
	if counting.execs != 0 {
		t.Fatalf("second run issued %d write statement(s), want 0:\n%v", counting.execs, counting.stmts)
	}

	job2 := readJobGeo(t, pool, fx.jobID)
	prop2 := readPropertyGeo(t, pool, fx.propertyID)

	wantPoint := formatExactPoint(fixtureLat, fixtureLng)
	for _, c := range []struct {
		name   string
		before geoState
		after  geoState
	}{
		{"jobs", job1, job2},
		{"properties", prop1, prop2},
	} {
		if c.after.enc != c.before.enc {
			t.Errorf("%s: the ciphertext was rewritten by the second run", c.name)
		}
		for i := range c.before.lats {
			if c.after.lats[i] != c.before.lats[i] || c.after.lngs[i] != c.before.lngs[i] {
				t.Errorf("%s geometry[%d] moved on the second run: (%.17g,%.17g) -> (%.17g,%.17g)",
					c.name, i, c.before.lats[i], c.before.lngs[i], c.after.lats[i], c.after.lngs[i])
			}
		}
		got, ok := open(key, c.after.enc)
		if !ok {
			t.Fatalf("%s: encrypted point no longer opens", c.name)
		}
		if got != wantPoint {
			t.Fatalf("%s: after two runs the stored point is %q, want the ORIGINAL EXACT %q — the exact coordinate was downgraded to the coarse grid",
				c.name, got, wantPoint)
		}
		lat, lng, err := parseExactPoint(got)
		if err != nil {
			t.Fatalf("%s: stored point does not parse: %v", c.name, err)
		}
		const tol = 5e-8
		if math.Abs(lat-fixtureLat) > tol || math.Abs(lng-fixtureLng) > tol {
			t.Fatalf("%s: stored point (%v,%v) differs from the seeded (%v,%v) beyond 7dp",
				c.name, lat, lng, fixtureLat, fixtureLng)
		}
	}
}

// ── 3. rotation re-keys the point without moving the geometry ────────────

// TestRunRotationRekeysThePointWithoutMovingTheGeometry: with PREVIOUS set, the
// encrypted exact point moves to the new key while the (already coarse)
// geometry stays byte-identical. Re-deriving it, or re-coarsening from it,
// would both show up here.
func TestRunRotationRekeysThePointWithoutMovingTheGeometry(t *testing.T) {
	pool := testPool(t)
	reset(t, pool)
	ctx := context.Background()

	oldKey, newKey := mustKey(t), mustKey(t)
	fx := seedEverythingPlaintext(t, pool)

	if err := run(ctx, pool, keyring{primary: oldKey}, false); err != nil {
		t.Fatalf("initial run: %v", err)
	}
	job1 := readJobGeo(t, pool, fx.jobID)
	prop1 := readPropertyGeo(t, pool, fx.propertyID)

	if err := run(ctx, pool, keyring{primary: newKey, previous: oldKey}, false); err != nil {
		t.Fatalf("rotation run: %v", err)
	}
	job2 := readJobGeo(t, pool, fx.jobID)
	prop2 := readPropertyGeo(t, pool, fx.propertyID)

	wantPoint := formatExactPoint(fixtureLat, fixtureLng)
	for _, c := range []struct {
		name   string
		before geoState
		after  geoState
	}{
		{"jobs", job1, job2},
		{"properties", prop1, prop2},
	} {
		for i := range c.before.lats {
			if c.after.lats[i] != c.before.lats[i] || c.after.lngs[i] != c.before.lngs[i] {
				t.Errorf("%s geometry[%d] moved during a key rotation: (%.17g,%.17g) -> (%.17g,%.17g)",
					c.name, i, c.before.lats[i], c.before.lngs[i], c.after.lats[i], c.after.lngs[i])
			}
		}
		if c.after.enc == c.before.enc {
			t.Errorf("%s: the encrypted point was not re-keyed", c.name)
		}
		if _, ok := open(oldKey, c.after.enc); ok {
			t.Errorf("%s: the encrypted point still opens under the OLD key", c.name)
		}
		got, ok := open(newKey, c.after.enc)
		if !ok {
			t.Fatalf("%s: the re-keyed point does not open under the NEW key", c.name)
		}
		if got != wantPoint {
			t.Fatalf("%s: one unseal yields %q, want %q — a double encryption would show base64 here",
				c.name, got, wantPoint)
		}
	}

	// The audit views must still be empty; a rotation must not un-finish a
	// database.
	if after := auditRows(t, pool); len(after) != 0 {
		t.Fatalf("audit views are not empty after a rotation: %v", after)
	}
}

// ── 4. an unopenable value aborts everything ─────────────────────────────

// TestRunAbortsOnUnknownGeometryKeyWithNothingWritten: a single encrypted point
// under a key we were not given must stop the run in pre-flight, before any
// table is touched.
//
// This is the case where getting it wrong is worst. The geometry write coarsens
// in the same statement that stores the ciphertext, so proceeding past an
// unreadable point would trade a recoverable exact coordinate for a permanently
// rounded-off one.
func TestRunAbortsOnUnknownGeometryKeyWithNothingWritten(t *testing.T) {
	pool := testPool(t)
	reset(t, pool)
	ctx := context.Background()

	primary, foreign := mustKey(t), mustKey(t)
	kr := keyring{primary: primary} // no PREVIOUS: the operator error

	orphan := mustEncrypt(t, foreign, formatExactPoint(fixtureLat, fixtureLng))
	userID := seedUser(t, pool, "orphan-geo@example.com", "512-555-0002", nil)
	jobID := seedJob(t, pool, userID, anyCategoryID(t, pool), fixtureJobAddress, fixtureLat, fixtureLng, &orphan)
	propID := seedProperty(t, pool, userID, fixturePropAddr, fixturePropNotes, fixtureLat, fixtureLng, nil)

	before := auditRows(t, pool)

	err := run(ctx, pool, kr, false)
	if err == nil {
		t.Fatal("run succeeded; it must refuse to coarsen a geometry whose encrypted copy it cannot read")
	}
	t.Logf("refused as expected: %v", err)

	// Nothing may have moved — not the job that carries the orphan, not the
	// property on the other spec, not the plaintext address on either.
	job := readJobGeo(t, pool, jobID)
	if job.enc != orphan {
		t.Errorf("the orphan ciphertext was modified despite the abort")
	}
	if job.lats[0] != fixtureLat || job.lngs[0] != fixtureLng {
		t.Errorf("jobs.service_location was coarsened despite the abort: (%v,%v)", job.lats[0], job.lngs[0])
	}
	if job.lats[1] != fixtureLat || job.lngs[1] != fixtureLng {
		t.Errorf("jobs.approximate_location was coarsened despite the abort: (%v,%v)", job.lats[1], job.lngs[1])
	}
	prop := readPropertyGeo(t, pool, propID)
	if prop.enc != "" {
		t.Errorf("properties.location_encrypted was written despite the abort")
	}
	if prop.lats[0] != fixtureLat || prop.lngs[0] != fixtureLng {
		t.Errorf("properties.location was coarsened despite the abort: (%v,%v)", prop.lats[0], prop.lngs[0])
	}

	var jobAddr, propAddr string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(j.service_address,''), p.address
		   FROM jobs j, properties p WHERE j.id::text = $1 AND p.id::text = $2`,
		jobID, propID,
	).Scan(&jobAddr, &propAddr); err != nil {
		t.Fatalf("read addresses: %v", err)
	}
	if jobAddr != fixtureJobAddress {
		t.Errorf("jobs.service_address was written despite the abort")
	}
	if propAddr != fixturePropAddr {
		t.Errorf("properties.address was written despite the abort")
	}

	// The database is still exactly as dirty as it was.
	if after := auditRows(t, pool); len(after) != len(before) {
		t.Errorf("the audit findings changed across an aborted run: %d -> %d", len(before), len(after))
	}
}

// ── 5. the GDPR erasure sentinel ─────────────────────────────────────────

// TestRunLeavesTheErasureSentinelUntouched: services/user/.../gdpr.go writes
// ST_MakePoint(0,0) into the NOT NULL geometry of an erased account. That is
// the absence of a location, not a location, and encrypting it would re-create
// a "preserved exact point" for a user who asked to be forgotten.
func TestRunLeavesTheErasureSentinelUntouched(t *testing.T) {
	pool := testPool(t)
	reset(t, pool)
	ctx := context.Background()

	key := mustKey(t)
	userID := seedUser(t, pool, "erased@example.com", "", nil)
	jobID := seedJob(t, pool, userID, anyCategoryID(t, pool), "", 0, 0, nil)
	propID := seedProperty(t, pool, userID, "REDACTED", "", 0, 0, nil)

	if err := run(ctx, pool, keyring{primary: key}, false); err != nil {
		t.Fatalf("run: %v", err)
	}

	job := readJobGeo(t, pool, jobID)
	prop := readPropertyGeo(t, pool, propID)

	if job.enc != "" {
		t.Errorf("jobs.service_location_encrypted was written for the (0,0) sentinel: %q", job.enc)
	}
	if prop.enc != "" {
		t.Errorf("properties.location_encrypted was written for the (0,0) sentinel: %q", prop.enc)
	}
	for i := range job.lats {
		if job.lats[i] != 0 || job.lngs[i] != 0 {
			t.Errorf("jobs geometry[%d] moved off the sentinel: (%v,%v)", i, job.lats[i], job.lngs[i])
		}
	}
	if prop.lats[0] != 0 || prop.lngs[0] != 0 {
		t.Errorf("properties.location moved off the sentinel: (%v,%v)", prop.lats[0], prop.lngs[0])
	}
	// A sentinel row is indistinguishable from a coarsened one, so the audit
	// stays empty without the tool having to touch it.
	if after := auditRows(t, pool); len(after) != 0 {
		t.Fatalf("audit views are not empty: %v", after)
	}
}

// ── 6. Go and SQL must agree on the grid, bit for bit ────────────────────

// TestCoarsenMatchesSQL pins the Go copy of the coarsening to
// pii_coarsen_ordinate (migration 104). They are two implementations of one
// definition, and pii_exact_geometry_audit tests membership of the grid by
// comparing a stored point against its own image under the SQL function — so a
// single ULP of disagreement would make every coarsened row report as
// still-exact forever, silently retiring the only question the audit exists to
// answer.
//
// The .005 half-grid boundaries are included in full because that is exactly
// where the two implementations diverged before: exact decimal arithmetic sees
// 0.145/0.01 as 14.5 and rounds up, while binary float64 yields
// 14.499999999999998 and rounds down.
func TestCoarsenMatchesSQL(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	var vals []float64
	// Every exact .005 boundary across the full coordinate range.
	for k := -18000; k < 18000; k++ {
		vals = append(vals, (float64(k)+0.5)*coarsenGrid)
	}
	// Plus the specific vectors that broke, and uniform random coordinates.
	vals = append(vals, 0, 0.005, -0.005, 0.145, -0.145, 30.265, -97.745, 30.2672123, -97.7431456)
	rng := rand.New(rand.NewSource(3))
	for i := 0; i < 5000; i++ {
		vals = append(vals, -180+rng.Float64()*360)
	}

	rows, err := pool.Query(ctx,
		`SELECT v, pii_coarsen_ordinate(v) FROM unnest($1::double precision[]) AS v`, vals)
	if err != nil {
		t.Fatalf("query pii_coarsen_ordinate: %v", err)
	}
	defer rows.Close()

	checked, mismatches := 0, 0
	for rows.Next() {
		var in, sqlOut float64
		if err := rows.Scan(&in, &sqlOut); err != nil {
			t.Fatalf("scan: %v", err)
		}
		checked++
		if goOut := coarsenOrdinate(in); goOut != sqlOut {
			mismatches++
			if mismatches <= 10 {
				t.Errorf("coarsenOrdinate(%.17g): Go = %.17g, SQL = %.17g", in, goOut, sqlOut)
			}
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iter: %v", err)
	}
	if checked != len(vals) {
		t.Fatalf("checked %d values, sent %d", checked, len(vals))
	}
	if mismatches > 0 {
		t.Fatalf("%d of %d vectors disagree between Go and SQL", mismatches, checked)
	}
	t.Logf("Go and SQL agree on all %d vectors", checked)
}

// TestCoarsenPointMatchesSQLGeometry closes the loop at the geometry level: the
// point the tool leaves behind must be its own image under pii_coarsen_point,
// which is literally the predicate pii_exact_geometry_audit evaluates.
func TestCoarsenPointMatchesSQLGeometry(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	rng := rand.New(rand.NewSource(5))
	for i := 0; i < 300; i++ {
		lat := 24 + rng.Float64()*25
		lng := -125 + rng.Float64()*59
		wantLat, wantLng := coarsenPoint(lat, lng)

		var gotLat, gotLng float64
		var isOwnImage bool
		if err := pool.QueryRow(ctx,
			`WITH p AS (
			     SELECT pii_coarsen_point(ST_SetSRID(ST_MakePoint($2, $1), 4326)) AS g
			 )
			 SELECT ST_Y(g), ST_X(g), ST_Equals(g, pii_coarsen_point(g)) FROM p`,
			lat, lng,
		).Scan(&gotLat, &gotLng, &isOwnImage); err != nil {
			t.Fatalf("query pii_coarsen_point: %v", err)
		}
		if gotLat != wantLat || gotLng != wantLng {
			t.Fatalf("pii_coarsen_point(%v,%v) = (%.17g,%.17g), Go says (%.17g,%.17g)",
				lat, lng, gotLat, gotLng, wantLat, wantLng)
		}
		if !isOwnImage {
			t.Fatalf("a coarsened point is not its own image; pii_exact_geometry_audit would report it forever")
		}
	}
}
