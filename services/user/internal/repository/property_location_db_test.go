//go:build dbtest

// DB-backed tests for the properties at-rest privacy regime introduced by
// migrations 105 (properties.location_encrypted) and 106 (users.dob_encrypted),
// plus the per-VALUE decryption correction to properties.address / notes.
//
// What is being proved, and why each assertion is load-bearing:
//
//   - properties.location is written COARSE. The assertion is not "is it near
//     the grid" but ST_Equals(location, pii_coarsen_point(location)) evaluated
//     BY POSTGRES — so the test fails if the Go coarsening and the SQL one ever
//     stop agreeing, which is the exact condition that would silently break
//     pii_exact_geometry_audit (migration 107).
//   - the exact point survives, encrypted, and comes back out of every read.
//   - a pre-105 row (exact geometry, NULL location_encrypted) still returns its
//     exact coordinates.
//   - a legacy PLAINTEXT address on a row whose pii_encrypted_v1 is TRUE reads
//     back correctly — the flag-drift case the per-value fix exists for.
//   - GDPR erasure clears the encrypted copies, not just the plaintext.
//
// These tests seed their own rows, so they need only a migrated database — no
// `make seed`, no `make encrypt-pii`. Point them at a SCRATCH database:
//
//	DATABASE_URL=postgres://.../nm_scratch_user ENCRYPTION_KEY=$(openssl rand -base64 32) \
//	  go test -tags=dbtest ./internal/repository/...
package repository

import (
	"context"
	"math"
	"testing"

	"github.com/nomarkup/nomarkup/services/user/internal/crypto"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

const (
	// An address-precision point: 7 decimals, nowhere near a grid line.
	propExactLat = 30.2672123
	propExactLng = -97.7431987
	// Its image under the 0.01-degree grid (migration 104).
	propCoarseLat = 30.27
	propCoarseLng = -97.74

	propAddress = "1100 Congress Ave, Austin, TX 78701"
	propNotes   = "gate code 4417, dog in the yard"
)

// seedPropertyUser inserts a bare user row for a property test and registers
// its cleanup.
func seedPropertyUser(t *testing.T, repo *PostgresRepository, email string) string {
	t.Helper()
	ctx := context.Background()
	var userID string
	if err := repo.pool.QueryRow(ctx,
		`INSERT INTO users (email, display_name, roles)
		 VALUES ($1, 'Property Test Customer', ARRAY['customer']) RETURNING id::text`,
		email,
	).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = repo.pool.Exec(bg, `DELETE FROM properties WHERE user_id::text = $1`, userID)
		_, _ = repo.pool.Exec(bg, `DELETE FROM users WHERE id::text = $1`, userID)
	})
	return userID
}

// rawProperty reads the row straight off disk, bypassing every decryption
// path. selfCoarse is ST_Equals(location, pii_coarsen_point(location))
// evaluated by PostgreSQL — the audit view's own test for "has this row been
// coarsened", so a TRUE here means the Go writer and the SQL function agree.
func rawProperty(t *testing.T, repo *PostgresRepository, propertyID string) (lat, lng float64, locEnc, addr, notes string, flag, selfCoarse bool) {
	t.Helper()
	if err := repo.pool.QueryRow(context.Background(),
		`SELECT ST_Y(location), ST_X(location), COALESCE(location_encrypted, ''),
		        COALESCE(address, ''), COALESCE(notes, ''), pii_encrypted_v1,
		        ST_Equals(location, pii_coarsen_point(location))
		   FROM properties WHERE id::text = $1`, propertyID,
	).Scan(&lat, &lng, &locEnc, &addr, &notes, &flag, &selfCoarse); err != nil {
		t.Fatalf("raw select: %v", err)
	}
	return
}

