package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"google.golang.org/grpc"
)

// prohibitedUGCFixture is the same weapons string ugc_filter_test.go rejects.
const prohibitedUGCFixture = "AR-15 for sale"

func (m *mockUserClient) UpdateUser(ctx context.Context, req *userv1.UpdateUserRequest, _ ...grpc.CallOption) (*userv1.UpdateUserResponse, error) {
	if m.updateUserFn == nil {
		panic("UpdateUser not stubbed")
	}
	return m.updateUserFn(ctx, req)
}

func (m *mockUserClient) UpdateProviderProfile(ctx context.Context, req *userv1.UpdateProviderProfileRequest, _ ...grpc.CallOption) (*userv1.UpdateProviderProfileResponse, error) {
	if m.updateProviderFn == nil {
		panic("UpdateProviderProfile not stubbed")
	}
	return m.updateProviderFn(ctx, req)
}

func (m *mockUserClient) UpdatePortfolio(ctx context.Context, req *userv1.UpdatePortfolioRequest, _ ...grpc.CallOption) (*userv1.UpdatePortfolioResponse, error) {
	if m.updatePortfolioFn == nil {
		panic("UpdatePortfolio not stubbed")
	}
	return m.updatePortfolioFn(ctx, req)
}

func (m *mockUserClient) SetGlobalTerms(ctx context.Context, req *userv1.SetGlobalTermsRequest, _ ...grpc.CallOption) (*userv1.SetGlobalTermsResponse, error) {
	if m.setGlobalTermsFn == nil {
		panic("SetGlobalTerms not stubbed")
	}
	return m.setGlobalTermsFn(ctx, req)
}

// ugcDisputeContractClient stubs only OpenDispute for FileDispute UGC tests.
type ugcDisputeContractClient struct {
	contractv1.ContractServiceClient
	openFn func(ctx context.Context, req *contractv1.OpenDisputeRequest) (*contractv1.OpenDisputeResponse, error)
}

func (m *ugcDisputeContractClient) OpenDispute(ctx context.Context, req *contractv1.OpenDisputeRequest, _ ...grpc.CallOption) (*contractv1.OpenDisputeResponse, error) {
	if m.openFn == nil {
		panic("OpenDispute not stubbed")
	}
	return m.openFn(ctx, req)
}

func TestUpdateMe_RejectsProhibitedDisplayName(t *testing.T) {
	t.Parallel()
	var calls int
	client := &mockUserClient{
		updateUserFn: func(_ context.Context, req *userv1.UpdateUserRequest) (*userv1.UpdateUserResponse, error) {
			calls++
			return &userv1.UpdateUserResponse{User: &userv1.User{
				Id: req.GetUserId(), Email: "a@b.c", DisplayName: req.GetDisplayName(),
			}}, nil
		},
	}
	h := NewUserHandler(client, nil)

	bad := httptest.NewRequest(http.MethodPatch, "/api/v1/users/me", strings.NewReader(`{"display_name":"`+prohibitedUGCFixture+`"}`))
	bad = addClaimsToRequest(bad, "11111111-1111-1111-1111-111111111111", "a@b.c", []string{"customer"})
	rec := httptest.NewRecorder()
	h.UpdateMe(rec, bad)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("prohibited name: got %d want 400 (body=%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Community Guidelines") {
		t.Fatalf("body = %s", rec.Body.String())
	}
	if calls != 0 {
		t.Fatalf("UpdateUser calls = %d want 0", calls)
	}

	okReq := httptest.NewRequest(http.MethodPatch, "/api/v1/users/me", strings.NewReader(`{"display_name":"Casey"}`))
	okReq = addClaimsToRequest(okReq, "11111111-1111-1111-1111-111111111111", "a@b.c", []string{"customer"})
	okRec := httptest.NewRecorder()
	h.UpdateMe(okRec, okReq)
	if okRec.Code != http.StatusOK {
		t.Fatalf("benign name: got %d want 200 (body=%s)", okRec.Code, okRec.Body.String())
	}
	if calls != 1 {
		t.Fatalf("UpdateUser calls = %d want 1", calls)
	}
}

