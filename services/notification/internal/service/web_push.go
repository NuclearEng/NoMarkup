package service

// Web Push delivery — closes audit Section J's "FCM-only push" gap.
// Coexists with the existing FCM PushDispatcher. The notification
// service iterates `push_subscriptions` rows owned by the recipient and
// delivers an encrypted payload using VAPID + the per-subscription
// p256dh/auth keys (W3C Web Push Protocol, RFC 8030 / RFC 8291 / RFC 8292).
//
// Build-time choice: we use github.com/SherClockHolmes/webpush-go because
// it's the canonical Go implementation referenced in the W3C ecosystem,
// has zero CGO dependencies, and is small enough to vendor cleanly.
//
// Failure semantics: 410 Gone or 404 Not Found from the push service
// means the subscription is permanently invalid (browser uninstalled,
// user revoked permission). We delete the row inline so we don't keep
// hammering it. Other errors are logged and the loop continues.
//
// Dev mode: when VAPID_PRIVATE_KEY is empty, the dispatcher logs and
// skips. Mirrors the FCM dev-mode behavior so a fresh checkout doesn't
// need real keys to come up.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WebPushDispatcher sends notifications to W3C Web Push subscriptions.
// Multiple subscriptions per user are expected (one per browser/device).
type WebPushDispatcher struct {
	pool       *pgxpool.Pool
	publicKey  string
	privateKey string
	subject    string
	devMode    bool
	// httpClient refuses to dial non-public addresses and refuses to follow
	// redirects — see push_endpoint.go. Never replace this with
	// http.DefaultClient: the endpoint is client-supplied.
	httpClient *http.Client
}

// NewWebPushDispatcher constructs a dispatcher. When privateKey is empty,
// every Send becomes a no-op log line — mirrors the FCM dev-mode pattern.
//
// subject must be a `mailto:` URL per RFC 8292 §2 (some push services
// reject anything else). We default to a placeholder when empty so dev
// runs at least exercise the encoding path.
func NewWebPushDispatcher(pool *pgxpool.Pool, publicKey, privateKey, subject string) *WebPushDispatcher {
	if subject == "" {
		subject = "mailto:ops@nomarkup.com"
	}
	return &WebPushDispatcher{
		pool:       pool,
		publicKey:  publicKey,
		privateKey: privateKey,
		subject:    subject,
		devMode:    privateKey == "",
		httpClient: newPushHTTPClient(),
	}
}

// webPushPayload mirrors the JSON shape sw.js's `push` listener parses.
type webPushPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url,omitempty"`
	Tag   string `json:"tag,omitempty"`
}

type webPushSubscription struct {
	ID        string
	Endpoint  string
	P256dhKey string
	AuthKey   string
}

// SendToUser fetches every push_subscriptions row for the user and
// delivers the encrypted payload to each. Returns the count of
// successful deliveries and any errors encountered.
//
// Best-effort by design: a transient failure on one subscription must
// not block the others. The existing dispatchPush hook in service.go
// only checks `sent > 0` to flip notif.PushSent — same convention.
func (d *WebPushDispatcher) SendToUser(ctx context.Context, userID, title, body, url, tag string) (sent int, errs []error) {
	if d.pool == nil {
		return 0, nil
	}
	if d.devMode {
		slog.Info("web push dispatcher (dev mode): would send",
			"user_id", userID,
			"title", title,
		)
		return 0, nil
	}

	subs, err := d.fetchSubscriptions(ctx, userID)
	if err != nil {
		slog.Warn("web push: failed to load subscriptions",
			"user_id", userID,
			"error", err,
		)
		return 0, []error{err}
	}
	if len(subs) == 0 {
		return 0, nil
	}

	payload, err := json.Marshal(webPushPayload{
		Title: title,
		Body:  body,
		URL:   url,
		Tag:   tag,
	})
	if err != nil {
		return 0, []error{fmt.Errorf("web push: marshal payload: %w", err)}
	}

	for _, s := range subs {
		if err := d.deliver(ctx, s, payload); err != nil {
			errs = append(errs, err)
			continue
		}
		sent++
		// Best-effort last_seen_at bump; failure is non-fatal.
		if _, uerr := d.pool.Exec(ctx,
			`UPDATE push_subscriptions SET last_seen_at = now() WHERE id = $1`, s.ID,
		); uerr != nil {
			slog.Debug("web push: last_seen_at update failed", "error", uerr, "subscription_id", s.ID)
		}
	}

	return sent, errs
}

// deliver encrypts and POSTs to a single subscription's endpoint. On a
// terminal failure (410 Gone / 404 Not Found) we delete the row inline
// — the browser has discarded it and re-trying wastes RPS.
func (d *WebPushDispatcher) deliver(ctx context.Context, s webPushSubscription, payload []byte) error {
	// Re-validate at egress. The gateway rejects bad endpoints at subscribe
	// time, but rows written before that check existed are still in the table
	// and this is the only layer that sees the address actually being dialed.
	if err := validatePushEndpoint(s.Endpoint); err != nil {
		slog.Warn("web push: refusing to deliver to disallowed endpoint",
			"subscription_id", s.ID,
			"error", err,
		)
		// The row can never be delivered to — drop it so we stop retrying.
		if _, derr := d.pool.Exec(ctx,
			`DELETE FROM push_subscriptions WHERE id = $1`, s.ID,
		); derr != nil {
			slog.Warn("web push: failed to prune disallowed subscription",
				"subscription_id", s.ID,
				"error", derr,
			)
		}
		return err
	}

	sub := &webpush.Subscription{
		Endpoint: s.Endpoint,
		Keys: webpush.Keys{
			P256dh: s.P256dhKey,
			Auth:   s.AuthKey,
		},
	}
	resp, err := webpush.SendNotificationWithContext(ctx, payload, sub, &webpush.Options{
		HTTPClient:      d.httpClient,
		Subscriber:      d.subject,
		VAPIDPublicKey:  d.publicKey,
		VAPIDPrivateKey: d.privateKey,
		TTL:             60,
	})
	if err != nil {
		slog.Warn("web push: send failed",
			"subscription_id", s.ID,
			"error", err,
		)
		return err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case 200, 201, 202, 204:
		return nil
	case 404, 410:
		// Subscription is permanently invalid — drop it.
		if _, derr := d.pool.Exec(ctx,
			`DELETE FROM push_subscriptions WHERE id = $1`, s.ID,
		); derr != nil {
			slog.Warn("web push: failed to prune dead subscription",
				"subscription_id", s.ID,
				"error", derr,
			)
		}
		return fmt.Errorf("web push: subscription gone (status %d)", resp.StatusCode)
	default:
		return fmt.Errorf("web push: unexpected status %d", resp.StatusCode)
	}
}

func (d *WebPushDispatcher) fetchSubscriptions(ctx context.Context, userID string) ([]webPushSubscription, error) {
	rows, err := d.pool.Query(ctx,
		`SELECT id, endpoint, p256dh_key, auth_key
		   FROM push_subscriptions
		  WHERE user_id = $1`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []webPushSubscription
	for rows.Next() {
		var s webPushSubscription
		if err := rows.Scan(&s.ID, &s.Endpoint, &s.P256dhKey, &s.AuthKey); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return nil, err
		}
		subs = append(subs, s)
	}
	return subs, rows.Err()
}
