//go:build dbtest

// DB round-trip proof for the three PII-at-rest columns migration 106 brought
// into the gateway's runtime path, plus the gateway's one consumer of
// jobs.service_address (migration 104).
//
// Each test writes through the real handler, then reads the RAW column back to
// prove what actually landed in Postgres — a handler that decrypts what it
// itself encrypted in memory proves nothing about the bytes at rest.
//
// Point these at a SCRATCH database (they seed and clean up their own rows):
//
//	createdb nm_scratch_gw
//	migrate -path database/migrations -database "postgres://.../nm_scratch_gw?sslmode=disable" up
//	cd gateway && DATABASE_URL="postgres://.../nm_scratch_gw?sslmode=disable" \
//	  ENCRYPTION_KEY=$(openssl rand -base64 32) go test -tags=dbtest ./internal/handler/...
package handler

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
)

// ── harness ──────────────────────────────────────────────────────────────

// piiTestPool dials the scratch database. DATABASE_URL is the documented knob;
// EXPORT_TEST_DATABASE_URL is accepted so this suite can share the env the
// existing data-export tests already use.
func piiTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = os.Getenv("EXPORT_TEST_DATABASE_URL")
	}
	if url == "" {
		t.Skip("DATABASE_URL unset — skipping PII-at-rest DB round-trip test")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// piiTestCipher returns a deterministic cipher plus a SECOND cipher holding a
// key this server does not have, for the unopenable-value cases.
func piiTestCipher(t *testing.T) (*crypto.Cipher, *crypto.Cipher) {
	t.Helper()
	var ours, foreign [crypto.KeySize]byte
	for i := range ours {
		ours[i] = byte(i*11 + 3)
		foreign[i] = byte(251 - i)
	}
	return crypto.New(&ours, nil), crypto.New(&foreign, nil)
}

func mustEncrypt(t *testing.T, c *crypto.Cipher, s string) string {
	t.Helper()
	ct, err := c.EncryptString(s)
	if err != nil {
		t.Fatalf("encrypt %q: %v", s, err)
	}
	return ct
}

// seedUser inserts a bare user and schedules its deletion.
func seedPIIUser(t *testing.T, pool *pgxpool.Pool, roles string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, display_name, roles, status)
		VALUES ($1, 'PII At Rest Test', $2::text[], 'active')
		RETURNING id::text`,
		"pii-at-rest-"+piiRandSuffix(t)+"@nomarkup.test", roles,
	).Scan(&id); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id::text = $1`, id)
	})
	return id
}

func piiRandSuffix(t *testing.T) string {
	t.Helper()
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	const hexDigits = "0123456789abcdef"
	out := make([]byte, 0, 16)
	for _, v := range b {
		out = append(out, hexDigits[v>>4], hexDigits[v&0x0f])
	}
	return string(out)
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("unmarshal %q: %v", rec.Body.String(), err)
	}
	return m
}

// ── 1. provider_licenses.license_number ──────────────────────────────────

const testLicenseNumber = "WA-58213"

