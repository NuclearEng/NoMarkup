package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Austin, TX downtown-ish reference used as a job site in geo-fence tests.
const (
	testJobLat = 30.2672
	testJobLng = -97.7431
)

func TestHaversineMeters_samePoint(t *testing.T) {
	t.Parallel()
	d := haversineMeters(testJobLat, testJobLng, testJobLat, testJobLng)
	assert.InDelta(t, 0, d, 1e-6)
}

func TestHaversineMeters_knownDistance(t *testing.T) {
	t.Parallel()
	// ~111.2 km per degree of latitude near the equator; 0.01° ≈ 1.112 km.
	d := haversineMeters(0, 0, 0.01, 0)
	assert.InDelta(t, 1112, d, 5) // within 5 m of the spherical estimate
}

func TestHaversineMeters_500mFence(t *testing.T) {
	t.Parallel()
	// ~0.0045° latitude ≈ 500 m.
	near := haversineMeters(testJobLat, testJobLng, testJobLat+0.001, testJobLng)
	far := haversineMeters(testJobLat, testJobLng, testJobLat+0.02, testJobLng)
	assert.Less(t, near, 500.0)
	assert.Greater(t, far, 500.0)
}

func TestParseExactPoint(t *testing.T) {
	t.Parallel()
	lat, lng, err := parseExactPoint("30.2672000,-97.7431000")
	require.NoError(t, err)
	assert.InDelta(t, 30.2672, lat, 1e-7)
	assert.InDelta(t, -97.7431, lng, 1e-7)

	_, _, err = parseExactPoint("not-a-point")
	assert.Error(t, err)

	_, _, err = parseExactPoint("91,0")
	assert.Error(t, err)

	_, _, err = parseExactPoint("NaN,0")
	assert.Error(t, err)
}

func TestIsUsableJobSite(t *testing.T) {
	t.Parallel()
	assert.True(t, isUsableJobSite(testJobLat, testJobLng))
	assert.False(t, isUsableJobSite(0, 0), "GDPR sentinel")
	assert.False(t, isUsableJobSite(math.NaN(), 0))
	assert.False(t, isUsableJobSite(100, 0))
}

func TestValidateClientLocation(t *testing.T) {
	t.Parallel()
	assert.NoError(t, validateClientLocation(testJobLat, testJobLng))
	assert.Error(t, validateClientLocation(91, 0))
	assert.Error(t, validateClientLocation(0, 181))
	assert.Error(t, validateClientLocation(math.Inf(1), 0))
}

func TestCheckInMaxDistanceMetersFromEnv(t *testing.T) {
	t.Setenv("CHECKIN_MAX_DISTANCE_METERS", "")
	assert.Equal(t, defaultCheckInMaxDistanceMeters, checkInMaxDistanceMetersFromEnv())

	t.Setenv("CHECKIN_MAX_DISTANCE_METERS", "250")
	assert.Equal(t, 250.0, checkInMaxDistanceMetersFromEnv())

	t.Setenv("CHECKIN_MAX_DISTANCE_METERS", "0")
	assert.Equal(t, defaultCheckInMaxDistanceMeters, checkInMaxDistanceMetersFromEnv())

	t.Setenv("CHECKIN_MAX_DISTANCE_METERS", "nope")
	assert.Equal(t, defaultCheckInMaxDistanceMeters, checkInMaxDistanceMetersFromEnv())
}

func TestEnforceGeofence_failSoftNoLocation(t *testing.T) {
	t.Parallel()
	h := &WorkspaceHandler{
		maxDistanceMeters: 500,
		resolveJobSite: func(ctx context.Context, contractID string) (float64, float64, bool, error) {
			return 0, 0, false, nil
		},
	}
	err := h.enforceGeofence(context.Background(), "contract-1", 0, 0)
	assert.NoError(t, err)
}

func TestEnforceGeofence_failSoftLookupError(t *testing.T) {
	t.Parallel()
	h := &WorkspaceHandler{
		maxDistanceMeters: 500,
		resolveJobSite: func(ctx context.Context, contractID string) (float64, float64, bool, error) {
			return 0, 0, false, errors.New("db down")
		},
	}
	err := h.enforceGeofence(context.Background(), "contract-1", testJobLat, testJobLng)
	assert.NoError(t, err)
}

