package handler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestApproxDriveMinutes_Bounds(t *testing.T) {
	t.Parallel()
	assert.Equal(t, 1, approxDriveMinutes(0))
	assert.Equal(t, 1, approxDriveMinutes(-10))
	// 1 mile → ~2 min
	assert.Equal(t, 2, approxDriveMinutes(1609.344))
	// 5 miles → ~10 min
	assert.Equal(t, 10, approxDriveMinutes(1609.344*5))
	// Cap
	assert.Equal(t, 999, approxDriveMinutes(1609.344*10_000))
}

func TestBuildProviderInstantOffer_SkipsWhenNoGeo(t *testing.T) {
	t.Parallel()
	offer := buildProviderInstantOffer(
		"job-1",
		instantMatchRecord{JobTitle: "Leak", ExpiresAt: "t", AmountCents: 100},
		instantJobMatchContext{},
		47.6, -122.3, true,
	)
	_, hasMin := offer["approx_travel_minutes"]
	_, hasLat := offer["approx_lat"]
	assert.False(t, hasMin)
	assert.False(t, hasLat)
	assert.Equal(t, "job-1", offer["job_id"])
}

func TestBuildProviderInstantOffer_IncludesSoftETA(t *testing.T) {
	t.Parallel()
	// ~0 distance → 1 min floor
	offer := buildProviderInstantOffer(
		"job-2",
		instantMatchRecord{JobTitle: "Leak", ExpiresAt: "t", AmountCents: 200},
		instantJobMatchContext{HasGeo: true, Lat: 47.6, Lng: -122.3},
		47.6, -122.3, true,
	)
	require.Equal(t, 47.6, offer["approx_lat"])
	require.Equal(t, -122.3, offer["approx_lng"])
	require.Equal(t, 1, offer["approx_travel_minutes"])
}

func TestBuildProviderInstantOffer_NoProviderGeo(t *testing.T) {
	t.Parallel()
	offer := buildProviderInstantOffer(
		"job-3",
		instantMatchRecord{JobTitle: "Leak", ExpiresAt: "t", AmountCents: 200},
		instantJobMatchContext{HasGeo: true, Lat: 47.6, Lng: -122.3},
		0, 0, false,
	)
	_, hasMin := offer["approx_travel_minutes"]
	assert.False(t, hasMin)
	assert.Equal(t, 47.6, offer["approx_lat"])
}