// TestProviderLicenseNumberAtRest is the full write→read proof for the licence
// column: ciphertext in Postgres, plaintext to the owner and the admin, and —
// the case that matters most — the PUBLIC masked projection showing the last 4
// of the PLAINTEXT rather than of the stored base64.
func TestProviderLicenseNumberAtRest(t *testing.T) {
	pool := piiTestPool(t)
	cipher, _ := piiTestCipher(t)
	ctx := context.Background()

	providerID := seedPIIUser(t, pool, `{customer,provider}`)
	adminID := seedPIIUser(t, pool, `{admin}`)
	h := NewProviderLicenseHandler(pool, cipher)

	// WRITE via the handler.
	r := chi.NewRouter()
	r.Post("/api/v1/providers/me/licenses", h.SubmitLicense)
	body := `{"license_type":"bar","license_number":"` + testLicenseNumber + `","jurisdiction":"WA"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/providers/me/licenses", strings.NewReader(body))
	req = addClaimsToRequest(req, providerID, "p@nomarkup.test", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("submit: got %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	licenseID, _ := decodeBody(t, rec)["id"].(string)
	if licenseID == "" {
		t.Fatal("submit returned no license id")
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM provider_licenses WHERE id::text = $1`, licenseID)
	})

	// AT REST: the raw column must be ciphertext, and must open to the input.
	var stored string
	if err := pool.QueryRow(ctx,
		`SELECT license_number FROM provider_licenses WHERE id::text = $1`, licenseID,
	).Scan(&stored); err != nil {
		t.Fatalf("read raw column: %v", err)
	}
	if stored == testLicenseNumber {
		t.Fatal("license_number is stored in CLEAR — migration 106 requires it sealed at rest")
	}
	if !crypto.LooksLikeCiphertext(stored) {
		t.Fatalf("stored license_number %q is not secretbox-shaped", stored)
	}
	if !cipher.IsCurrent(stored) {
		t.Error("stored license_number does not authenticate under the primary key")
	}

	// READ (owner, unmasked) → plaintext.
	r.Get("/api/v1/providers/me/licenses", h.ListMyLicenses)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/providers/me/licenses", nil)
	req = addClaimsToRequest(req, providerID, "p@nomarkup.test", []string{"provider"})
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list mine: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if got := firstLicenseNumber(t, rec); got != testLicenseNumber {
		t.Errorf("owner read license_number = %q, want %q", got, testLicenseNumber)
	}
	if strings.Contains(rec.Body.String(), stored) {
		t.Error("ciphertext leaked into the owner licence list")
	}

	// ADMIN review → the RETURNING projection must also decrypt.
	r.Put("/api/v1/admin/licenses/{id}", h.ReviewLicense)
	req = httptest.NewRequest(http.MethodPut, "/api/v1/admin/licenses/"+licenseID,
		strings.NewReader(`{"status":"verified"}`))
	req = addClaimsToRequest(req, adminID, "a@nomarkup.test", []string{"admin"})
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("review: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if got, _ := decodeBody(t, rec)["license_number"].(string); got != testLicenseNumber {
		t.Errorf("ReviewLicense license_number = %q, want %q — the UPDATE ... RETURNING path needs its own decrypt", got, testLicenseNumber)
	}
	if strings.Contains(rec.Body.String(), stored) {
		t.Error("ciphertext leaked into the admin review response")
	}

	// PUBLIC masked read → last 4 of the PLAINTEXT.
	r.Get("/api/v1/providers/{id}/licenses", h.ListProviderVerifiedLicenses)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/providers/"+providerID+"/licenses", nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("public list: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	got := firstLicenseNumber(t, rec)
	want := "••••" + testLicenseNumber[len(testLicenseNumber)-4:]
	if got != want {
		t.Errorf("public masked license_number = %q, want %q (the last 4 of the PLAINTEXT, not of the stored base64)", got, want)
	}
	if got == maskLicenseNumber(stored) {
		t.Error("the public projection is the mask of the CIPHERTEXT — it publishes nonce bytes and masks nothing")
	}
	if strings.Contains(rec.Body.String(), testLicenseNumber) {
		t.Error("the FULL licence number leaked into the public projection")
	}
}

