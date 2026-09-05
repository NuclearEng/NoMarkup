package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func newJobReportsRouter(h *JobReportsHandler) chi.Router {
	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/report", h.CreateJobReport)
	r.Get("/api/v1/admin/job-reports", h.ListJobReports)
	r.Post("/api/v1/admin/job-reports/{id}/resolve", h.ResolveJobReport)
	return r
}

func TestCreateJobReport_Table(t *testing.T) {
	t.Parallel()

	h := NewJobReportsHandler(nil)
	r := newJobReportsRouter(h)
	validID := "11111111-1111-1111-1111-111111111111"

	cases := []struct {
		name       string
		method     string
		path       string
		body       string
		authed     bool
		wantStatus int
	}{
		{
			name:       "invalid uuid",
			method:     http.MethodPost,
			path:       "/api/v1/jobs/not-a-uuid/report",
			body:       `{"reason":"spam"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid reason",
			method:     http.MethodPost,
			path:       "/api/v1/jobs/" + validID + "/report",
			body:       `{"reason":"stolen"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "empty reason",
			method:     http.MethodPost,
			path:       "/api/v1/jobs/" + validID + "/report",
			body:       `{"reason":""}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "malformed json",
			method:     http.MethodPost,
			path:       "/api/v1/jobs/" + validID + "/report",
			body:       `{`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "valid reason nil db fails closed",
			method:     http.MethodPost,
			path:       "/api/v1/jobs/" + validID + "/report",
			body:       `{"reason":"prohibited","description":"cannabis delivery"}`,
			authed:     true,
			wantStatus: http.StatusServiceUnavailable,
		},
		{
			name:       "anonymous valid reason nil db fails closed",
			method:     http.MethodPost,
			path:       "/api/v1/jobs/" + validID + "/report",
			body:       `{"reason":"scam"}`,
			wantStatus: http.StatusServiceUnavailable,
		},
		{
			name:       "admin list nil db empty 200",
			method:     http.MethodGet,
			path:       "/api/v1/admin/job-reports",
			wantStatus: http.StatusOK,
		},
		{
			name:       "admin resolve invalid uuid",
			method:     http.MethodPost,
			path:       "/api/v1/admin/job-reports/not-a-uuid/resolve",
			body:       `{"action":"dismiss"}`,
			authed:     true,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "admin resolve nil db fails closed",
			method:     http.MethodPost,
			path:       "/api/v1/admin/job-reports/" + validID + "/resolve",
			body:       `{"action":"dismiss"}`,
			authed:     true,
			wantStatus: http.StatusServiceUnavailable,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(tc.method, tc.path, bytes.NewReader([]byte(tc.body)))
			if tc.authed {
				req = authReq(req, "22222222-2222-2222-2222-222222222222")
			}
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Fatalf("%s %s: got %d want %d (body=%s)",
					tc.method, tc.path, rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestCreateJobReport_LiveDB(t *testing.T) {
	pool := liveTestPool(t)
	h := NewJobReportsHandler(pool)
	r := newJobReportsRouter(h)
	ctx := context.Background()

	suffix := uuid.NewString()[:8]
	owner := seedTestUser(t, pool, "jr-owner-"+suffix+"@test.invalid")
	reporter := seedTestUser(t, pool, "jr-reporter-"+suffix+"@test.invalid")
	reporter2 := seedTestUser(t, pool, "jr-reporter2-"+suffix+"@test.invalid")

	var categoryID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM service_categories LIMIT 1`).Scan(&categoryID); err != nil {
		t.Skipf("no service_categories to seed a job: %v", err)
	}

	var jobID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO jobs (
		    customer_id, title, description, category_id,
		    service_city, service_state, service_zip,
		    service_location, approximate_location, status)
		VALUES ($1, 'Report-me lawn', 'front yard', $2::uuid,
		        'Austin', 'TX', '78702',
		        ST_SetSRID(ST_MakePoint(-97.74, 30.27), 4326),
		        ST_SetSRID(ST_MakePoint(-97.74, 30.27), 4326),
		        'active')
		RETURNING id::text`, owner, categoryID).Scan(&jobID); err != nil {
		t.Fatalf("seed job: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM job_reports WHERE job_id = $1`, jobID)
		_, _ = pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, jobID)
	})

	post := func(t *testing.T, path, body, asUser string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader([]byte(body)))
		if asUser != "" {
			req = authReq(req, asUser)
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec
	}

	unknown := "00000000-0000-0000-0000-000000000099"
	if rec := post(t, "/api/v1/jobs/"+unknown+"/report", `{"reason":"spam"}`, reporter); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown job: got %d want 404 (body=%s)", rec.Code, rec.Body.String())
	}

	if rec := post(t, "/api/v1/jobs/"+jobID+"/report", `{"reason":"spam"}`, owner); rec.Code != http.StatusForbidden {
		t.Fatalf("owner self-report: got %d want 403 (body=%s)", rec.Code, rec.Body.String())
	}

	rec := post(t, "/api/v1/jobs/"+jobID+"/report",
		`{"reason":"prohibited","description":"cannabis delivery"}`, reporter)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create report: got %d want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	var created struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal create: %v", err)
	}
	if created.ID == "" || created.Status != "open" {
		t.Fatalf("unexpected create payload: %+v", created)
	}

	rec = post(t, "/api/v1/jobs/"+jobID+"/report", `{"reason":"scam"}`, reporter)
	if rec.Code != http.StatusOK {
		t.Fatalf("dedup report: got %d want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	anon := post(t, "/api/v1/jobs/"+jobID+"/report", `{"reason":"misleading"}`, "")
	if anon.Code != http.StatusCreated {
		t.Fatalf("anonymous report: got %d want 201 (body=%s)", anon.Code, anon.Body.String())
	}

	second := post(t, "/api/v1/jobs/"+jobID+"/report", `{"reason":"harassment"}`, reporter2)
	if second.Code != http.StatusCreated {
		t.Fatalf("second reporter: got %d want 201 (body=%s)", second.Code, second.Body.String())
	}
	var created2 struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &created2); err != nil || created2.ID == "" {
		t.Fatalf("unmarshal second create: %v payload=%s", err, second.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/job-reports?job_id="+jobID, nil)
	listRec := httptest.NewRecorder()
	r.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("admin list: got %d want 200 (body=%s)", listRec.Code, listRec.Body.String())
	}
	var listResp struct {
		Reports []struct {
			ID     string `json:"id"`
			JobID  string `json:"job_id"`
			Reason string `json:"reason"`
			Status string `json:"status"`
		} `json:"reports"`
		Pagination struct {
			Total int `json:"total"`
		} `json:"pagination"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("unmarshal admin list: %v", err)
	}
	if listResp.Pagination.Total < 3 {
		t.Fatalf("admin list total=%d want >=3", listResp.Pagination.Total)
	}
	found := false
	for _, rep := range listResp.Reports {
		if rep.ID == created.ID {
			found = true
			if rep.JobID != jobID || rep.Reason != "prohibited" || rep.Status != "open" {
				t.Fatalf("admin row mismatch: %+v", rep)
			}
		}
	}
	if !found {
		t.Fatalf("created report %s not visible in admin queue", created.ID)
	}

	resolve := func(t *testing.T, reportID, body, asUser string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost,
			"/api/v1/admin/job-reports/"+reportID+"/resolve", bytes.NewReader([]byte(body)))
		if asUser != "" {
			req = authReq(req, asUser)
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec
	}

	if rec := resolve(t, created.ID, `{"action":"dismiss"}`, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("resolve unauthed: got %d want 401 (body=%s)", rec.Code, rec.Body.String())
	}
	if rec := resolve(t, created.ID, `{"action":"bogus"}`, reporter); rec.Code != http.StatusBadRequest {
		t.Fatalf("resolve bad action: got %d want 400 (body=%s)", rec.Code, rec.Body.String())
	}

	unknownReport := "00000000-0000-0000-0000-000000000098"
	if rec := resolve(t, unknownReport, `{"action":"dismiss"}`, reporter); rec.Code != http.StatusNotFound {
		t.Fatalf("resolve missing: got %d want 404 (body=%s)", rec.Code, rec.Body.String())
	}

	resolveRec := resolve(t, created.ID, `{"action":"dismiss","notes":"not prohibited"}`, reporter)
	if resolveRec.Code != http.StatusOK {
		t.Fatalf("resolve: got %d want 200 (body=%s)", resolveRec.Code, resolveRec.Body.String())
	}
	var resolved struct {
		ReportID string `json:"report_id"`
		Status   string `json:"status"`
	}
	if err := json.Unmarshal(resolveRec.Body.Bytes(), &resolved); err != nil {
		t.Fatalf("unmarshal resolve: %v", err)
	}
	if resolved.ReportID != created.ID || resolved.Status != "dismissed" {
		t.Fatalf("unexpected resolve payload: %+v", resolved)
	}
	var afterStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM job_reports WHERE id=$1`, created.ID).Scan(&afterStatus); err != nil {
		t.Fatalf("read status after resolve: %v", err)
	}
	if afterStatus != "dismissed" {
		t.Fatalf("after resolve: status=%s want dismissed", afterStatus)
	}

	if rec := resolve(t, created.ID, `{"action":"actioned"}`, reporter); rec.Code != http.StatusConflict {
		t.Fatalf("resolve already terminal: got %d want 409 (body=%s)", rec.Code, rec.Body.String())
	}

	reviewRec := resolve(t, created2.ID, `{"action":"review","notes":"looking"}`, reporter)
	if reviewRec.Code != http.StatusOK {
		t.Fatalf("resolve review: got %d want 200 (body=%s)", reviewRec.Code, reviewRec.Body.String())
	}
	actionRec := resolve(t, created2.ID, `{"action":"actioned","notes":"removed"}`, reporter)
	if actionRec.Code != http.StatusOK {
		t.Fatalf("resolve actioned after review: got %d want 200 (body=%s)", actionRec.Code, actionRec.Body.String())
	}
	var afterActioned string
	if err := pool.QueryRow(ctx, `SELECT status FROM job_reports WHERE id=$1`, created2.ID).Scan(&afterActioned); err != nil {
		t.Fatalf("read status after actioned: %v", err)
	}
	if afterActioned != "actioned" {
		t.Fatalf("after actioned: status=%s want actioned", afterActioned)
	}
}
