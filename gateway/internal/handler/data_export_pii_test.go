package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
)

// ── hermetic: decryptPII's four branches ─────────────────────────────────

func newExportCipher(t *testing.T) (*crypto.Cipher, [crypto.KeySize]byte) {
	t.Helper()
	var k [crypto.KeySize]byte
	for i := range k {
		k[i] = byte(i * 7)
	}
	return crypto.New(&k, nil), k
}

// TestDecryptPIIBranches pins the exact contract the GDPR export depends on.
// Before this fix the handler had no cipher at all and returned the raw column,
// so a data subject exercising their Art. 15 right received base64.
func TestDecryptPIIBranches(t *testing.T) {
	t.Parallel()
	cipher, _ := newExportCipher(t)
	h := &DataExportHandler{cipher: cipher}

	ct, err := cipher.EncryptString("512-555-0001")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	// A ciphertext under a key this handler does NOT hold.
	var foreign [crypto.KeySize]byte
	for i := range foreign {
		foreign[i] = byte(255 - i)
	}
	orphan, err := crypto.New(&foreign, nil).EncryptString("512-555-0001")
	if err != nil {
		t.Fatalf("encrypt foreign: %v", err)
	}

	str := func(s string) *string { return &s }

	tests := []struct {
		name  string
		in    *string
		want  interface{}
		notEq string // value that must NOT be returned
	}{
		{"nil", nil, nil, ""},
		{"empty", str(""), "", ""},
		{"ciphertext decrypts", str(ct), "512-555-0001", ct},
		{"legacy plaintext passes through", str("512-555-0001"), "512-555-0001", ""},
		{"legacy plaintext address", str("456 Service Rd, Austin, TX 78702"), "456 Service Rd, Austin, TX 78702", ""},
		{"legacy plaintext ein", str("12-3456789"), "12-3456789", ""},
		{"unopenable ciphertext is withheld", str(orphan), piiUnavailable, orphan},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := h.decryptPII(tc.in)
			if got != tc.want {
				t.Errorf("decryptPII = %v, want %v", got, tc.want)
			}
			if tc.notEq != "" && got == tc.notEq {
				t.Errorf("decryptPII returned the RAW stored value %q — the export must never emit ciphertext", tc.notEq)
			}
		})
	}
}

// TestDecryptPIINoCipherWithholds: with no key configured the handler must
// withhold rather than risk emitting ciphertext.
func TestDecryptPIINoCipherWithholds(t *testing.T) {
	t.Parallel()
	h := &DataExportHandler{}
	v := "anything"
	if got := h.decryptPII(&v); got != piiUnavailable {
		t.Fatalf("decryptPII = %v, want %v", got, piiUnavailable)
	}
}

// ── live DB: the full export document ────────────────────────────────────