func TestEnforceGeofence_rejectTooFar(t *testing.T) {
	t.Parallel()
	h := &WorkspaceHandler{
		maxDistanceMeters: 500,
		resolveJobSite: func(ctx context.Context, contractID string) (float64, float64, bool, error) {
			return testJobLat, testJobLng, true, nil
		},
	}
	// ~2.2 km north — well outside 500 m.
	err := h.enforceGeofence(context.Background(), "contract-1", testJobLat+0.02, testJobLng)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "too far from the job site")
	assert.Contains(t, err.Error(), "500")
}

func TestEnforceGeofence_acceptWithinRadius(t *testing.T) {
	t.Parallel()
	h := &WorkspaceHandler{
		maxDistanceMeters: 500,
		resolveJobSite: func(ctx context.Context, contractID string) (float64, float64, bool, error) {
			return testJobLat, testJobLng, true, nil
		},
	}
	// ~111 m north.
	err := h.enforceGeofence(context.Background(), "contract-1", testJobLat+0.001, testJobLng)
	assert.NoError(t, err)
}

func TestLookupJobSite_nilDB(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)
	lat, lng, found, err := h.lookupJobSite(context.Background(), "any")
	require.NoError(t, err)
	assert.False(t, found)
	assert.Equal(t, 0.0, lat)
	assert.Equal(t, 0.0, lng)
}

func TestCheckIn_geoFenceReject(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)
	h.maxDistanceMeters = 500
	h.resolveJobSite = func(ctx context.Context, contractID string) (float64, float64, bool, error) {
		return testJobLat, testJobLng, true, nil
	}

	r := chi.NewRouter()
	r.Post("/api/v1/contracts/{id}/checkin", h.CheckIn)

	body, _ := json.Marshal(map[string]float64{
		"lat": testJobLat + 0.05, // ~5.5 km
		"lng": testJobLng,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/contracts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/checkin", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "provider-1", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "too far from the job site")
}

func TestCheckIn_geoFenceAccept(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)
	h.maxDistanceMeters = 500
	h.resolveJobSite = func(ctx context.Context, contractID string) (float64, float64, bool, error) {
		return testJobLat, testJobLng, true, nil
	}

	r := chi.NewRouter()
	r.Post("/api/v1/contracts/{id}/checkin", h.CheckIn)

	body, _ := json.Marshal(map[string]float64{
		"lat": testJobLat,
		"lng": testJobLng,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/contracts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/checkin", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "provider-1", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "checked_in_at")
}

func TestCheckIn_geoFenceFailSoftNoSite(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)
	// Default resolveJobSite with nil db → found=false → fail soft.

	r := chi.NewRouter()
	r.Post("/api/v1/contracts/{id}/checkin", h.CheckIn)

	body, _ := json.Marshal(map[string]float64{"lat": 1.0, "lng": 2.0})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/contracts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/checkin", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "provider-1", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

func TestCheckIn_invalidCoordinates(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)

	r := chi.NewRouter()
	r.Post("/api/v1/contracts/{id}/checkin", h.CheckIn)

	body, _ := json.Marshal(map[string]float64{"lat": 999, "lng": 0})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/contracts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/checkin", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "provider-1", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.True(t, strings.Contains(rec.Body.String(), "latitude"), rec.Body.String())
}

func TestCheckOut_geoFenceReject(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)
	h.maxDistanceMeters = 500
	h.resolveJobSite = func(ctx context.Context, contractID string) (float64, float64, bool, error) {
		return testJobLat, testJobLng, true, nil
	}

	r := chi.NewRouter()
	r.Post("/api/v1/contracts/{id}/checkout", h.CheckOut)

	body, _ := json.Marshal(map[string]float64{
		"lat": testJobLat + 0.05,
		"lng": testJobLng,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/contracts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/checkout", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "provider-1", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// Fence runs before the "no active check-in" Redis read.
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "too far from the job site")
}
