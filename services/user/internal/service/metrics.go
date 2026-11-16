package service

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Auth security counters. These register on the default Prometheus registry,
// which is what cmd/server exposes on /metrics — a security signal nobody can
// alert on is not a control.
//
// Suggested alerting: any non-zero rate on refreshTokenReuseTotal is
// page-worthy for a single user and incident-worthy in aggregate. The grace
// counter is the control group: if it climbs alongside reuse, the grace window
// is mistuned rather than the fleet being compromised.
var (
	// refreshTokenReuseTotal counts confirmed refresh-token reuse: an
	// already-rotated token presented outside the benign-race grace window.
	// Two parties hold the same token.
	refreshTokenReuseTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "auth_refresh_token_reuse_detected_total",
		Help: "Refresh tokens replayed after rotation, outside the benign-race grace window. Each event revokes a token family and indicates probable token theft.",
	})

	// refreshTokenFamilyRevokedTotal counts token FAMILIES killed by reuse
	// detection (one per detection event).
	refreshTokenFamilyRevokedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "auth_refresh_token_family_revoked_total",
		Help: "Refresh-token families revoked in response to detected reuse.",
	})

	// refreshTokenFamilySessionsRevokedTotal counts individual live sessions
	// destroyed by those family revocations — the blast radius of the control.
	refreshTokenFamilySessionsRevokedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "auth_refresh_token_family_sessions_revoked_total",
		Help: "Individual active refresh tokens revoked as part of reuse-triggered family revocation.",
	})

	// refreshTokenReplayGraceTotal counts replays absorbed by the grace window:
	// a client that fired two refreshes concurrently or retried after a network
	// timeout that had actually succeeded. Rejected, but NOT treated as theft.
	refreshTokenReplayGraceTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "auth_refresh_token_replay_grace_total",
		Help: "Refresh-token replays that landed inside the grace window and were treated as a benign client race rather than theft.",
	})

	// refreshTokenRevokedReplayTotal counts replays of tokens that were revoked
	// but never rotated — logout, password change, admin revoke. Expected
	// background noise, explicitly not a theft signal.
	refreshTokenRevokedReplayTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "auth_refresh_token_revoked_replay_total",
		Help: "Replays of refresh tokens revoked by logout/password-change/admin action (never rotated). Not a compromise signal.",
	})
)