// insertRawProperty writes a properties row with LITERAL column values so a
// test can stage a legacy row, a plaintext/ciphertext mix, or a foreign-key
// orphan ciphertext.
func insertRawProperty(t *testing.T, repo *PostgresRepository, userID, addr, notes string, lat, lng float64, locEnc *string, flag bool) string {
	t.Helper()
	var id string
	if err := repo.pool.QueryRow(context.Background(),
		`INSERT INTO properties (user_id, nickname, address, city, state, zip_code, location, location_encrypted, notes, is_primary, pii_encrypted_v1)
		 VALUES ($1, 'Legacy', $2, 'Austin', 'TX', '78701',
		         ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, NULLIF($6,''), false, $7)
		 RETURNING id::text`,
		userID, addr, lng, lat, locEnc, notes, flag,
	).Scan(&id); err != nil {
		t.Fatalf("insert raw property: %v", err)
	}
	return id
}

func assertCoord(t *testing.T, label string, got, want float64) {
	t.Helper()
	// 1e-9 degrees is ~0.1 mm; anything this close is the same coordinate,
	// anything further is a different one. The coarsening moves points by
	// ~0.005 degrees, five million times this tolerance, so no rounding
	// artefact can disguise a coarse value as an exact one.
	if math.Abs(got-want) > 1e-9 {
		t.Errorf("%s = %.7f, want %.7f", label, got, want)
	}
}

// TestPropertyLocationCoarseOnDiskExactToOwner is the core assertion of
// migration 105: the geometry an operator can read is a ~1 km grid cell, the
// exact point exists only as ciphertext, and the OWNER still gets their real
// pin back from every read path.
func TestPropertyLocationCoarseOnDiskExactToOwner(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedPropertyUser(t, repo, "prop-coarse@example.com")

	created, err := repo.CreateProperty(ctx, domain.CreatePropertyInput{
		UserID:    userID,
		Nickname:  "Home",
		Address:   propAddress,
		City:      "Austin",
		State:     "TX",
		ZipCode:   "78701",
		Latitude:  propExactLat,
		Longitude: propExactLng,
		Notes:     propNotes,
		IsPrimary: true,
	})
	if err != nil {
		t.Fatalf("create property: %v", err)
	}

	// 1. The write path returns the EXACT point to its owner.
	assertCoord(t, "created latitude", created.Latitude, propExactLat)
	assertCoord(t, "created longitude", created.Longitude, propExactLng)
	if created.Address != propAddress {
		t.Errorf("created address = %q, want %q", created.Address, propAddress)
	}
	if created.Notes != propNotes {
		t.Errorf("created notes = %q, want %q", created.Notes, propNotes)
	}

	// 2. The COLUMN holds a coarse point. This is the assertion that fails if
	//    the runtime ever writes an exact coordinate here again: an operator
	//    with raw DB access must not be able to reverse-geocode a house.
	rawLat, rawLng, locEnc, rawAddr, rawNotes, flag, selfCoarse := rawProperty(t, repo, created.ID)
	assertCoord(t, "on-disk latitude", rawLat, propCoarseLat)
	assertCoord(t, "on-disk longitude", rawLng, propCoarseLng)
	if rawLat == propExactLat || rawLng == propExactLng {
		t.Errorf("EXACT point on disk (%.7f,%.7f)", rawLat, rawLng)
	}
	// 3. Go and SQL agree on what "coarsened" means. pii_exact_geometry_audit
	//    is built entirely on this predicate.
	if !selfCoarse {
		t.Errorf("ST_Equals(location, pii_coarsen_point(location)) is FALSE — the Go coarsening disagrees with the SQL one, and migration 107's audit view cannot see this row as processed")
	}

	// 4. The exact point survives as ciphertext, and unseals in ONE step.
	if locEnc == "" {
		t.Fatal("location_encrypted is empty; the exact point was destroyed")
	}
	if !crypto.LooksLikeCiphertext(locEnc) {
		t.Errorf("location_encrypted %q is not secretbox-shaped", locEnc)
	}
	cipher, err := crypto.FromEnv()
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	plain, err := cipher.DecryptString(locEnc)
	if err != nil {
		t.Fatalf("location_encrypted does not decrypt: %v", err)
	}
	if want := domain.FormatExactPoint(propExactLat, propExactLng); plain != want {
		t.Errorf("location_encrypted decrypts to %q, want %q", plain, want)
	}

	// 5. address / notes are still ciphertext on disk and the flag is set.
	if rawAddr == propAddress {
		t.Errorf("address: PLAINTEXT on disk (%q)", rawAddr)
	}
	if rawNotes == propNotes {
		t.Errorf("notes: PLAINTEXT on disk (%q)", rawNotes)
	}
	if !flag {
		t.Error("pii_encrypted_v1 not set by the write path")
	}

	// 6. Every read path hands the exact point back.
	got, err := repo.getPropertyByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("get property: %v", err)
	}
	assertCoord(t, "getPropertyByID latitude", got.Latitude, propExactLat)
	assertCoord(t, "getPropertyByID longitude", got.Longitude, propExactLng)
	if got.Address != propAddress {
		t.Errorf("getPropertyByID address = %q, want %q", got.Address, propAddress)
	}
	if got.Notes != propNotes {
		t.Errorf("getPropertyByID notes = %q, want %q", got.Notes, propNotes)
	}

	list, err := repo.ListProperties(ctx, userID)
	if err != nil {
		t.Fatalf("list properties: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("list returned %d properties, want 1", len(list))
	}
	assertCoord(t, "ListProperties latitude", list[0].Latitude, propExactLat)
	assertCoord(t, "ListProperties longitude", list[0].Longitude, propExactLng)
	if list[0].Address != propAddress {
		t.Errorf("ListProperties address = %q, want %q", list[0].Address, propAddress)
	}
}