// TestProviderLicenseNumberLegacyPlaintext: rows written before migration 106
// (including the licences migration 062 seeded) are not our wire format and
// must keep reading — masked and unmasked — untouched.
func TestProviderLicenseNumberLegacyPlaintext(t *testing.T) {
	pool := piiTestPool(t)
	cipher, _ := piiTestCipher(t)
	ctx := context.Background()

	providerID := seedPIIUser(t, pool, `{customer,provider}`)
	adminID := seedPIIUser(t, pool, `{admin}`)

	var licenseID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO provider_licenses
		    (provider_id, license_type, license_number, jurisdiction, status, verified_by, verified_at)
		VALUES ($1, 'bar', $2, 'WA', 'verified', $3, now())
		RETURNING id::text`,
		providerID, testLicenseNumber, adminID,
	).Scan(&licenseID); err != nil {
		t.Fatalf("seed legacy licence: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM provider_licenses WHERE id::text = $1`, licenseID)
	})

	h := NewProviderLicenseHandler(pool, cipher)
	r := chi.NewRouter()
	r.Get("/api/v1/providers/me/licenses", h.ListMyLicenses)
	r.Get("/api/v1/providers/{id}/licenses", h.ListProviderVerifiedLicenses)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/providers/me/licenses", nil)
	req = addClaimsToRequest(req, providerID, "p@nomarkup.test", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list mine: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if got := firstLicenseNumber(t, rec); got != testLicenseNumber {
		t.Errorf("legacy plaintext licence = %q, want %q (it must pass through unchanged)", got, testLicenseNumber)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/providers/"+providerID+"/licenses", nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("public list: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	want := "••••" + testLicenseNumber[len(testLicenseNumber)-4:]
	if got := firstLicenseNumber(t, rec); got != want {
		t.Errorf("legacy masked licence = %q, want %q", got, want)
	}
}

// TestProviderLicenseNumberUnopenableFailsClosed: a value that IS our wire
// format but which no configured key opens must never be emitted as base64.
// license_number is NOT NULL and load-bearing in every projection, so the read
// fails closed with a 500 rather than serving a nonce as a licence.
func TestProviderLicenseNumberUnopenableFailsClosed(t *testing.T) {
	pool := piiTestPool(t)
	cipher, foreign := piiTestCipher(t)
	ctx := context.Background()

	providerID := seedPIIUser(t, pool, `{customer,provider}`)
	orphan := mustEncrypt(t, foreign, testLicenseNumber)

	var licenseID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO provider_licenses (provider_id, license_type, license_number, jurisdiction, status)
		VALUES ($1, 'bar', $2, 'WA', 'pending')
		RETURNING id::text`,
		providerID, orphan,
	).Scan(&licenseID); err != nil {
		t.Fatalf("seed orphan licence: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM provider_licenses WHERE id::text = $1`, licenseID)
	})

	h := NewProviderLicenseHandler(pool, cipher)
	r := chi.NewRouter()
	r.Get("/api/v1/providers/me/licenses", h.ListMyLicenses)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/providers/me/licenses", nil)
	req = addClaimsToRequest(req, providerID, "p@nomarkup.test", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("unopenable licence: got %d, want 500", rec.Code)
	}
	if strings.Contains(rec.Body.String(), orphan) {
		t.Error("unopenable ciphertext leaked into the response body")
	}
}

func firstLicenseNumber(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	list, ok := decodeBody(t, rec)["licenses"].([]interface{})
	if !ok || len(list) == 0 {
		t.Fatalf("no licences in response: %s", rec.Body.String())
	}
	row, ok := list[0].(map[string]interface{})
	if !ok {
		t.Fatalf("licence row is not an object: %v", list[0])
	}
	n, _ := row["license_number"].(string)
	return n
}

// ── 2. provider_employees.date_of_birth ──────────────────────────────────

const testEmployeeDOB = "1990-04-17"