// seedExportProvider inserts a user + provider_profile writing the PII columns
// as LITERAL values, so a test can stage ciphertext, plaintext, or a mix.
func seedExportProvider(t *testing.T, pool *pgxpool.Pool, phone, addr, ein, policy string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, phone, roles, status)
		VALUES ($1, 'x', 'PII Export Test', NULLIF($2,''), ARRAY['customer','provider'], 'active')
		RETURNING id::text`,
		"exp-pii-"+randSuffix()+"@nomarkup.test", phone,
	).Scan(&id); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO provider_profiles
		    (user_id, business_name, service_address, ein_tin,
		     insurance_provider, insurance_policy_number)
		VALUES ($1, 'Acme LLC', NULLIF($2,''), NULLIF($3,''), 'Carrier Co', NULLIF($4,''))`,
		id, addr, ein, policy,
	); err != nil {
		t.Fatalf("seed provider_profile: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM provider_profiles WHERE user_id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

// runExport executes the handler for userID and returns the parsed document.
func runExport(t *testing.T, pool *pgxpool.Pool, cipher *crypto.Cipher, userID string) (map[string]interface{}, string) {
	t.Helper()
	h := NewDataExportHandler(pool, cipher)
	r := chi.NewRouter()
	r.Get("/api/v1/users/me/export", h.ExportMyData)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/export", nil)
	req = addClaimsToRequest(req, userID, "exp@nomarkup.test", []string{"customer", "provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("export: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return parsed, rec.Body.String()
}

func exportField(t *testing.T, doc map[string]interface{}, section, field string) interface{} {
	t.Helper()
	sec, ok := doc[section].(map[string]interface{})
	if !ok {
		t.Fatalf("section %q missing or not an object: %v", section, doc[section])
	}
	return sec[field]
}

const (
	expPhone   = "512-555-0001"
	expAddr    = "456 Service Rd, Austin, TX 78702"
	expEIN     = "12-3456789"
	expPolicy  = "POL-0099887766"
	expCarrier = "Carrier Co"
)

// TestDataExportDecryptsPII is the GDPR Art. 15 regression test: every
// encrypted column must come back READABLE, and its ciphertext must appear
// nowhere in the document.
func TestDataExportDecryptsPII(t *testing.T) {
	pool := testExportPool(t)
	cipher, _ := newExportCipher(t)

	enc := func(s string) string {
		ct, err := cipher.EncryptString(s)
		if err != nil {
			t.Fatalf("encrypt: %v", err)
		}
		return ct
	}
	ctPhone, ctAddr, ctEIN, ctPolicy := enc(expPhone), enc(expAddr), enc(expEIN), enc(expPolicy)

	userID := seedExportProvider(t, pool, ctPhone, ctAddr, ctEIN, ctPolicy)
	doc, body := runExport(t, pool, cipher, userID)

	for _, c := range []struct {
		section, field string
		want, cipher   string
	}{
		{"profile", "phone", expPhone, ctPhone},
		{"provider_profile", "service_address", expAddr, ctAddr},
		{"provider_profile", "ein_tin", expEIN, ctEIN},
		{"provider_profile", "insurance_policy_number", expPolicy, ctPolicy},
	} {
		got := exportField(t, doc, c.section, c.field)
		if got != c.want {
			t.Errorf("%s.%s = %v, want %q", c.section, c.field, got, c.want)
		}
		if got == c.cipher {
			t.Errorf("%s.%s returned RAW CIPHERTEXT", c.section, c.field)
		}
		if containsStr(body, c.cipher) {
			t.Errorf("ciphertext for %s.%s leaked into the export document", c.section, c.field)
		}
	}

	// insurance_provider is deliberately NOT encrypted; it must survive intact.
	if got := exportField(t, doc, "provider_profile", "insurance_provider"); got != expCarrier {
		t.Errorf("insurance_provider = %v, want %q", got, expCarrier)
	}
}

// TestDataExportLegacyPlaintextMixedCase is the mixed-state requirement: a row
// where some columns were backfilled and others were not must export cleanly,
// with NO field erroring the document.
func TestDataExportLegacyPlaintextMixedCase(t *testing.T) {
	pool := testExportPool(t)
	cipher, _ := newExportCipher(t)

	ctAddr, err := cipher.EncryptString(expAddr)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	// phone + ein_tin + policy are LEGACY PLAINTEXT; service_address is encrypted.
	userID := seedExportProvider(t, pool, expPhone, ctAddr, expEIN, expPolicy)
	doc, _ := runExport(t, pool, cipher, userID)

	for _, c := range []struct {
		section, field, want string
	}{
		{"profile", "phone", expPhone},
		{"provider_profile", "service_address", expAddr},
		{"provider_profile", "ein_tin", expEIN},
		{"provider_profile", "insurance_policy_number", expPolicy},
	} {
		got := exportField(t, doc, c.section, c.field)
		if got != c.want {
			t.Errorf("%s.%s = %v, want %q (legacy plaintext must pass through, encrypted must decrypt)",
				c.section, c.field, got, c.want)
		}
	}
	if _, hasErr := doc["provider_profile"].(map[string]interface{})["_error"]; hasErr {
		t.Error("provider_profile section errored; a mixed row must not fail the export")
	}
}

// TestDataExportNullBusinessName is the dual-role residual: a provider_profiles
// row with NULL business_name (and other optional TEXT columns) must still
// export as 200 without a provider_profile _error section. Scanning into a
// plain string used to soft-fail the section (evening red-team 2026-08-05).
func TestDataExportNullBusinessName(t *testing.T) {
	pool := testExportPool(t)
	cipher, _ := newExportCipher(t)
	ctx := context.Background()

	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, roles, status)
		VALUES ($1, 'x', 'Null Biz Export', ARRAY['customer','provider'], 'active')
		RETURNING id::text`,
		"exp-null-biz-"+randSuffix()+"@nomarkup.test",
	).Scan(&id); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	// Minimal provider row: only user_id; business_name and optional TEXT stay NULL.
	if _, err := pool.Exec(ctx, `
		INSERT INTO provider_profiles (user_id) VALUES ($1)`, id); err != nil {
		t.Fatalf("seed bare provider_profile: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM provider_profiles WHERE user_id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	})

	doc, _ := runExport(t, pool, cipher, id)
	pp, ok := doc["provider_profile"].(map[string]interface{})
	if !ok {
		t.Fatalf("provider_profile missing or wrong type: %T", doc["provider_profile"])
	}
	if _, hasErr := pp["_error"]; hasErr {
		t.Fatalf("provider_profile soft-failed: %v", pp)
	}
	if pp["id"] == nil || pp["id"] == "" {
		t.Errorf("provider_profile.id missing; got %#v", pp)
	}
	if pp["business_name"] != nil {
		t.Errorf("business_name = %v, want null/nil for bare profile", pp["business_name"])
	}
	if pp["bio"] != nil {
		t.Errorf("bio = %v, want null/nil", pp["bio"])
	}
	if pp["insurance_provider"] != nil {
		t.Errorf("insurance_provider = %v, want null/nil", pp["insurance_provider"])
	}
}

// TestDataExportWithdholdsUnopenableCiphertext: a value encrypted under a key
// the gateway does not hold must be reported as unavailable — never dumped as
// base64 and never allowed to 500 the whole export.
func TestDataExportWithdholdsUnopenableCiphertext(t *testing.T) {
	pool := testExportPool(t)
	cipher, _ := newExportCipher(t)

	var foreign [crypto.KeySize]byte
	for i := range foreign {
		foreign[i] = byte(199 - i)
	}
	orphan, err := crypto.New(&foreign, nil).EncryptString(expEIN)
	if err != nil {
		t.Fatalf("encrypt foreign: %v", err)
	}
	ctAddr, err := cipher.EncryptString(expAddr)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	userID := seedExportProvider(t, pool, "", ctAddr, orphan, "")
	doc, body := runExport(t, pool, cipher, userID)

	if got := exportField(t, doc, "provider_profile", "ein_tin"); got != piiUnavailable {
		t.Errorf("ein_tin = %v, want %q", got, piiUnavailable)
	}
	if containsStr(body, orphan) {
		t.Error("unopenable ciphertext leaked into the export document")
	}
	// The rest of the document still works.
	if got := exportField(t, doc, "provider_profile", "service_address"); got != expAddr {
		t.Errorf("service_address = %v, want %q — one bad field must not poison the section", got, expAddr)
	}
}

func containsStr(haystack, needle string) bool {
	if needle == "" {
		return false
	}
	return len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}
