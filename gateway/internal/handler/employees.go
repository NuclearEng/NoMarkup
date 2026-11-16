package handler

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// EmployeesHandler handles provider employee CRUD. The team table lives in
// the gateway DB pool because there is no dedicated employee microservice —
// it's a CRUD-only resource owned by the provider, mirroring the savings
// pattern in user.go.
//
// Sensitive columns (email, phone, license_number, insurance_policy_number)
// are encrypted at rest via crypto.Cipher since migration 033;
// date_of_birth joined them in migration 106, which added the sibling
// date_of_birth_encrypted TEXT column because secretbox output cannot live in
// a DATE.
//
// Detection is per VALUE, by AUTHENTICATION — the pii_encrypted_v1 flag is
// advisory only (migration 098) and is NOT branched on: the flag is per ROW
// while encryption is per COLUMN, so a row whose email was rewritten through
// the encrypting update path reads TRUE even while a sibling column is still
// the plaintext the backfill never revisited.
type EmployeesHandler struct {
	db     *pgxpool.Pool
	cipher *crypto.Cipher
}

// NewEmployeesHandler constructs a handler. cipher is required; in dev it
// can come from crypto.FromEnv() with no ENCRYPTION_KEY set (ephemeral).
func NewEmployeesHandler(db *pgxpool.Pool, cipher *crypto.Cipher) *EmployeesHandler {
	return &EmployeesHandler{db: db, cipher: cipher}
}

// employeeRow shapes the JSON response so the frontend's CompanyEmployee
// type can consume it directly.
type employeeRow struct {
	ID                    string  `json:"id"`
	ProviderID            string  `json:"provider_id"`
	FirstName             string  `json:"first_name"`
	LastName              string  `json:"last_name"`
	Email                 *string `json:"email"`
	Phone                 *string `json:"phone"`
	DateOfBirth           *string `json:"date_of_birth"`
	Role                  string  `json:"role"`
	Status                string  `json:"status"`
	HireDate              *string `json:"hire_date"`
	BackgroundCheckStatus string  `json:"background_check_status"`
	BackgroundCheckDate   *string `json:"background_check_date"`
	LicenseNumber         *string `json:"license_number"`
	LicenseState          *string `json:"license_state"`
	LicenseExpiry         *string `json:"license_expiry"`
	InsurancePolicyNumber *string `json:"insurance_policy_number"`
	InsuranceExpiry       *string `json:"insurance_expiry"`
	CreatedAt             string  `json:"created_at"`
}

func dateToString(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format("2006-01-02")
	return &s
}

// isoDate renders a parsed date as the canonical "YYYY-MM-DD" plaintext that
// goes into the cipher, or "" when absent. Normalising here means the encrypted
// column always holds exactly the format scanEmployee hands back to clients.
func isoDate(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format("2006-01-02")
}