func TestProviderUpdateMe_RejectsProhibitedBio_SkipsEmpty(t *testing.T) {
	t.Parallel()
	var calls int
	var gotBio string
	client := &mockUserClient{
		updateProviderFn: func(_ context.Context, req *userv1.UpdateProviderProfileRequest) (*userv1.UpdateProviderProfileResponse, error) {
			calls++
			gotBio = req.GetBio()
			return &userv1.UpdateProviderProfileResponse{Profile: &userv1.ProviderProfile{
				UserId: req.GetUserId(), Bio: req.GetBio(),
			}}, nil
		},
	}
	h := NewProviderHandler(client, nil, nil)
	uid := "11111111-1111-1111-1111-111111111111"

	bad := httptest.NewRequest(http.MethodPatch, "/api/v1/providers/me", strings.NewReader(`{"bio":"`+prohibitedUGCFixture+`"}`))
	bad = addClaimsToRequest(bad, uid, "a@b.c", []string{"provider"})
	rec := httptest.NewRecorder()
	h.UpdateMe(rec, bad)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("prohibited bio: got %d want 400 (body=%s)", rec.Code, rec.Body.String())
	}
	if calls != 0 {
		t.Fatalf("UpdateProviderProfile calls = %d want 0", calls)
	}

	empty := httptest.NewRequest(http.MethodPatch, "/api/v1/providers/me", strings.NewReader(`{"bio":""}`))
	empty = addClaimsToRequest(empty, uid, "a@b.c", []string{"provider"})
	emptyRec := httptest.NewRecorder()
	h.UpdateMe(emptyRec, empty)
	if emptyRec.Code != http.StatusOK {
		t.Fatalf("empty bio: got %d want 200 (body=%s)", emptyRec.Code, emptyRec.Body.String())
	}
	if calls != 1 || gotBio != "" {
		t.Fatalf("empty bio calls=%d bio=%q", calls, gotBio)
	}

	omitted := httptest.NewRequest(http.MethodPatch, "/api/v1/providers/me", strings.NewReader(`{"business_name":"Casey Plumbing"}`))
	omitted = addClaimsToRequest(omitted, uid, "a@b.c", []string{"provider"})
	omitRec := httptest.NewRecorder()
	h.UpdateMe(omitRec, omitted)
	if omitRec.Code != http.StatusOK {
		t.Fatalf("omitted bio: got %d want 200 (body=%s)", omitRec.Code, omitRec.Body.String())
	}
	if calls != 2 {
		t.Fatalf("calls = %d want 2", calls)
	}
}

func TestProviderUpdateMe_RejectsProhibitedBusinessName(t *testing.T) {
	t.Parallel()
	var calls int
	var gotName, gotEIN string
	client := &mockUserClient{
		updateProviderFn: func(_ context.Context, req *userv1.UpdateProviderProfileRequest) (*userv1.UpdateProviderProfileResponse, error) {
			calls++
			gotName = req.GetBusinessName()
			gotEIN = req.GetEinTin()
			return &userv1.UpdateProviderProfileResponse{Profile: &userv1.ProviderProfile{
				UserId: req.GetUserId(), BusinessName: req.GetBusinessName(),
			}}, nil
		},
	}
	h := NewProviderHandler(client, nil, nil)
	uid := "11111111-1111-1111-1111-111111111111"
	patch := func(body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/providers/me", strings.NewReader(body))
		req = addClaimsToRequest(req, uid, "a@b.c", []string{"provider"})
		rec := httptest.NewRecorder()
		h.UpdateMe(rec, req)
		return rec
	}

	bad := patch(`{"business_name":"` + prohibitedUGCFixture + `"}`)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("prohibited business name: got %d want 400 (body=%s)", bad.Code, bad.Body.String())
	}
	if !strings.Contains(bad.Body.String(), "Community Guidelines") {
		t.Fatalf("body = %s", bad.Body.String())
	}
	if calls != 0 {
		t.Fatalf("UpdateProviderProfile calls = %d want 0", calls)
	}

	okRec := patch(`{"business_name":"Casey Plumbing"}`)
	if okRec.Code != http.StatusOK {
		t.Fatalf("normal name: got %d want 200 (body=%s)", okRec.Code, okRec.Body.String())
	}
	if calls != 1 || gotName != "Casey Plumbing" {
		t.Fatalf("normal name calls=%d name=%q", calls, gotName)
	}

	// Empty and whitespace-only are omitted-equivalent: not filtered.
	empty := patch(`{"business_name":""}`)
	if empty.Code != http.StatusOK {
		t.Fatalf("empty name: got %d want 200 (body=%s)", empty.Code, empty.Body.String())
	}
	blank := patch(`{"business_name":"   "}`)
	if blank.Code != http.StatusOK {
		t.Fatalf("blank name: got %d want 200 (body=%s)", blank.Code, blank.Body.String())
	}
	if calls != 3 {
		t.Fatalf("blank/empty calls = %d want 3", calls)
	}

	// EIN is not public UGC. A prohibited string there must still be stored.
	ein := patch(`{"ein_tin":"` + prohibitedUGCFixture + `"}`)
	if ein.Code != http.StatusOK {
		t.Fatalf("ein: got %d want 200 (body=%s)", ein.Code, ein.Body.String())
	}
	if calls != 4 || gotEIN != prohibitedUGCFixture {
		t.Fatalf("ein calls=%d ein=%q", calls, gotEIN)
	}
}

