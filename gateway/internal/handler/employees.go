package handler

import (
	"database/sql"
	"errors"
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
// are encrypted at rest via crypto.Cipher and the pii_encrypted_v1 flag added
// in migration 033.
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

// scanEmployee scans a row and decrypts encrypted PII fields when the row's
// pii_encrypted_v1 flag is true. Legacy rows (flag=false) pass plaintext
// through so the gateway keeps working pre-backfill.
func scanEmployee(row pgx.Row, cipher *crypto.Cipher) (employeeRow, error) {
	var (
		e             employeeRow
		email         sql.NullString
		phone         sql.NullString
		dob           sql.NullTime
		hireDate      sql.NullTime
		bgDate        sql.NullTime
		licNumber     sql.NullString
		licState      sql.NullString
		licExpiry     sql.NullTime
		insPolicy     sql.NullString
		insExpiry     sql.NullTime
		createdAt     time.Time
		piiEncrypted  bool
	)
	if err := row.Scan(
		&e.ID, &e.ProviderID, &e.FirstName, &e.LastName,
		&email, &phone, &dob, &e.Role, &e.Status, &hireDate,
		&e.BackgroundCheckStatus, &bgDate,
		&licNumber, &licState, &licExpiry,
		&insPolicy, &insExpiry, &createdAt, &piiEncrypted,
	); err != nil {
		return employeeRow{}, err
	}
	if email.Valid {
		v, err := decryptIfEncrypted(cipher, email.String, piiEncrypted)
		if err != nil {
			return employeeRow{}, err
		}
		e.Email = &v
	}
	if phone.Valid {
		v, err := decryptIfEncrypted(cipher, phone.String, piiEncrypted)
		if err != nil {
			return employeeRow{}, err
		}
		e.Phone = &v
	}
	if dob.Valid {
		e.DateOfBirth = dateToString(&dob.Time)
	}
	if hireDate.Valid {
		e.HireDate = dateToString(&hireDate.Time)
	}
	if bgDate.Valid {
		e.BackgroundCheckDate = dateToString(&bgDate.Time)
	}
	if licNumber.Valid {
		v, err := decryptIfEncrypted(cipher, licNumber.String, piiEncrypted)
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
		v, err := decryptIfEncrypted(cipher, insPolicy.String, piiEncrypted)
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

// decryptIfEncrypted returns plaintext when piiEncrypted is true, otherwise
// returns the value untouched so legacy rows keep working.
func decryptIfEncrypted(cipher *crypto.Cipher, value string, piiEncrypted bool) (string, error) {
	if !piiEncrypted || value == "" {
		return value, nil
	}
	return cipher.DecryptString(value)
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

const employeeColumns = `id, provider_id, first_name, last_name, email, phone,
        date_of_birth, role, status, hire_date,
        background_check_status, background_check_date,
        license_number, license_state, license_expiry,
        insurance_policy_number, insurance_expiry, created_at, pii_encrypted_v1`

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

	row := h.db.QueryRow(r.Context(),
		`INSERT INTO provider_employees (
            provider_id, first_name, last_name, email, phone, date_of_birth,
            role, status, license_number, license_state, license_expiry,
            pii_encrypted_v1
        ) VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6, $7, 'active',
                  NULLIF($8, ''), NULLIF($9, ''), $10, TRUE)
        RETURNING `+employeeColumns,
		claims.UserID, body.FirstName, body.LastName, encEmail, encPhone, dob,
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

	// COALESCE on each column so callers can patch any subset. Whenever any
	// PII column is touched the row is re-flagged TRUE, which is safe even
	// if the column itself wasn't included in this patch (existing
	// ciphertext stays valid; new plaintext PII is now ciphertext).
	row := h.db.QueryRow(r.Context(), `
        UPDATE provider_employees SET
            first_name = COALESCE($3, first_name),
            last_name = COALESCE($4, last_name),
            email = COALESCE(NULLIF($5, ''), email),
            phone = COALESCE(NULLIF($6, ''), phone),
            date_of_birth = COALESCE($7::date, date_of_birth),
            role = COALESCE($8, role),
            status = COALESCE($9, status),
            license_number = COALESCE(NULLIF($10, ''), license_number),
            license_state = COALESCE(NULLIF($11, ''), license_state),
            license_expiry = COALESCE($12::date, license_expiry),
            pii_encrypted_v1 = TRUE
        WHERE id = $1 AND provider_id = $2
        RETURNING `+employeeColumns,
		id, claims.UserID,
		body.FirstName, body.LastName, encEmail, encPhone, body.DateOfBirth,
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