func parseDate(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// scanEmployee scans a row and decrypts the encrypted PII columns.
//
// Every encrypted column is resolved per VALUE via
// crypto.DecryptStringOrPassthrough: a value that opens under a configured key
// is returned as plaintext, a value that is not our wire format at all is
// legacy plaintext and passes through unchanged, and a value that IS our wire
// format but which no configured key opens is an error — the raw base64 is
// never handed to a caller. pii_encrypted_v1 is still selected (and logged on
// failure) for observability, but nothing branches on it.
func scanEmployee(row pgx.Row, cipher *crypto.Cipher) (employeeRow, error) {
	var (
		e            employeeRow
		email        sql.NullString
		phone        sql.NullString
		dob          sql.NullTime
		hireDate     sql.NullTime
		bgDate       sql.NullTime
		licNumber    sql.NullString
		licState     sql.NullString
		licExpiry    sql.NullTime
		insPolicy    sql.NullString
		insExpiry    sql.NullTime
		createdAt    time.Time
		piiEncrypted bool
		dobEncrypted sql.NullString
	)
	if err := row.Scan(
		&e.ID, &e.ProviderID, &e.FirstName, &e.LastName,
		&email, &phone, &dob, &e.Role, &e.Status, &hireDate,
		&e.BackgroundCheckStatus, &bgDate,
		&licNumber, &licState, &licExpiry,
		&insPolicy, &insExpiry, &createdAt, &piiEncrypted,
		&dobEncrypted,
	); err != nil {
		return employeeRow{}, err
	}
	decrypt := func(field, value string) (string, error) {
		v, err := decryptEmployeePII(cipher, value)
		if err != nil {
			slog.Error("employee PII decrypt failed",
				"employee_id", e.ID, "field", field,
				"pii_encrypted_v1", piiEncrypted, "error", err)
			return "", err
		}
		return v, nil
	}
	if email.Valid {
		v, err := decrypt("email", email.String)
		if err != nil {
			return employeeRow{}, err
		}
		e.Email = &v
	}
	if phone.Valid {
		v, err := decrypt("phone", phone.String)
		if err != nil {
			return employeeRow{}, err
		}
		e.Phone = &v
	}
	// Prefer the encrypted column (migration 106); fall back to the legacy DATE
	// for rows the backfill has not reached. The two are mutually exclusive on
	// every row this handler writes — Create/Update NULL the DATE.
	switch {
	case dobEncrypted.Valid && dobEncrypted.String != "":
		v, err := decrypt("date_of_birth", dobEncrypted.String)
		if err != nil {
			return employeeRow{}, err
		}
		e.DateOfBirth = &v
	case dob.Valid:
		e.DateOfBirth = dateToString(&dob.Time)
	}
	if hireDate.Valid {
		e.HireDate = dateToString(&hireDate.Time)
	}
	if bgDate.Valid {
		e.BackgroundCheckDate = dateToString(&bgDate.Time)
	}
	if licNumber.Valid {
		v, err := decrypt("license_number", licNumber.String)
		if err != nil {
			return employeeRow{}, err
		}
		e.LicenseNumber = &v
	}
	if licState.Valid {
		e.LicenseState = &licState.String
	}
	if licExpiry.Valid {
		e.LicenseExpiry = dateToString(&licExpiry.Time)
	}
	if insPolicy.Valid {
		v, err := decrypt("insurance_policy_number", insPolicy.String)
		if err != nil {
			return employeeRow{}, err
		}
		e.InsurancePolicyNumber = &v
	}
	if insExpiry.Valid {
		e.InsuranceExpiry = dateToString(&insExpiry.Time)
	}
	e.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	return e, nil
}

// decryptEmployeePII resolves one stored PII column to plaintext.
//
// It deliberately takes NO pii_encrypted_v1 argument. The predecessor of this
// function branched on that flag, which is per ROW while encryption is per
// COLUMN: a row re-written through the encrypting update path is flagged TRUE
// even when a sibling column is still the plaintext the backfill never
// revisited, so the flag both decrypts plaintext (error) and passes ciphertext
// through (leak) depending on which way it is wrong. Per-value authentication
// cannot drift that way — see migration 098 and
// crypto.DecryptStringOrPassthrough.
func decryptEmployeePII(cipher *crypto.Cipher, value string) (string, error) {
	if value == "" {
		return value, nil
	}
	if cipher == nil {
		// No key at all: we cannot tell ciphertext from plaintext, and emitting
		// a possible ciphertext is the failure mode being prevented.
		return "", fmt.Errorf("%w: no PII cipher configured for provider_employees", crypto.ErrKeyMissing)
	}
	return cipher.DecryptStringOrPassthrough(value)
}

// encryptIfNonEmpty returns base64 ciphertext for non-empty s, or "" for
// empty s. Empty strings are passed through so NULLIF($n, '') in SQL keeps
// behaving as before.
func encryptIfNonEmpty(cipher *crypto.Cipher, s string) (string, error) {
	if s == "" {
		return "", nil
	}
	return cipher.EncryptString(s)
}

// employeeColumns is the shared projection for every read and every
// INSERT/UPDATE ... RETURNING. date_of_birth_encrypted is appended LAST so the
// scan order in scanEmployee stays aligned; pii_encrypted_v1 is kept purely for
// observability (nothing branches on it — see decryptEmployeePII).
const employeeColumns = `id, provider_id, first_name, last_name, email, phone,
        date_of_birth, role, status, hire_date,
        background_check_status, background_check_date,
        license_number, license_state, license_expiry,
        insurance_policy_number, insurance_expiry, created_at, pii_encrypted_v1,
        date_of_birth_encrypted`

// List handles GET /api/v1/providers/me/employees.
func (h *EmployeesHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"employees": []interface{}{}})
		return
	}

	rows, err := h.db.Query(r.Context(),
		`SELECT `+employeeColumns+` FROM provider_employees WHERE provider_id = $1 ORDER BY created_at DESC`,
		claims.UserID,
	)
	if err != nil {
		slog.Error("list employees failed", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list employees")
		return
	}
	defer rows.Close()

	employees := make([]employeeRow, 0)
	for rows.Next() {
		emp, err := scanEmployee(rows, h.cipher)
		if err != nil {
			slog.Error("scan employee failed", "user_id", claims.UserID, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read employees")
			return
		}
		employees = append(employees, emp)
	}
	if err := rows.Err(); err != nil {
		slog.Error("iterate employees failed", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list employees")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"employees": employees})
}

type addEmployeeBody struct {
	FirstName     string `json:"first_name"`
	LastName      string `json:"last_name"`
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	DateOfBirth   string `json:"date_of_birth"`
	Role          string `json:"role"`
	LicenseNumber string `json:"license_number"`
	LicenseState  string `json:"license_state"`
	LicenseExpiry string `json:"license_expiry"`
}

// Create handles POST /api/v1/providers/me/employees.
func (h *EmployeesHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	var body addEmployeeBody
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.FirstName == "" || body.LastName == "" || body.Role == "" {
		writeError(w, http.StatusBadRequest, "first_name, last_name, role are required")
		return
	}

	dob, err := parseDate(body.DateOfBirth)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid date_of_birth (expected YYYY-MM-DD)")
		return
	}
	licExpiry, err := parseDate(body.LicenseExpiry)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid license_expiry (expected YYYY-MM-DD)")
		return
	}

	encEmail, err := encryptIfNonEmpty(h.cipher, body.Email)
	if err != nil {
		slog.Error("encrypt employee email", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create employee")
		return
	}
	encPhone, err := encryptIfNonEmpty(h.cipher, body.Phone)
	if err != nil {
		slog.Error("encrypt employee phone", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create employee")
		return
	}
	encLicense, err := encryptIfNonEmpty(h.cipher, body.LicenseNumber)
	if err != nil {
		slog.Error("encrypt employee license", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create employee")
		return
	}
	// Migration 106: the date of birth is sealed into date_of_birth_encrypted
	// and the plaintext DATE column is written NULL. A DATE cannot hold base64
	// secretbox output, hence the sibling column rather than a type change.
	encDOB, err := encryptIfNonEmpty(h.cipher, isoDate(dob))
	if err != nil {
		slog.Error("encrypt employee date_of_birth", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create employee")
		return
	}

	row := h.db.QueryRow(r.Context(),
		`INSERT INTO provider_employees (
            provider_id, first_name, last_name, email, phone,
            date_of_birth, date_of_birth_encrypted,
            role, status, license_number, license_state, license_expiry,
            pii_encrypted_v1
        ) VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''),
                  NULL, NULLIF($6, ''), $7, 'active',
                  NULLIF($8, ''), NULLIF($9, ''), $10, TRUE)
        RETURNING `+employeeColumns,
		claims.UserID, body.FirstName, body.LastName, encEmail, encPhone, encDOB,
		body.Role, encLicense, body.LicenseState, licExpiry,
	)
	emp, err := scanEmployee(row, h.cipher)
	if err != nil {
		slog.Error("create employee failed", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create employee")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{"employee": emp})
}

type updateEmployeeBody struct {
	FirstName     *string `json:"first_name"`
	LastName      *string `json:"last_name"`
	Email         *string `json:"email"`
	Phone         *string `json:"phone"`
	DateOfBirth   *string `json:"date_of_birth"`
	Role          *string `json:"role"`
	Status        *string `json:"status"`
	LicenseNumber *string `json:"license_number"`
	LicenseState  *string `json:"license_state"`
	LicenseExpiry *string `json:"license_expiry"`
}

// Update handles PATCH /api/v1/providers/me/employees/{id}.
func (h *EmployeesHandler) Update(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "employee id required")
		return
	}
	if !isValidUUID(id) {
		// Without this, a non-UUID path param reaches Postgres as an invalid
		// uuid cast and surfaces as a 500. A malformed id is a client error.
		writeError(w, http.StatusBadRequest, "invalid employee id")
		return
	}

	var body updateEmployeeBody
	if !decodeJSON(w, r, &body) {
		return
	}

	encEmail, err := encryptOptional(h.cipher, body.Email)
	if err != nil {
		slog.Error("encrypt update email", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update employee")
		return
	}
	encPhone, err := encryptOptional(h.cipher, body.Phone)
	if err != nil {
		slog.Error("encrypt update phone", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update employee")
		return
	}
	encLicense, err := encryptOptional(h.cipher, body.LicenseNumber)
	if err != nil {
		slog.Error("encrypt update license", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update employee")
		return
	}

	// date_of_birth was previously bound straight from the request body as a
	// raw *string and cast with $7::date — unlike Create, which runs the same
	// field through parseDate. A malformed date therefore reached Postgres and
	// surfaced as a 500 instead of a 400. Validate it here on the same path as
	// Create, then seal it (migration 106).
	dob, err := parseDate(derefOrEmpty(body.DateOfBirth))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid date_of_birth (expected YYYY-MM-DD)")
		return
	}
	var encDOB *string
	if body.DateOfBirth != nil {
		ct, err := encryptIfNonEmpty(h.cipher, isoDate(dob))
		if err != nil {
			slog.Error("encrypt update date_of_birth", "user_id", claims.UserID, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to update employee")
			return
		}
		encDOB = &ct
	}
	if body.LicenseExpiry != nil {
		if _, err := parseDate(*body.LicenseExpiry); err != nil {
			writeError(w, http.StatusBadRequest, "invalid license_expiry (expected YYYY-MM-DD)")
			return
		}
	}

	// COALESCE on each column so callers can patch any subset. Whenever any
	// PII column is touched the row is re-flagged TRUE, which is safe even
	// if the column itself wasn't included in this patch (existing
	// ciphertext stays valid; new plaintext PII is now ciphertext). The flag
	// is advisory only — no read path branches on it.
	//
	// When a new date of birth IS supplied it lands in date_of_birth_encrypted
	// and the legacy plaintext DATE is cleared in the same statement, so a row
	// can never carry both. When it is not supplied both columns are untouched,
	// leaving a not-yet-backfilled legacy DATE readable.
	row := h.db.QueryRow(r.Context(), `
        UPDATE provider_employees SET
            first_name = COALESCE($3, first_name),
            last_name = COALESCE($4, last_name),
            email = COALESCE(NULLIF($5, ''), email),
            phone = COALESCE(NULLIF($6, ''), phone),
            date_of_birth_encrypted = COALESCE(NULLIF($7, ''), date_of_birth_encrypted),
            date_of_birth = CASE WHEN NULLIF($7, '') IS NOT NULL THEN NULL ELSE date_of_birth END,
            role = COALESCE($8, role),
            status = COALESCE($9, status),
            license_number = COALESCE(NULLIF($10, ''), license_number),
            license_state = COALESCE(NULLIF($11, ''), license_state),
            license_expiry = COALESCE($12::date, license_expiry),
            pii_encrypted_v1 = TRUE
        WHERE id = $1 AND provider_id = $2
        RETURNING `+employeeColumns,
		id, claims.UserID,
		body.FirstName, body.LastName, encEmail, encPhone, encDOB,
		body.Role, body.Status, encLicense, body.LicenseState, body.LicenseExpiry,
	)
	emp, err := scanEmployee(row, h.cipher)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "employee not found")
			return
		}
		slog.Error("update employee failed", "user_id", claims.UserID, "id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update employee")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"employee": emp})
}

// derefOrEmpty flattens an optional PATCH field to a string; a nil pointer
// (field absent) reads as "" so parseDate treats it as "no change requested".
func derefOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// encryptOptional handles a *string from a PATCH body: nil → nil (no change
// requested), "" → "" (clear), otherwise → ciphertext.
func encryptOptional(cipher *crypto.Cipher, s *string) (*string, error) {
	if s == nil {
		return nil, nil
	}
	ct, err := encryptIfNonEmpty(cipher, *s)
	if err != nil {
		return nil, err
	}
	return &ct, nil
}

// Delete handles DELETE /api/v1/providers/me/employees/{id}.
func (h *EmployeesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "employee id required")
		return
	}
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid employee id")
		return
	}

	tag, err := h.db.Exec(r.Context(),
		`DELETE FROM provider_employees WHERE id = $1 AND provider_id = $2`,
		id, claims.UserID,
	)
	if err != nil {
		slog.Error("delete employee failed", "user_id", claims.UserID, "id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to delete employee")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "employee not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}