func TestChatTemplate_RejectsProhibitedBody(t *testing.T) {
	t.Parallel()
	h := NewChatTemplatesHandler(nil)
	r := chi.NewRouter()
	r.Post("/api/v1/me/chat/templates", h.CreateTemplate)
	r.Patch("/api/v1/me/chat/templates/{id}", h.UpdateTemplate)
	uid := "11111111-1111-1111-1111-111111111111"
	id := "33333333-3333-3333-3333-333333333333"

	create := httptest.NewRequest(http.MethodPost, "/api/v1/me/chat/templates", strings.NewReader(`{"body":"`+prohibitedUGCFixture+`"}`))
	create = addClaimsToRequest(create, uid, "a@b.c", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, create)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("create: got %d want 400 (body=%s)", rec.Code, rec.Body.String())
	}

	update := httptest.NewRequest(http.MethodPatch, "/api/v1/me/chat/templates/"+id, strings.NewReader(`{"body":"`+prohibitedUGCFixture+`"}`))
	update = addClaimsToRequest(update, uid, "a@b.c", []string{"customer"})
	urec := httptest.NewRecorder()
	r.ServeHTTP(urec, update)
	if urec.Code != http.StatusBadRequest {
		t.Fatalf("update: got %d want 400 (body=%s)", urec.Code, urec.Body.String())
	}

	benign := httptest.NewRequest(http.MethodPost, "/api/v1/me/chat/templates", strings.NewReader(`{"body":"I can pick up tomorrow"}`))
	benign = addClaimsToRequest(benign, uid, "a@b.c", []string{"customer"})
	brec := httptest.NewRecorder()
	r.ServeHTTP(brec, benign)
	if brec.Code != http.StatusServiceUnavailable {
		t.Fatalf("benign nil db: got %d want 503 (body=%s)", brec.Code, brec.Body.String())
	}
}