// TestEmployeeDOBAtRest proves the sibling-column contract: the encrypted TEXT
// column holds the sealed "YYYY-MM-DD", the legacy DATE column is left NULL,
// and the read hands back the same date string it was given.
func TestEmployeeDOBAtRest(t *testing.T) {
	pool := piiTestPool(t)
	cipher, _ := piiTestCipher(t)
	ctx := context.Background()

	providerID := seedPIIUser(t, pool, `{customer,provider}`)
	h := NewEmployeesHandler(pool, cipher)
	r := chi.NewRouter()
	r.Post("/api/v1/providers/me/employees", h.Create)
	r.Get("/api/v1/providers/me/employees", h.List)
	r.Patch("/api/v1/providers/me/employees/{id}", h.Update)

	body := `{"first_name":"Dana","last_name":"Reed","role":"technician",` +
		`"email":"dana@example.com","phone":"512-555-0123","date_of_birth":"` + testEmployeeDOB + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/providers/me/employees", strings.NewReader(body))
	req = addClaimsToRequest(req, providerID, "p@nomarkup.test", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: got %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	emp, _ := decodeBody(t, rec)["employee"].(map[string]interface{})
	employeeID, _ := emp["id"].(string)
	if employeeID == "" {
		t.Fatal("create returned no employee id")
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM provider_employees WHERE id::text = $1`, employeeID)
	})
	if got, _ := emp["date_of_birth"].(string); got != testEmployeeDOB {
		t.Errorf("create response date_of_birth = %q, want %q", got, testEmployeeDOB)
	}

	// AT REST.
	var (
		rawDate *string
		rawEnc  *string
	)
	if err := pool.QueryRow(ctx,
		`SELECT date_of_birth::text, date_of_birth_encrypted
		   FROM provider_employees WHERE id::text = $1`, employeeID,
	).Scan(&rawDate, &rawEnc); err != nil {
		t.Fatalf("read raw columns: %v", err)
	}
	if rawDate != nil {
		t.Errorf("legacy date_of_birth DATE column = %q, want NULL — the write path must not retain the plaintext date", *rawDate)
	}
	if rawEnc == nil || *rawEnc == "" {
		t.Fatal("date_of_birth_encrypted is empty — nothing was sealed")
	}
	if *rawEnc == testEmployeeDOB {
		t.Fatal("date_of_birth_encrypted holds the CLEAR date")
	}
	if !cipher.IsCurrent(*rawEnc) {
		t.Error("date_of_birth_encrypted does not authenticate under the primary key")
	}

	// READ back through List.
	req = httptest.NewRequest(http.MethodGet, "/api/v1/providers/me/employees", nil)
	req = addClaimsToRequest(req, providerID, "p@nomarkup.test", []string{"provider"})
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if got := firstEmployeeField(t, rec, "date_of_birth"); got != testEmployeeDOB {
		t.Errorf("list date_of_birth = %q, want %q", got, testEmployeeDOB)
	}
	if strings.Contains(rec.Body.String(), *rawEnc) {
		t.Error("date-of-birth ciphertext leaked into the employee list")
	}

	// PATCH a new DOB: the new value is sealed and the DATE column stays NULL.
	const updatedDOB = "1988-12-01"
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/providers/me/employees/"+employeeID,
		strings.NewReader(`{"date_of_birth":"`+updatedDOB+`"}`))
	req = addClaimsToRequest(req, providerID, "p@nomarkup.test", []string{"provider"})
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	upd, _ := decodeBody(t, rec)["employee"].(map[string]interface{})
	if got, _ := upd["date_of_birth"].(string); got != updatedDOB {
		t.Errorf("update response date_of_birth = %q, want %q", got, updatedDOB)
	}
	if err := pool.QueryRow(ctx,
		`SELECT date_of_birth::text, date_of_birth_encrypted
		   FROM provider_employees WHERE id::text = $1`, employeeID,
	).Scan(&rawDate, &rawEnc); err != nil {
		t.Fatalf("re-read raw columns: %v", err)
	}
	if rawDate != nil {
		t.Errorf("after PATCH the legacy DATE column = %q, want NULL", *rawDate)
	}
	if rawEnc == nil || !cipher.IsCurrent(*rawEnc) {
		t.Error("after PATCH date_of_birth_encrypted is not ciphertext under the primary key")
	}
}

// TestEmployeeDOBLegacyRowStillReads: a row the backfill has not reached — a
// DATE with a NULL encrypted sibling — must still render its date of birth.
func TestEmployeeDOBLegacyRowStillReads(t *testing.T) {
	pool := piiTestPool(t)
	cipher, _ := piiTestCipher(t)
	ctx := context.Background()

	providerID := seedPIIUser(t, pool, `{customer,provider}`)

	var employeeID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO provider_employees
		    (provider_id, first_name, last_name, role, date_of_birth, date_of_birth_encrypted, pii_encrypted_v1)
		VALUES ($1, 'Legacy', 'Row', 'technician', $2::date, NULL, TRUE)
		RETURNING id::text`,
		providerID, testEmployeeDOB,
	).Scan(&employeeID); err != nil {
		t.Fatalf("seed legacy employee: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM provider_employees WHERE id::text = $1`, employeeID)
	})

	h := NewEmployeesHandler(pool, cipher)
	r := chi.NewRouter()
	r.Get("/api/v1/providers/me/employees", h.List)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/providers/me/employees", nil)
	req = addClaimsToRequest(req, providerID, "p@nomarkup.test", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	// pii_encrypted_v1 is TRUE on this row even though date_of_birth is a
	// legacy DATE — exactly the drift that makes the flag unusable as a signal.
	if got := firstEmployeeField(t, rec, "date_of_birth"); got != testEmployeeDOB {
		t.Errorf("legacy DATE row date_of_birth = %q, want %q", got, testEmployeeDOB)
	}
}

// TestEmployeeUpdateRejectsMalformedDOB: Update bound date_of_birth straight
// from the body with a $n::date cast while Create ran it through parseDate, so
// a malformed date became a 500 from Postgres instead of a 400.
func TestEmployeeUpdateRejectsMalformedDOB(t *testing.T) {
	pool := piiTestPool(t)
	cipher, _ := piiTestCipher(t)
	ctx := context.Background()

	providerID := seedPIIUser(t, pool, `{customer,provider}`)
	var employeeID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO provider_employees (provider_id, first_name, last_name, role)
		VALUES ($1, 'Dana', 'Reed', 'technician') RETURNING id::text`,
		providerID,
	).Scan(&employeeID); err != nil {
		t.Fatalf("seed employee: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM provider_employees WHERE id::text = $1`, employeeID)
	})

	h := NewEmployeesHandler(pool, cipher)
	r := chi.NewRouter()
	r.Patch("/api/v1/providers/me/employees/{id}", h.Update)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/providers/me/employees/"+employeeID,
		strings.NewReader(`{"date_of_birth":"17/04/1990"}`))
	req = addClaimsToRequest(req, providerID, "p@nomarkup.test", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("malformed date_of_birth: got %d, want 400 (a predictable client error must never be a 500)", rec.Code)
	}
}