// TestPropertyLocationMatchesSQLCoarsening is the cross-language parity
// regression test, and it is the reason the coarsening is one plain float64
// expression on both sides.
//
// pii_exact_geometry_audit (migration 107) answers "has this row been
// coarsened" with ST_Equals(g, pii_coarsen_point(g)). If Go's arithmetic and
// the SQL function disagree by a single ULP, every row CreateProperty writes
// reports as still-exact forever and the audit becomes noise. So each case
// asserts BIT-exact equality between the stored ordinate and
// pii_coarsen_ordinate() applied to the same input by PostgreSQL.
//
// The fixture deliberately includes the values where "round half away from
// zero" is decided in binary rather than decimal:
//
//   - 30.265 / -97.745 are exact .005 half-grid boundaries; v/0.01 lands on a
//     clean .5 and must round AWAY from zero (rint()/banker's rounding would
//     send 30.265 to 30.26).
//   - 0.145 is the counter-example: 0.145/0.01 is 14.499999999999998 in
//     float64, so it rounds DOWN. A SQL mirror written with a NUMERIC cast
//     sees exactly 14.5, rounds UP, and disagrees — that defect was measured
//     at 4871 mismatches over 20162 vectors, and this case is what catches it.
func TestPropertyLocationMatchesSQLCoarsening(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedPropertyUser(t, repo, "prop-sql-parity@example.com")

	tests := []struct {
		name     string
		lat, lng float64
	}{
		{"address precision", propExactLat, propExactLng},
		{"exact half boundary", 30.265, -97.745},
		{"binary half below the boundary", 0.145, -0.145},
		{"exact binary halves", 0.135, 0.155},
		{"already on the grid", 30.27, -97.74},
		{"origin", 0, 0},
		{"southern hemisphere", -33.8688, 151.2093},
	}

	for _, tt := range tests {
		created, err := repo.CreateProperty(ctx, domain.CreatePropertyInput{
			UserID:    userID,
			Nickname:  tt.name,
			Address:   propAddress,
			City:      "Austin",
			State:     "TX",
			ZipCode:   "78701",
			Latitude:  tt.lat,
			Longitude: tt.lng,
		})
		if err != nil {
			t.Fatalf("%s: create property: %v", tt.name, err)
		}

		wantLat, wantLng := domain.CoarsenPoint(tt.lat, tt.lng)

		var goMatchesStored, sqlMatchesStored, selfCoarse bool
		if err := repo.pool.QueryRow(ctx,
			`SELECT ST_Y(location) = $2 AND ST_X(location) = $3,
			        ST_Y(location) = pii_coarsen_ordinate($4) AND ST_X(location) = pii_coarsen_ordinate($5),
			        ST_Equals(location, pii_coarsen_point(location))
			   FROM properties WHERE id::text = $1`,
			created.ID, wantLat, wantLng, tt.lat, tt.lng,
		).Scan(&goMatchesStored, &sqlMatchesStored, &selfCoarse); err != nil {
			t.Fatalf("%s: parity read: %v", tt.name, err)
		}
		if !goMatchesStored {
			t.Errorf("%s: stored ordinates are not bit-equal to domain.CoarsenPoint(%v,%v) = (%.17g,%.17g)",
				tt.name, tt.lat, tt.lng, wantLat, wantLng)
		}
		if !sqlMatchesStored {
			t.Errorf("%s: Go and SQL disagree — pii_coarsen_ordinate(%v/%v) differs from what CreateProperty wrote; pii_exact_geometry_audit would report this row as still-exact",
				tt.name, tt.lat, tt.lng)
		}
		if !selfCoarse {
			t.Errorf("%s: ST_Equals(location, pii_coarsen_point(location)) is FALSE", tt.name)
		}

		// The owner still gets the exact point regardless of the grid maths.
		assertCoord(t, tt.name+" returned latitude", created.Latitude, tt.lat)
		assertCoord(t, tt.name+" returned longitude", created.Longitude, tt.lng)
	}
}