func TestQuoteTemplate_RejectsProhibitedText_SkipsEmpty(t *testing.T) {
	t.Parallel()
	h := NewQuoteTemplatesHandler(nil)
	r := chi.NewRouter()
	r.Post("/api/v1/me/quote-templates", h.Create)
	r.Patch("/api/v1/me/quote-templates/{id}", h.Update)
	uid := "11111111-1111-1111-1111-111111111111"
	id := "33333333-3333-3333-3333-333333333333"

	create := httptest.NewRequest(http.MethodPost, "/api/v1/me/quote-templates",
		strings.NewReader(`{"name":"drain","body":"`+prohibitedUGCFixture+`"}`))
	create = addClaimsToRequest(create, uid, "a@b.c", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, create)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("create body: got %d want 400 (body=%s)", rec.Code, rec.Body.String())
	}

	name := httptest.NewRequest(http.MethodPost, "/api/v1/me/quote-templates",
		strings.NewReader(`{"name":"`+prohibitedUGCFixture+`","body":"30 min unclog"}`))
	name = addClaimsToRequest(name, uid, "a@b.c", []string{"provider"})
	nrec := httptest.NewRecorder()
	r.ServeHTTP(nrec, name)
	if nrec.Code != http.StatusBadRequest {
		t.Fatalf("create name: got %d want 400 (body=%s)", nrec.Code, nrec.Body.String())
	}

	update := httptest.NewRequest(http.MethodPatch, "/api/v1/me/quote-templates/"+id,
		strings.NewReader(`{"body":"`+prohibitedUGCFixture+`"}`))
	update = addClaimsToRequest(update, uid, "a@b.c", []string{"provider"})
	urec := httptest.NewRecorder()
	r.ServeHTTP(urec, update)
	if urec.Code != http.StatusBadRequest {
		t.Fatalf("update body: got %d want 400 (body=%s)", urec.Code, urec.Body.String())
	}

	// Amount-only patch has no text. Empty body must not be filtered.
	amount := httptest.NewRequest(http.MethodPatch, "/api/v1/me/quote-templates/"+id,
		strings.NewReader(`{"default_amount_cents":15000,"body":""}`))
	amount = addClaimsToRequest(amount, uid, "a@b.c", []string{"provider"})
	arec := httptest.NewRecorder()
	r.ServeHTTP(arec, amount)
	if arec.Code != http.StatusServiceUnavailable {
		t.Fatalf("empty optional text: got %d want 503 (body=%s)", arec.Code, arec.Body.String())
	}
}

func TestRegister_RejectsProhibitedDisplayName(t *testing.T) {
	t.Parallel()
	var calls int
	var gotName, gotPassword string
	client := &mockUserClient{
		registerFn: func(_ context.Context, req *userv1.RegisterRequest) (*userv1.RegisterResponse, error) {
			calls++
			gotName = req.GetDisplayName()
			gotPassword = req.GetPassword()
			return &userv1.RegisterResponse{
				UserId:       "user-1",
				AccessToken:  "access",
				RefreshToken: "refresh",
			}, nil
		},
	}
	h := NewAuthHandler(client, false, "test-session-secret")
	post := func(body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.Register(rec, req)
		return rec
	}

	bad := post(`{"email":"a@b.c","password":"secret123","display_name":"` + prohibitedUGCFixture + `"}`)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("prohibited name: got %d want 400 (body=%s)", bad.Code, bad.Body.String())
	}
	if !strings.Contains(bad.Body.String(), "Community Guidelines") {
		t.Fatalf("body = %s", bad.Body.String())
	}
	if calls != 0 {
		t.Fatalf("Register calls = %d want 0", calls)
	}

	okRec := post(`{"email":"a@b.c","password":"secret123","display_name":"Casey"}`)
	if okRec.Code != http.StatusCreated {
		t.Fatalf("normal name: got %d want 201 (body=%s)", okRec.Code, okRec.Body.String())
	}
	if calls != 1 || gotName != "Casey" {
		t.Fatalf("normal name calls=%d name=%q", calls, gotName)
	}

	// Blank display name is optional at register and is not filtered.
	blank := post(`{"email":"a@b.c","password":"secret123","display_name":"   "}`)
	if blank.Code != http.StatusCreated {
		t.Fatalf("blank name: got %d want 201 (body=%s)", blank.Code, blank.Body.String())
	}
	if calls != 2 || gotName != "" {
		t.Fatalf("blank name calls=%d name=%q", calls, gotName)
	}

	// Password is not public UGC. A prohibited string there must still register.
	pw := post(`{"email":"a@b.c","password":"` + prohibitedUGCFixture + `","display_name":"Casey"}`)
	if pw.Code != http.StatusCreated {
		t.Fatalf("password: got %d want 201 (body=%s)", pw.Code, pw.Body.String())
	}
	if calls != 3 || gotPassword != prohibitedUGCFixture {
		t.Fatalf("password calls=%d password=%q", calls, gotPassword)
	}
}

