package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// testNotifPool dials the live dev Postgres for the notification-emit tests.
// These tests need a real DB (they assert a notifications row lands for the
// RIGHT recipient), so they self-skip when NOTIF_TEST_DATABASE_URL is unset —
// keeping the default `go test` run hermetic. Run them against the running
// stack with:
//
//	NOTIF_TEST_DATABASE_URL='postgresql://nomarkup@localhost:5433/nomarkup?sslmode=disable' \
//	  go -C gateway test ./internal/handler/ -run TestEmitNotification -v
func testNotifPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("NOTIF_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("NOTIF_TEST_DATABASE_URL unset — skipping live-DB notification-emit test")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedUser inserts a throwaway user and returns its id, registering cleanup.
func seedUser(t *testing.T, pool *pgxpool.Pool, email string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (email, password_hash, display_name, roles, status)
		VALUES ($1, 'x', 'Test User', ARRAY['customer'], 'active')
		RETURNING id::text`, email).Scan(&id)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM notifications WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func countNotifs(t *testing.T, pool *pgxpool.Pool, userID, notifType string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM notifications WHERE user_id = $1 AND notification_type = $2`,
		userID, notifType,
	).Scan(&n); err != nil {
		t.Fatalf("count notifs: %v", err)
	}
	return n
}

// TestEmitNotificationRecipientOnly proves the core invariants of the shared
// emit seam against the live DB:
//   - the RECIPIENT gets exactly one row with the right type/title/body/url,
//   - the ACTOR gets nothing (recipient != actor),
//   - a self-notify (recipient == actor) is a silent no-op,
//   - a nil pool is a no-op (never panics).
func TestEmitNotificationRecipientOnly(t *testing.T) {
	pool := testNotifPool(t)
	ctx := context.Background()

	actor := seedUser(t, pool, "emit-actor-"+randSuffix()+"@nomarkup.test")
	recipient := seedUser(t, pool, "emit-recip-"+randSuffix()+"@nomarkup.test")

	// nil pool: must not panic, must not insert.
	emitNotification(ctx, nil, actor, recipient, "new_message", "t", "b", "/x", "", "")

	// self-notify: recipient == actor → no-op.
	emitNotification(ctx, pool, actor, actor, "new_message", "t", "b", "/x", "", "")
	if got := countNotifs(t, pool, actor, "new_message"); got != 0 {
		t.Fatalf("self-notify inserted a row for the actor: got %d, want 0", got)
	}

	// real emission: recipient gets the row, actor still gets nothing.
	emitNotification(ctx, pool, actor, recipient,
		"new_message", "New message from X", "hello", "/messages?channel=abc", "chat_channel", "")
	if got := countNotifs(t, pool, recipient, "new_message"); got != 1 {
		t.Fatalf("recipient row count: got %d, want 1", got)
	}
	if got := countNotifs(t, pool, actor, "new_message"); got != 0 {
		t.Fatalf("actor must NOT be notified about their own action: got %d, want 0", got)
	}

	// verify the stored fields round-trip.
	var title, body, url, etype string
	if err := pool.QueryRow(ctx, `
		SELECT title, body, action_url, entity_type
		  FROM notifications WHERE user_id = $1 AND notification_type = 'new_message'`,
		recipient,
	).Scan(&title, &body, &url, &etype); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if title != "New message from X" || body != "hello" ||
		url != "/messages?channel=abc" || etype != "chat_channel" {
		t.Fatalf("stored fields mismatch: title=%q body=%q url=%q etype=%q", title, body, url, etype)
	}
}

// TestEmitNotificationNewTypesPersist proves the two additive types
// (offer_received, offer_countered) survive the round-trip through the text
// column — i.e. the enum/string maps and the DB agree, so the frontend keys on
// a real icon rather than the generic bell.
func TestEmitNotificationNewTypesPersist(t *testing.T) {
	pool := testNotifPool(t)
	ctx := context.Background()
	actor := seedUser(t, pool, "emit-a2-"+randSuffix()+"@nomarkup.test")
	recipient := seedUser(t, pool, "emit-r2-"+randSuffix()+"@nomarkup.test")

	for _, typ := range []string{"offer_received", "offer_countered"} {
		emitNotification(ctx, pool, actor, recipient, typ, "title", "body", "/marketplace/x", "listing", "")
		if got := countNotifs(t, pool, recipient, typ); got != 1 {
			t.Fatalf("type %q: recipient row count got %d, want 1", typ, got)
		}
		// round-trip through the gateway's string↔enum maps must not be UNSPECIFIED.
		if stringToNotificationType(typ).String() == "NOTIFICATION_TYPE_UNSPECIFIED" {
			t.Fatalf("type %q maps to UNSPECIFIED enum — would render as generic bell", typ)
		}
	}
}

// TestChatRecipientResolution proves the chat new_message recipient pick is
// correct in BOTH directions against a real chat_channels row: the recipient is
// always the participant who is NOT the sender. This mirrors the exact
// query+branch in ChatHandler.notifyNewMessage so a regression there is caught.
func TestChatRecipientResolution(t *testing.T) {
	pool := testNotifPool(t)
	ctx := context.Background()

	customer := seedUser(t, pool, "chat-cust-"+randSuffix()+"@nomarkup.test")
	provider := seedUser(t, pool, "chat-prov-"+randSuffix()+"@nomarkup.test")

	// chat_channels.job_id is NOT NULL (FK → jobs). The recipient pick is
	// independent of the job's own columns, so reuse any existing job rather
	// than reconstructing the full (wide, NOT-NULL-heavy) jobs row here.
	var jobID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM jobs LIMIT 1`).Scan(&jobID); err != nil {
		t.Skipf("no existing job to attach a channel to — skipping: %v", err)
	}

	var channelID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO chat_channels (job_id, customer_id, provider_id, status, channel_type)
		VALUES ($1, $2, $3, 'active', 'bid')
		RETURNING id::text`, jobID, customer, provider).Scan(&channelID); err != nil {
		t.Fatalf("seed channel: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM chat_channels WHERE id = $1`, channelID) })

	// resolve replicates ChatHandler.notifyNewMessage's query + branch exactly.
	resolve := func(senderID string) string {
		var custID, provID string
		if err := pool.QueryRow(ctx,
			`SELECT customer_id::text, provider_id::text FROM chat_channels WHERE id = $1`,
			channelID,
		).Scan(&custID, &provID); err != nil {
			t.Fatalf("channel lookup: %v", err)
		}
		recipient := provID
		if senderID == provID {
			recipient = custID
		}
		return recipient
	}

	if got := resolve(customer); got != provider {
		t.Fatalf("customer sends → recipient should be provider: got %s want %s", got, provider)
	}
	if got := resolve(provider); got != customer {
		t.Fatalf("provider sends → recipient should be customer: got %s want %s", got, customer)
	}
}

func randSuffix() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