// TestPropertyLocationLegacyRowKeepsExactGeometry: a row written before
// migration 105 has an exact geometry and no encrypted copy. Its owner's pin
// must not move — the fallback is what makes the change safe to deploy ahead
// of the backfill.
func TestPropertyLocationLegacyRowKeepsExactGeometry(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedPropertyUser(t, repo, "prop-legacy-geom@example.com")

	encAddr, err := repo.cipher.EncryptString(propAddress)
	if err != nil {
		t.Fatalf("encrypt address: %v", err)
	}
	id := insertRawProperty(t, repo, userID, encAddr, "", propExactLat, propExactLng, nil, true)

	// Precondition: the geometry is exact and there is no encrypted copy.
	rawLat, rawLng, locEnc, _, _, _, selfCoarse := rawProperty(t, repo, id)
	if locEnc != "" {
		t.Fatalf("precondition: location_encrypted should be NULL, got %q", locEnc)
	}
	assertCoord(t, "precondition on-disk latitude", rawLat, propExactLat)
	assertCoord(t, "precondition on-disk longitude", rawLng, propExactLng)
	if selfCoarse {
		t.Fatal("precondition: an exact point must NOT equal its own coarsening (migration 107 would miss this row)")
	}

	got, err := repo.getPropertyByID(ctx, id)
	if err != nil {
		t.Fatalf("get property: %v", err)
	}
	assertCoord(t, "legacy getPropertyByID latitude", got.Latitude, propExactLat)
	assertCoord(t, "legacy getPropertyByID longitude", got.Longitude, propExactLng)

	list, err := repo.ListProperties(ctx, userID)
	if err != nil {
		t.Fatalf("list properties: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("list returned %d properties, want 1", len(list))
	}
	assertCoord(t, "legacy ListProperties latitude", list[0].Latitude, propExactLat)
	assertCoord(t, "legacy ListProperties longitude", list[0].Longitude, propExactLng)
}

// TestPropertyLegacyPlaintextAddressWithFlagTrue is the flag-drift case.
//
// pii_encrypted_v1 is a ROW flag over PER-COLUMN encryption: UpdateProperty
// sets it TRUE whenever notes are written, so a row can read TRUE while its
// address is still the plaintext the backfill never revisited. The old
// read path branched on the flag and pushed that plaintext through
// DecryptString, turning a customer's own address into an error. Per-VALUE
// detection cannot drift that way.
func TestPropertyLegacyPlaintextAddressWithFlagTrue(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedPropertyUser(t, repo, "prop-flag-drift@example.com")

	encNotes, err := repo.cipher.EncryptString(propNotes)
	if err != nil {
		t.Fatalf("encrypt notes: %v", err)
	}
	// address PLAINTEXT, notes CIPHERTEXT, flag TRUE — exactly what an
	// UpdateProperty(notes) against a pre-033 row produces.
	id := insertRawProperty(t, repo, userID, propAddress, encNotes, propExactLat, propExactLng, nil, true)

	_, _, _, rawAddr, _, flag, _ := rawProperty(t, repo, id)
	if !flag {
		t.Fatal("precondition: flag should be TRUE")
	}
	if rawAddr != propAddress {
		t.Fatalf("precondition: address should still be plaintext, got %q", rawAddr)
	}

	got, err := repo.getPropertyByID(ctx, id)
	if err != nil {
		t.Fatalf("get property: %v", err)
	}
	if got.Address != propAddress {
		t.Errorf("address = %q, want %q (plaintext value must pass through despite the TRUE flag)", got.Address, propAddress)
	}
	if got.Notes != propNotes {
		t.Errorf("notes = %q, want %q (ciphertext on the same row must still decrypt)", got.Notes, propNotes)
	}
}

// TestPropertyPlaintextRowWithFlagFalse is the opposite drift: ciphertext on a
// row the flag calls unencrypted. Branching on the flag would have returned the
// raw base64 to the caller as if it were an address.
func TestPropertyPlaintextRowWithFlagFalse(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedPropertyUser(t, repo, "prop-flag-false@example.com")

	encAddr, err := repo.cipher.EncryptString(propAddress)
	if err != nil {
		t.Fatalf("encrypt address: %v", err)
	}
	id := insertRawProperty(t, repo, userID, encAddr, "", propExactLat, propExactLng, nil, false)

	got, err := repo.getPropertyByID(ctx, id)
	if err != nil {
		t.Fatalf("get property: %v", err)
	}
	if got.Address != propAddress {
		t.Errorf("address = %q, want %q (ciphertext must decrypt even with the flag FALSE)", got.Address, propAddress)
	}
}

// TestPropertyLocationWrongKeyFailsLoud: a location_encrypted that IS our wire
// format but opens under no configured key must surface an error, never fall
// back silently. A silent fallback would answer a key misconfiguration with a
// pin that quietly moved up to ~0.79 km, which is indistinguishable from
// working software.
func TestPropertyLocationWrongKeyFailsLoud(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedPropertyUser(t, repo, "prop-orphan-loc@example.com")

	var foreign [crypto.KeySize]byte
	for i := range foreign {
		foreign[i] = byte(i + 1)
	}
	orphan, err := crypto.New(&foreign, nil).EncryptString(domain.FormatExactPoint(propExactLat, propExactLng))
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	id := insertRawProperty(t, repo, userID, "", "", propCoarseLat, propCoarseLng, &orphan, true)

	if _, err := repo.getPropertyByID(ctx, id); err == nil {
		t.Fatal("expected an error for a location ciphertext no configured key can open")
	} else {
		t.Logf("failed loud as expected: %v", err)
	}
	if _, err := repo.ListProperties(ctx, userID); err == nil {
		t.Fatal("ListProperties: expected the same error")
	}
}

// TestPropertyLocationUnparseablePlaintextFallsBack: a decrypted value that is
// not a point is corruption we CAN read, and the coarse geometry covers it. It
// logs WARN and falls back rather than failing a customer's whole property
// list over one bad row.
func TestPropertyLocationUnparseablePlaintextFallsBack(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedPropertyUser(t, repo, "prop-bad-point@example.com")

	junk, err := repo.cipher.EncryptString("not-a-point")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	id := insertRawProperty(t, repo, userID, "", "", propCoarseLat, propCoarseLng, &junk, true)

	got, err := repo.getPropertyByID(ctx, id)
	if err != nil {
		t.Fatalf("get property should fall back, not fail: %v", err)
	}
	assertCoord(t, "fallback latitude", got.Latitude, propCoarseLat)
	assertCoord(t, "fallback longitude", got.Longitude, propCoarseLng)
}

// TestGDPRErasureClearsEncryptedPII proves the erasure cascade clears the
// ENCRYPTED copies, not only the plaintext they replaced. An encrypted copy of
// an erased identifier is still a retained identifier, and before this change
// both a full date of birth (users.dob / dob_verified_at) and the exact home
// coordinate (properties.location_encrypted) survived a right-to-erasure
// request.
func TestGDPRErasureClearsEncryptedPII(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedPropertyUser(t, repo, "prop-erasure@example.com")

	encDOB, err := repo.cipher.EncryptString("1985-04-12")
	if err != nil {
		t.Fatalf("encrypt dob: %v", err)
	}
	if _, err := repo.pool.Exec(ctx,
		`UPDATE users
		    SET dob = DATE '1985-04-12', dob_verified_at = now(), dob_encrypted = $2
		  WHERE id::text = $1`, userID, encDOB); err != nil {
		t.Fatalf("seed dob: %v", err)
	}

	created, err := repo.CreateProperty(ctx, domain.CreatePropertyInput{
		UserID:    userID,
		Address:   propAddress,
		City:      "Austin",
		State:     "TX",
		ZipCode:   "78701",
		Latitude:  propExactLat,
		Longitude: propExactLng,
	})
	if err != nil {
		t.Fatalf("create property: %v", err)
	}

	// Preconditions: everything we are about to demand be erased exists.
	var dobSet, dobVerifiedSet, dobEncSet bool
	if err := repo.pool.QueryRow(ctx,
		`SELECT dob IS NOT NULL, dob_verified_at IS NOT NULL, dob_encrypted IS NOT NULL
		   FROM users WHERE id::text = $1`, userID,
	).Scan(&dobSet, &dobVerifiedSet, &dobEncSet); err != nil {
		t.Fatalf("precondition read: %v", err)
	}
	if !dobSet || !dobVerifiedSet || !dobEncSet {
		t.Fatalf("precondition: dob=%v dob_verified_at=%v dob_encrypted=%v, want all set", dobSet, dobVerifiedSet, dobEncSet)
	}
	if _, _, locEnc, _, _, _, _ := rawProperty(t, repo, created.ID); locEnc == "" {
		t.Fatal("precondition: location_encrypted should be populated")
	}

	if _, err := repo.FinalizeAccountDeletion(ctx, userID); err != nil {
		t.Fatalf("finalize: %v", err)
	}

	var dobNull, dobVerifiedNull, dobEncNull bool
	if err := repo.pool.QueryRow(ctx,
		`SELECT dob IS NULL, dob_verified_at IS NULL, dob_encrypted IS NULL
		   FROM users WHERE id::text = $1`, userID,
	).Scan(&dobNull, &dobVerifiedNull, &dobEncNull); err != nil {
		t.Fatalf("post-erasure read: %v", err)
	}
	if !dobNull {
		t.Error("users.dob survived erasure — a full date of birth was retained")
	}
	if !dobVerifiedNull {
		t.Error("users.dob_verified_at survived erasure")
	}
	if !dobEncNull {
		t.Error("users.dob_encrypted survived erasure — the encrypted copy outlived the plaintext")
	}

	var locEncNull, locIsOrigin bool
	if err := repo.pool.QueryRow(ctx,
		`SELECT location_encrypted IS NULL,
		        ST_Equals(location, ST_SetSRID(ST_MakePoint(0,0), 4326))
		   FROM properties WHERE id::text = $1`, created.ID,
	).Scan(&locEncNull, &locIsOrigin); err != nil {
		t.Fatalf("post-erasure property read: %v", err)
	}
	if !locEncNull {
		t.Error("properties.location_encrypted survived erasure — the exact home coordinate outlived the address it encodes")
	}
	if !locIsOrigin {
		t.Error("properties.location was not reset to the sentinel point")
	}
}