func TestUpdatePortfolio_RejectsProhibitedCaption_SkipsEmpty(t *testing.T) {
	t.Parallel()
	var calls int
	var gotCaptions []string
	client := &mockUserClient{
		updatePortfolioFn: func(_ context.Context, req *userv1.UpdatePortfolioRequest) (*userv1.UpdatePortfolioResponse, error) {
			calls++
			gotCaptions = nil
			for _, img := range req.GetImages() {
				gotCaptions = append(gotCaptions, img.GetCaption())
			}
			return &userv1.UpdatePortfolioResponse{Images: req.GetImages()}, nil
		},
	}
	h := NewProviderHandler(client, nil, nil)
	uid := "11111111-1111-1111-1111-111111111111"
	put := func(body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPut, "/api/v1/providers/me/portfolio", strings.NewReader(body))
		req = addClaimsToRequest(req, uid, "a@b.c", []string{"provider"})
		rec := httptest.NewRecorder()
		h.UpdatePortfolio(rec, req)
		return rec
	}

	bad := put(`{"images":[{"image_url":"https://cdn.example/a.jpg","caption":"` + prohibitedUGCFixture + `","sort_order":1}]}`)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("prohibited caption: got %d want 400 (body=%s)", bad.Code, bad.Body.String())
	}
	if !strings.Contains(bad.Body.String(), "Community Guidelines") {
		t.Fatalf("body = %s", bad.Body.String())
	}
	if calls != 0 {
		t.Fatalf("UpdatePortfolio calls = %d want 0", calls)
	}

	empty := put(`{"images":[{"image_url":"https://cdn.example/a.jpg","caption":"","sort_order":0}]}`)
	if empty.Code != http.StatusOK {
		t.Fatalf("empty caption: got %d want 200 (body=%s)", empty.Code, empty.Body.String())
	}
	if calls != 1 || len(gotCaptions) != 1 || gotCaptions[0] != "" {
		t.Fatalf("empty caption calls=%d captions=%q", calls, gotCaptions)
	}

	okRec := put(`{"images":[{"image_url":"https://cdn.example/a.jpg","caption":"Kitchen backsplash","sort_order":1},{"image_url":"https://cdn.example/b.jpg","caption":"   ","sort_order":2}]}`)
	if okRec.Code != http.StatusOK {
		t.Fatalf("normal caption: got %d want 200 (body=%s)", okRec.Code, okRec.Body.String())
	}
	if calls != 2 || len(gotCaptions) != 2 || gotCaptions[0] != "Kitchen backsplash" {
		t.Fatalf("normal caption calls=%d captions=%q", calls, gotCaptions)
	}

	// Image URLs are not public text. A prohibited string in the URL must still be stored.
	url := put(`{"images":[{"image_url":"https://cdn.example/` + prohibitedUGCFixture + `.jpg","caption":"Tile work"}]}`)
	if url.Code != http.StatusOK {
		t.Fatalf("image url: got %d want 200 (body=%s)", url.Code, url.Body.String())
	}
	if calls != 3 {
		t.Fatalf("image url calls = %d want 3", calls)
	}
}