func firstEmployeeField(t *testing.T, rec *httptest.ResponseRecorder, field string) string {
	t.Helper()
	list, ok := decodeBody(t, rec)["employees"].([]interface{})
	if !ok || len(list) == 0 {
		t.Fatalf("no employees in response: %s", rec.Body.String())
	}
	row, ok := list[0].(map[string]interface{})
	if !ok {
		t.Fatalf("employee row is not an object: %v", list[0])
	}
	v, _ := row[field].(string)
	return v
}

// ── 3. users.dob ─────────────────────────────────────────────────────────

// TestSetDOBClearsPlaintextAndSealsEvidence: after SetDOB the plaintext DATE
// must be NULL and dob_encrypted must open to the submitted date. users.dob has
// no production read path, so the cleartext buys nothing and costs a full date
// of birth in every backup and replica.
func TestSetDOBClearsPlaintextAndSealsEvidence(t *testing.T) {
	pool := piiTestPool(t)
	cipher, _ := piiTestCipher(t)
	ctx := context.Background()

	userID := seedPIIUser(t, pool, `{customer}`)
	// Pre-seed a legacy plaintext DOB so the test proves SetDOB CLEARS it, not
	// merely that it never wrote one.
	if _, err := pool.Exec(ctx,
		`UPDATE users SET dob = '1985-06-30'::date WHERE id::text = $1`, userID); err != nil {
		t.Fatalf("seed legacy dob: %v", err)
	}

	h := NewComplianceHandler(pool, cipher)
	r := chi.NewRouter()
	r.Put("/api/v1/me/dob", h.SetDOB)
	r.Get("/api/v1/me/age-status", h.GetMyAgeStatus)

	const dob = "1990-04-17"
	req := httptest.NewRequest(http.MethodPut, "/api/v1/me/dob", strings.NewReader(`{"dob":"`+dob+`"}`))
	req = addClaimsToRequest(req, userID, "c@nomarkup.test", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("set dob: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	var (
		rawDate *string
		rawEnc  *string
		verifed *string
	)
	if err := pool.QueryRow(ctx,
		`SELECT dob::text, dob_encrypted, dob_verified_at::text FROM users WHERE id::text = $1`, userID,
	).Scan(&rawDate, &rawEnc, &verifed); err != nil {
		t.Fatalf("read raw columns: %v", err)
	}
	if rawDate != nil {
		t.Errorf("users.dob = %q, want NULL — SetDOB must not retain the plaintext date", *rawDate)
	}
	if rawEnc == nil || *rawEnc == "" {
		t.Fatal("users.dob_encrypted is empty — the evidence was not retained")
	}
	if *rawEnc == dob {
		t.Fatal("users.dob_encrypted holds the CLEAR date")
	}
	if !cipher.IsCurrent(*rawEnc) {
		t.Error("users.dob_encrypted does not authenticate under the primary key")
	}
	plain, err := cipher.DecryptString(*rawEnc)
	if err != nil || plain != dob {
		t.Errorf("dob_encrypted opens to (%q, %v), want (%q, nil)", plain, err, dob)
	}
	if verifed == nil {
		t.Error("dob_verified_at was not stamped — the derived fact is the whole point of the column")
	}

	// The age gate still reads dob_verified_at ALONE and never the DOB.
	req = httptest.NewRequest(http.MethodGet, "/api/v1/me/age-status", nil)
	req = addClaimsToRequest(req, userID, "c@nomarkup.test", []string{"customer"})
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("age status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	status := decodeBody(t, rec)
	if v, _ := status["verified"].(bool); !v {
		t.Errorf("age status verified = %v, want true", status["verified"])
	}
	if strings.Contains(rec.Body.String(), dob) || strings.Contains(rec.Body.String(), *rawEnc) {
		t.Error("the age-status response exposed the date of birth")
	}
}

// TestSetDOBUnderageStillRejected: encrypting the evidence must not weaken the
// in-memory age check that produces the assertion.
func TestSetDOBUnderageStillRejected(t *testing.T) {
	pool := piiTestPool(t)
	cipher, _ := piiTestCipher(t)
	ctx := context.Background()

	userID := seedPIIUser(t, pool, `{customer}`)
	h := NewComplianceHandler(pool, cipher)
	r := chi.NewRouter()
	r.Put("/api/v1/me/dob", h.SetDOB)

	// Clearly under 18. Deliberately not the exact birthday boundary: dob parses
	// as midnight UTC while meetsMinimumAge's cutoff carries the local offset,
	// so the boundary day itself is decided by the server's timezone. That is a
	// pre-existing property of the age check and not what this test is pinning —
	// what it pins is that encrypting the evidence did not weaken the gate.
	var tooYoung string
	if err := pool.QueryRow(ctx,
		`SELECT (now() - interval '10 years')::date::text`).Scan(&tooYoung); err != nil {
		t.Fatalf("compute dob: %v", err)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/v1/me/dob", strings.NewReader(`{"dob":"`+tooYoung+`"}`))
	req = addClaimsToRequest(req, userID, "c@nomarkup.test", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("underage dob: got %d, want 403", rec.Code)
	}

	var rawEnc *string
	if err := pool.QueryRow(ctx,
		`SELECT dob_encrypted FROM users WHERE id::text = $1`, userID).Scan(&rawEnc); err != nil {
		t.Fatalf("read raw column: %v", err)
	}
	if rawEnc != nil {
		t.Error("a rejected DOB was still persisted — the age check must run before anything is written")
	}
}

// ── 4. jobs.service_address in the iCal feed ─────────────────────────────

const testServiceAddress = "456 Service Rd, Austin, TX 78702"

// seedContract stages a customer + job + bid + contract, writing
// jobs.service_address as a LITERAL so a test can stage ciphertext, legacy
// plaintext, or a value under a key this server does not hold.
func seedContract(t *testing.T, pool *pgxpool.Pool, customerID, providerID, address string) {
	t.Helper()
	ctx := context.Background()

	var categoryID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM service_categories LIMIT 1`).Scan(&categoryID); err != nil {
		t.Fatalf("find a service category: %v", err)
	}

	var jobID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO jobs (
		    customer_id, title, description, category_id,
		    service_address, service_city, service_state, service_zip,
		    service_location, approximate_location, status, scheduled_date)
		VALUES ($1, 'Calendar PII Test', 'ICS LOCATION round-trip', $2::uuid,
		        NULLIF($3,''), 'Austin', 'TX', '78702',
		        ST_SetSRID(ST_MakePoint(-97.74, 30.27), 4326),
		        ST_SetSRID(ST_MakePoint(-97.74, 30.27), 4326),
		        'active', now()::date)
		RETURNING id::text`,
		customerID, categoryID, address,
	).Scan(&jobID); err != nil {
		t.Fatalf("seed job: %v", err)
	}

	var bidID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents, status)
		VALUES ($1::uuid, $2::uuid, 25000, 25000, 'awarded')
		RETURNING id::text`, jobID, providerID,
	).Scan(&bidID); err != nil {
		t.Fatalf("seed bid: %v", err)
	}

	var contractID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO contracts (
		    contract_number, job_id, customer_id, provider_id, bid_id,
		    amount_cents, payment_timing, status, started_at)
		VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
		        25000, 'completion', 'active', now())
		RETURNING id::text`,
		"NM-PII-"+piiRandSuffix(t), jobID, customerID, providerID, bidID,
	).Scan(&contractID); err != nil {
		t.Fatalf("seed contract: %v", err)
	}

	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM contracts WHERE id::text = $1`, contractID)
		_, _ = pool.Exec(ctx, `DELETE FROM bids WHERE id::text = $1`, bidID)
		_, _ = pool.Exec(ctx, `DELETE FROM jobs WHERE id::text = $1`, jobID)
	})
}

func runCalendarExport(t *testing.T, pool *pgxpool.Pool, cipher *crypto.Cipher, userID string) string {
	t.Helper()
	h := NewCalendarExportHandler(pool, nil, cipher)
	r := chi.NewRouter()
	r.Get("/api/v1/me/calendar.ics", h.ExportICS)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/calendar.ics", nil)
	req = addClaimsToRequest(req, userID, "c@nomarkup.test", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("calendar export: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	return rec.Body.String()
}

// TestCalendarExportDecryptsServiceAddress: the ICS LOCATION must carry the
// readable address, never the stored base64.
func TestCalendarExportDecryptsServiceAddress(t *testing.T) {
	pool := piiTestPool(t)
	cipher, _ := piiTestCipher(t)

	customerID := seedPIIUser(t, pool, `{customer}`)
	providerID := seedPIIUser(t, pool, `{provider}`)
	ct := mustEncrypt(t, cipher, testServiceAddress)
	seedContract(t, pool, customerID, providerID, ct)

	ics := runCalendarExport(t, pool, cipher, customerID)

	if !strings.Contains(ics, "LOCATION:456 Service Rd") {
		t.Errorf("ICS has no decrypted LOCATION line:\n%s", ics)
	}
	if strings.Contains(ics, ct) {
		t.Error("the stored ciphertext was emitted verbatim as the ICS LOCATION")
	}
}

// TestCalendarExportLegacyPlaintextAddress: a row written before migration 104
// is not our wire format and passes straight through.
func TestCalendarExportLegacyPlaintextAddress(t *testing.T) {
	pool := piiTestPool(t)
	cipher, _ := piiTestCipher(t)

	customerID := seedPIIUser(t, pool, `{customer}`)
	providerID := seedPIIUser(t, pool, `{provider}`)
	seedContract(t, pool, customerID, providerID, testServiceAddress)

	ics := runCalendarExport(t, pool, cipher, customerID)
	if !strings.Contains(ics, "LOCATION:456 Service Rd") {
		t.Errorf("legacy plaintext address did not survive:\n%s", ics)
	}
}

// TestCalendarExportOmitsUnopenableAddress: an address sealed under a key this
// server does not hold must produce a VEVENT with NO LOCATION — and must not
// abort the feed. A calendar entry missing an address beats one leaking base64,
// and beats no calendar at all.
func TestCalendarExportOmitsUnopenableAddress(t *testing.T) {
	pool := piiTestPool(t)
	cipher, foreign := piiTestCipher(t)

	customerID := seedPIIUser(t, pool, `{customer}`)
	providerID := seedPIIUser(t, pool, `{provider}`)
	orphan := mustEncrypt(t, foreign, testServiceAddress)
	seedContract(t, pool, customerID, providerID, orphan)

	ics := runCalendarExport(t, pool, cipher, customerID)

	if strings.Contains(ics, orphan) {
		t.Error("unopenable ciphertext was emitted as the ICS LOCATION")
	}
	if strings.Contains(ics, "LOCATION:") {
		t.Errorf("expected no LOCATION line for an unopenable address:\n%s", ics)
	}
	// The event itself — and the feed — must still be there.
	if !strings.Contains(ics, "BEGIN:VEVENT") {
		t.Errorf("the whole event was dropped; one bad address must not empty the feed:\n%s", ics)
	}
	if !strings.Contains(ics, "END:VCALENDAR") {
		t.Errorf("the feed was truncated:\n%s", ics)
	}
}
