package ws

import (
	"context"
	"sync"
	"testing"
)

// newRaceTestConnection builds the minimum Connection needed to exercise the
// subs map without a live WebSocket or Redis: no channel is ever subscribed,
// so handleTyping always takes its fail-closed "not subscribed" branch and
// never dereferences c.pubsub.
//
// sendBuffer must be large enough to hold every rejection frame the test
// produces. Overflowing it would make sendError call Close(), which needs a
// real *websocket.Conn — a test artifact, not the behaviour under test.
func newRaceTestConnection(t *testing.T, sendBuffer int) *Connection {
	t.Helper()

	return &Connection{
		userID:  "11111111-1111-7111-8111-111111111111",
		subs:    make(map[string]*channelSub),
		sendCh:  make(chan []byte, sendBuffer),
		closeCh: make(chan struct{}),
	}
}

// TestConnectionSubsConcurrentAccess is the regression test for RES-04.
//
// handleTyping runs on the connection's read loop; cleanupSubscriptions runs
// from Close(), which is reached from the listenRedis goroutine and from the
// send-buffer overflow path. cleanupSubscriptions REASSIGNS c.subs, so an
// unsynchronized read in handleTyping is a concurrent map read + map write —
// a Go runtime FATAL error that no recover() can contain, taking the pod and
// every other WebSocket connection on it down.
//
// Run under -race. Before the fix (handleTyping reading c.subs directly) this
// reports a data race on Connection.subs; after it, it is clean.
func TestConnectionSubsConcurrentAccess(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		reader func(c *Connection, channelID string)
	}{
		{
			name: "handleTyping vs cleanupSubscriptions",
			reader: func(c *Connection, channelID string) {
				c.handleTyping(context.Background(), channelID)
			},
		},
		{
			name: "isSubscribed vs cleanupSubscriptions",
			reader: func(c *Connection, channelID string) {
				_ = c.isSubscribed(channelID)
			},
		},
		{
			name: "handleUnsubscribe vs cleanupSubscriptions",
			reader: func(c *Connection, channelID string) {
				c.handleUnsubscribe(channelID)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			const (
				readers    = 8
				iterations = 400
			)

			// Every reader iteration can emit at most one rejection frame.
			c := newRaceTestConnection(t, readers*iterations+16)

			var wg sync.WaitGroup

			// Writers: the real cleanup path, which reassigns c.subs.
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := 0; i < iterations; i++ {
					c.cleanupSubscriptions()
				}
			}()

			// Readers: the connection read loop.
			for r := 0; r < readers; r++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					for i := 0; i < iterations; i++ {
						tt.reader(c, "22222222-2222-7222-8222-222222222222")
					}
				}()
			}

			wg.Wait()

			// Fail-closed invariant still holds: typing into a channel that was
			// never subscribed must be rejected, never published.
			if c.isSubscribed("22222222-2222-7222-8222-222222222222") {
				t.Error("connection reports a subscription it never made")
			}
		})
	}
}