func TestSetGlobalTerms_RejectsProhibitedPolicy_SkipsEmpty(t *testing.T) {
	t.Parallel()
	var calls int
	var gotCancel, gotWarranty string
	client := &mockUserClient{
		setGlobalTermsFn: func(_ context.Context, req *userv1.SetGlobalTermsRequest) (*userv1.SetGlobalTermsResponse, error) {
			calls++
			gotCancel = req.GetCancellationPolicy()
			gotWarranty = req.GetWarrantyTerms()
			return &userv1.SetGlobalTermsResponse{Profile: &userv1.ProviderProfile{
				UserId: req.GetUserId(), CancellationPolicy: req.GetCancellationPolicy(),
			}}, nil
		},
	}
	h := NewProviderHandler(client, nil, nil)
	uid := "11111111-1111-1111-1111-111111111111"
	put := func(body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPut, "/api/v1/providers/me/terms", strings.NewReader(body))
		req = addClaimsToRequest(req, uid, "a@b.c", []string{"provider"})
		rec := httptest.NewRecorder()
		h.SetGlobalTerms(rec, req)
		return rec
	}

	bad := put(`{"payment_timing":"upfront","cancellation_policy":"` + prohibitedUGCFixture + `","warranty_terms":""}`)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("prohibited policy: got %d want 400 (body=%s)", bad.Code, bad.Body.String())
	}
	if !strings.Contains(bad.Body.String(), "Community Guidelines") {
		t.Fatalf("body = %s", bad.Body.String())
	}
	if calls != 0 {
		t.Fatalf("SetGlobalTerms calls = %d want 0", calls)
	}

	milestone := put(`{"payment_timing":"milestone","milestones":[{"description":"` + prohibitedUGCFixture + `","percentage":50}],"warranty_terms":"1 year"}`)
	if milestone.Code != http.StatusBadRequest {
		t.Fatalf("prohibited milestone: got %d want 400 (body=%s)", milestone.Code, milestone.Body.String())
	}
	if calls != 0 {
		t.Fatalf("milestone calls = %d want 0", calls)
	}

	okRec := put(`{"payment_timing":"upfront","cancellation_policy":"Cancel 24 hours ahead","warranty_terms":"","milestones":[{"description":"","percentage":100}]}`)
	if okRec.Code != http.StatusOK {
		t.Fatalf("empty warranty: got %d want 200 (body=%s)", okRec.Code, okRec.Body.String())
	}
	if calls != 1 || gotCancel != "Cancel 24 hours ahead" || gotWarranty != "" {
		t.Fatalf("empty warranty calls=%d cancel=%q warranty=%q", calls, gotCancel, gotWarranty)
	}
}

func TestFileDispute_RejectsProhibitedDescription(t *testing.T) {
	t.Parallel()
	var calls int
	var gotDesc string
	client := &ugcDisputeContractClient{
		openFn: func(_ context.Context, req *contractv1.OpenDisputeRequest) (*contractv1.OpenDisputeResponse, error) {
			calls++
			gotDesc = req.GetDescription()
			return &contractv1.OpenDisputeResponse{Dispute: &contractv1.Dispute{
				Id:          "dispute-1",
				ContractId:  req.GetContractId(),
				Description: req.GetDescription(),
				Status:      contractv1.DisputeStatus_DISPUTE_STATUS_OPEN,
			}}, nil
		},
	}
	h := NewDisputeHandler(client, nil)
	uid := "11111111-1111-1111-1111-111111111111"
	// Length gate is 50 characters and runs before the UGC filter.
	badDesc := prohibitedUGCFixture + strings.Repeat(" x", 20)
	if len(badDesc) < 50 {
		t.Fatalf("badDesc len %d", len(badDesc))
	}
	clean := "The drywall patch was left unfinished and the paint does not match the wall."
	if len(clean) < 50 {
		t.Fatalf("clean len %d", len(clean))
	}
	post := func(desc, reason string) *httptest.ResponseRecorder {
		t.Helper()
		body := `{"contract_id":"22222222-2222-2222-2222-222222222222","reason":"` + reason + `","description":"` + desc + `"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/disputes", strings.NewReader(body))
		req = addClaimsToRequest(req, uid, "a@b.c", []string{"customer"})
		rec := httptest.NewRecorder()
		h.FileDispute(rec, req)
		return rec
	}

	bad := post(badDesc, "quality_issue")
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("prohibited description: got %d want 400 (body=%s)", bad.Code, bad.Body.String())
	}
	if !strings.Contains(bad.Body.String(), "Community Guidelines") {
		t.Fatalf("body = %s", bad.Body.String())
	}
	if calls != 0 {
		t.Fatalf("OpenDispute calls = %d want 0", calls)
	}

	okRec := post(clean, "quality_issue")
	if okRec.Code != http.StatusCreated {
		t.Fatalf("clean description: got %d want 201 (body=%s)", okRec.Code, okRec.Body.String())
	}
	if calls != 1 || gotDesc != clean {
		t.Fatalf("clean description calls=%d desc=%q", calls, gotDesc)
	}
}
